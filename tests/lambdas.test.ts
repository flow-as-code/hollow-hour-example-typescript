/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// The six stub Lambdas: one per lambda: key in the manifest, each a single
// self-contained directory the environment roots zip as is, each returning a
// flat map of strings (the shape STRING_MAP validation takes, and a subset of
// what the JSON validation hh-hotline-main uses accepts), and each
// deterministic. The rubric has its own file, tests/rubric.test.ts.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDistricts } from "../generators/config.js";
import { loadManifest } from "../generators/refs.js";
import * as callerLookup from "../lambdas/caller-lookup/index.mjs";
import * as classify from "../lambdas/classify-apparition/index.mjs";
import * as crewEta from "../lambdas/crew-eta/index.mjs";
import * as districtForAddress from "../lambdas/district-for-address/index.mjs";
import * as planeCheck from "../lambdas/plane-check/index.mjs";
import * as prankScore from "../lambdas/prank-score/index.mjs";

const ROOT = join(import.meta.dirname, "..");
const LAMBDAS = join(ROOT, "lambdas");

type Handler = (event: unknown) => Promise<Record<string, string>>;
const HANDLERS: Record<string, Handler> = {
  "caller-lookup": callerLookup.handler,
  "classify-apparition": classify.handler,
  "crew-eta": crewEta.handler,
  "district-for-address": districtForAddress.handler,
  "plane-check": planeCheck.handler,
  "prank-score": prankScore.handler,
};

// Mrs. Alder, the hotel account, Theo, a stranger, and one of the departed.
const ALDER = "+14135550142";
const HOTEL = "+14135550107";
const THEO = "+14135550166";
const STRANGER = "+14135550123";
const DEPARTED = "+14135550199";

/** A Connect invocation event, in the documented shape. */
function event(
  parameters: Record<string, string> = {},
  address: string | null = STRANGER,
  attributes: Record<string, string> = {},
) {
  return {
    Name: "ContactFlowEvent",
    Details: {
      ContactData: {
        Attributes: attributes,
        Channel: "VOICE",
        ContactId: "00000000-0000-4000-8000-000000000000",
        CustomerEndpoint:
          address === null ? undefined : { Address: address, Type: "TELEPHONE_NUMBER" },
      },
      Parameters: parameters,
    },
  };
}

/** HH_DISTRICTS as the environment roots write it, from districts.config.json. */
const HH_DISTRICTS = JSON.stringify(loadDistricts().map(({ slug, name }) => ({ slug, name })));
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.HH_DISTRICTS;
  process.env.HH_DISTRICTS = HH_DISTRICTS;
});
afterEach(() => {
  if (saved === undefined) delete process.env.HH_DISTRICTS;
  else process.env.HH_DISTRICTS = saved;
});

describe("lambdas/", () => {
  it("has one stub per lambda: key in refs/manifest.json, and nothing else", () => {
    const keys = loadManifest()
      .refs.map((e) => e.key)
      .filter((k) => k.startsWith("lambda:"))
      .map((k) => k.slice("lambda:".length))
      .sort();
    const dirs = readdirSync(LAMBDAS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual(keys);
    expect(Object.keys(HANDLERS).sort()).toEqual(keys);
  });

  it("keeps each stub to one dependency-free index.mjs, so the zip is the directory", () => {
    for (const name of Object.keys(HANDLERS)) {
      expect(readdirSync(join(LAMBDAS, name)), name).toEqual(["index.mjs"]);
      const source = readFileSync(join(LAMBDAS, name, "index.mjs"), "utf8");
      expect(source, name).not.toMatch(/^\s*import\s/m);
      expect(source, name).not.toMatch(/\brequire\(/);
      expect(source, name).toMatch(/export async function handler\(/);
    }
  });

  it("returns a flat map of strings for every input, the STRING_MAP shape", async () => {
    const events = [
      event(),
      event({}, null),
      event({ district: "old-town", queueSize: "3", address: "12 Wharf Road" }, ALDER),
      event({ canSee: "1", anyoneHurt: "1", claimsBeyond: "1", postcode: "40213" }, DEPARTED),
      { Details: {} },
      {},
      null,
    ];
    for (const [name, handler] of Object.entries(HANDLERS)) {
      for (const e of events) {
        const out = await handler(e);
        expect(typeof out, name).toBe("object");
        for (const [k, v] of Object.entries(out)) {
          expect(typeof v, `${name}.${k}`).toBe("string");
          expect(v.length, `${name}.${k}`).toBeGreaterThan(0);
        }
        expect(JSON.stringify(out).length, name).toBeLessThan(1024);
      }
    }
  });

  it("is deterministic: the same event gives the same answer", async () => {
    const e = event({ district: "harborside", queueSize: "2", canSee: "1", sounds: "1" }, THEO);
    for (const [name, handler] of Object.entries(HANDLERS)) {
      expect(await handler(e), name).toEqual(await handler(e));
    }
  });

  it("keeps every fixture number in the fictional 555-0100 to 555-0199 range", () => {
    for (const name of Object.keys(HANDLERS)) {
      const source = readFileSync(join(LAMBDAS, name, "index.mjs"), "utf8");
      for (const m of source.matchAll(/\d{10}/g)) expect(m[0], name).toMatch(/^\d{3}55501\d\d$/);
    }
  });
});

describe("caller-lookup", () => {
  it("knows Mrs. Alder", async () => {
    expect(await callerLookup.handler(event({}, ALDER))).toEqual({
      callerName: "Mrs. Alder",
      status: "known",
      tier: "resident",
      homeDistrict: "old-town",
      accountName: "none",
      found: "true",
    });
  });

  it("knows the hotel as a business account", async () => {
    expect(await callerLookup.handler(event({}, HOTEL))).toMatchObject({
      status: "account",
      tier: "account",
      accountName: "The Wexmoor Grand",
    });
  });

  it("reads any formatting of the number, and a callerNumber parameter first", async () => {
    expect((await callerLookup.handler(event({}, "(413) 555-0142"))).callerName).toBe("Mrs. Alder");
    expect((await callerLookup.handler(event({ callerNumber: THEO }, ALDER))).callerName).toBe(
      "Theo",
    );
  });

  it("treats anyone else, or no number, as a new caller", async () => {
    for (const address of [STRANGER, null, "anonymous", "+1555"]) {
      expect(await callerLookup.handler(event({}, address)), String(address)).toMatchObject({
        status: "new",
        found: "false",
      });
    }
  });
});

describe("classify-apparition: routing", () => {
  it("names the district crew for grades 1 to 3 and the Lantern Crew for 4 and 5", async () => {
    const restless = await classify.handler(
      event({ movesObjects: "1", sounds: "1", district: "old-town" }),
    );
    expect(restless).toMatchObject({ grade: "2", crewQueue: "old-town-crew" });
    const hostile = await classify.handler(
      event({ canSee: "1", touchedYou: "1", sounds: "1", coldSpot: "1", district: "old-town" }),
    );
    expect(hostile).toMatchObject({ grade: "4", crewQueue: "lantern-crew" });
  });

  it("says district when no district is known yet, and ignores a malformed one", async () => {
    expect((await classify.handler(event({ sounds: "1" }))).crewQueue).toBe("district");
    expect((await classify.handler(event({ district: "Old Town!" }))).crewQueue).toBe("district");
  });

  it("reads answers from contact attributes when no parameter is passed", async () => {
    const out = await classify.handler(event({}, STRANGER, { canSee: "1", multiple: "1" }));
    expect(out).toMatchObject({ score: "5", grade: "3", answered: "2" });
  });

  it("counts answers given, so a flow can tell an empty interview from all noes", async () => {
    expect((await classify.handler(event())).answered).toBe("0");
    expect(
      (await classify.handler(event(Object.fromEntries(classify.SIGNALS.map(([n]) => [n, "2"])))))
        .answered,
    ).toBe("6");
  });
});

describe("plane-check", () => {
  it("puts 555-0190 to 555-0199 beyond, and everyone else among the living", async () => {
    expect(await planeCheck.handler(event({}, DEPARTED))).toEqual({
      plane: "beyond",
      reason: "reserved-range",
    });
    expect(await planeCheck.handler(event({}, "+14135550190"))).toMatchObject({ plane: "beyond" });
    expect(await planeCheck.handler(event({}, "+14135550189"))).toMatchObject({ plane: "living" });
    expect(await planeCheck.handler(event({}, ALDER))).toEqual({
      plane: "living",
      reason: "ordinary-number",
    });
    expect(await planeCheck.handler(event({}, null))).toEqual({
      plane: "living",
      reason: "no-number",
    });
  });

  it("takes the caller's word for it (press 9)", async () => {
    expect(await planeCheck.handler(event({ claimsBeyond: "1" }, ALDER))).toEqual({
      plane: "beyond",
      reason: "caller-said-so",
    });
  });
});

describe("prank-score", () => {
  const allYes = Object.fromEntries(prankScore.ANSWERS.map((a) => [a, "1"]));

  it("scores a known dare number high and an ordinary caller low", async () => {
    expect(await prankScore.handler(event({}, THEO))).toEqual({
      score: "50",
      verdict: "high",
      reason: "known-number",
    });
    expect(await prankScore.handler(event({}, ALDER))).toEqual({
      score: "0",
      verdict: "low",
      reason: "none",
    });
  });

  it("adds everything-at-once and menu loops, and sums them", async () => {
    expect(await prankScore.handler(event(allYes, ALDER))).toMatchObject({
      score: "30",
      verdict: "low",
    });
    expect(await prankScore.handler(event({ ...allYes, menuResets: "3" }, ALDER))).toEqual({
      score: "50",
      verdict: "high",
      reason: "everything-at-once-and-menu-loops",
    });
    expect((await prankScore.handler(event({ ...allYes, menuResets: "4" }, THEO))).score).toBe(
      "100",
    );
  });

  it("never screens out a caller who says someone is hurt", async () => {
    expect(
      await prankScore.handler(event({ ...allYes, anyoneHurt: "1", menuResets: "9" }, THEO)),
    ).toEqual({
      score: "0",
      verdict: "low",
      reason: "safety-first",
    });
  });
});

describe("district-for-address", () => {
  it("places street words in their district", async () => {
    expect(await districtForAddress.handler(event({ address: "4 Lighthouse Pier" }))).toEqual({
      district: "harborside",
      districtName: "Harborside",
      matchedBy: "street",
    });
    expect((await districtForAddress.handler(event({ address: "Chapel Row" }))).district).toBe(
      "graveyard-hill",
    );
    expect((await districtForAddress.handler(event({ address: "9 Market Square" }))).district).toBe(
      "old-town",
    );
  });

  it("falls back to the postcode, then to the first district", async () => {
    const n = loadDistricts().length;
    const second = loadDistricts()[1]?.slug;
    expect(await districtForAddress.handler(event({ postcode: String(n + 1) }))).toMatchObject({
      district: second,
      matchedBy: "postcode",
    });
    expect(await districtForAddress.handler(event({ address: "somewhere" }))).toMatchObject({
      district: loadDistricts()[0]?.slug,
      matchedBy: "default",
    });
  });

  it("ignores a street word whose district is not configured", async () => {
    process.env.HH_DISTRICTS = JSON.stringify([{ slug: "old-town", name: "Old Town" }]);
    expect(await districtForAddress.handler(event({ address: "Harbor Lane" }))).toMatchObject({
      district: "old-town",
      matchedBy: "street",
    });
  });

  it("answers unknown when the environment gives it no districts", async () => {
    for (const value of ["", "not json", "{}"]) {
      process.env.HH_DISTRICTS = value;
      expect(await districtForAddress.handler(event({ address: "Wharf" })), value).toEqual({
        district: "unknown",
        districtName: "unknown",
        matchedBy: "none",
      });
    }
  });
});

describe("crew-eta", () => {
  it("is a base per district plus five minutes per caller ahead", async () => {
    expect(await crewEta.handler(event({ district: "old-town", queueSize: "0" }))).toEqual({
      etaMinutes: "20",
      etaBand: "soon",
      crewName: "The Old Town crew",
      message: "The Old Town crew can be with you in about 20 minutes.",
    });
    expect(
      (await crewEta.handler(event({ district: "harborside", queueSize: "3" }))).etaMinutes,
    ).toBe("40");
    expect(
      (await crewEta.handler(event({ district: "graveyard-hill", queueSize: "7" }))).etaBand,
    ).toBe("later");
  });

  it("caps the estimate, and reads a missing or odd queue size as zero", async () => {
    expect(
      (await crewEta.handler(event({ district: "old-town", queueSize: "500" }))).etaMinutes,
    ).toBe("90");
    expect(
      (await crewEta.handler(event({ district: "old-town", queueSize: "lots" }))).etaMinutes,
    ).toBe("20");
    expect(
      (await crewEta.handler(event({ district: "old-town", queueSize: "-4" }))).etaMinutes,
    ).toBe("20");
  });

  it("says a crew when the district is unknown", async () => {
    expect((await crewEta.handler(event({ district: "nowhere" }))).crewName).toBe("A crew");
  });

  it("bands at 30 and 60 minutes", () => {
    expect([30, 31, 60, 61].map(crewEta.bandFor)).toEqual([
      "soon",
      "within-the-hour",
      "within-the-hour",
      "later",
    ]);
  });
});
