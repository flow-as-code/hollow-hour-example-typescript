/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// The address maps are derived from refs/manifest.json and districts.config.json,
// and the environments may differ only where the design says they do.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadDistricts, type District } from "../generators/config.js";
import {
  addressMap,
  expandAll,
  loadManifest,
  manifestProblems,
  mapPath,
  REF_TYPES,
  serializeMap,
} from "../generators/refs.js";

const manifest = loadManifest();
const districts = loadDistricts();
const profiles = Object.keys(manifest.profiles);
const maps = Object.fromEntries(profiles.map((p) => [p, addressMap(manifest, districts, p)]));
const hoursKeys = districts.map((d) => `hours:${d.slug}`).sort();

/** The keys whose values differ between two profiles' maps. */
function differing(a: string, b: string): string[] {
  const left = maps[a] ?? {};
  const right = maps[b] ?? {};
  return Object.keys(left)
    .filter((k) => left[k] !== right[k])
    .sort();
}

describe("refs/manifest.json", () => {
  it("is well formed", () => {
    expect(manifestProblems(manifest)).toEqual([]);
  });

  it("names the four deploy profiles over three environments", () => {
    expect(manifest.profiles).toEqual({
      dev: { environment: "dev", season: "standard" },
      qa: { environment: "qa", season: "standard" },
      prod: { environment: "prod", season: "standard" },
      "prod-october": { environment: "prod", season: "october" },
    });
  });

  it("settles a key for all eight reference types", () => {
    const types = new Set(manifest.refs.map((e) => e.key.split(":")[0]));
    expect([...types].sort()).toEqual([...REF_TYPES].sort());
  });

  it("lists the Tier 1 and Tier 2 keys the design names", () => {
    const keys = new Set(expandAll(manifest, districts).map((e) => e.key));
    for (const key of [
      "queue:old-town-crew",
      "queue:harborside-crew",
      "queue:graveyard-hill-crew",
      "queue:lantern-crew",
      "queue:the-dead",
      "queue:dispatch-overflow",
      "hours:old-town",
      "hours:the-dead",
      "lambda:caller-lookup",
      "lambda:classify-apparition",
      "lambda:crew-eta",
      "lambda:plane-check",
      "lambda:prank-score",
      "lambda:district-for-address",
      "module:greeting@live",
      "prompt:salt-line-tips",
      "flow:hh-district-old-town",
      "flow:hh-queue-experience-graveyard-hill",
      "flow:hh-customer-whisper",
      "flow:hh-agent-whisper",
      "flow:hh-dead-line",
      "module:hh-collect-address",
      "module:hh-offer-callback",
    ]) {
      expect(keys, key).toContain(key);
    }
  });

  it("keeps the stretch and Tier 3 keys out of every map", () => {
    for (const map of Object.values(maps)) {
      expect(Object.keys(map)).not.toContain("lex:apparition-id");
      expect(Object.keys(map)).not.toContain("view:field-guide");
    }
  });

  it("refuses a malformed entry, so the check above means something", () => {
    const broken = {
      ...manifest,
      refs: [
        ...manifest.refs,
        { key: "flow:district-x", tier: 1 as const, binding: "in-set" as const, usedBy: [] },
        { key: "queue:x", tier: 1 as const, binding: "address-map" as const, usedBy: [] },
        { key: "ghost:x", tier: 2 as const, binding: "in-set" as const, usedBy: [] },
      ],
    };
    expect(manifestProblems(broken)).toEqual([
      "flow:district-x: in-set flows and modules carry the constant hh- name prefix",
      "queue:x: needs address.default",
      'ghost:x: "ghost" is not a reference type',
      "ghost:x: in-set flows and modules carry the constant hh- name prefix",
    ]);
  });
});

describe("refs/<profile>.tfmap.json", () => {
  it("is exactly what npm run generate writes", () => {
    for (const profile of profiles) {
      expect(readFileSync(mapPath(profile), "utf8"), profile).toBe(
        serializeMap(maps[profile] ?? {}),
      );
    }
  });

  it("has the same keys in every profile", () => {
    const keys = Object.keys(maps.dev ?? {});
    expect(keys.length).toBeGreaterThan(0);
    for (const profile of profiles) expect(Object.keys(maps[profile] ?? {})).toEqual(keys);
  });

  it("carries no in-set key: the emitter binds those itself", () => {
    for (const map of Object.values(maps)) {
      expect(Object.keys(map).filter((k) => /^(flow|module):hh-/.test(k))).toEqual([]);
    }
  });

  it("holds Terraform addresses, never an ARN or a placeholder", () => {
    for (const map of Object.values(maps)) {
      for (const value of Object.values(map)) {
        expect(value).not.toMatch(/arn:aws/);
        expect(value).not.toMatch(/TODO/);
        expect(value).toMatch(
          /^(data\.)?[a-z0-9_]+\.[a-z0-9_]+(\["[a-z0-9-]+"\])?(\.[a-z0-9_]+)+$/,
        );
      }
    }
  });
});

describe("the environments differ only where the design says", () => {
  it("qa binds exactly what prod binds (each in its own instance)", () => {
    expect(differing("qa", "prod")).toEqual([]);
  });

  it("dev differs from qa and prod only in the district crews' hours", () => {
    expect(differing("dev", "qa")).toEqual(hoursKeys);
    expect(differing("dev", "prod")).toEqual(hoursKeys);
  });

  it("the October season is the district hours plus the greeting, nothing else", () => {
    expect(differing("prod", "prod-october")).toEqual(
      [...hoursKeys, "module:greeting@live"].sort(),
    );
  });
});

describe("adding a district", () => {
  it("adds exactly its crew queue and hours to every map, and changes nothing else", () => {
    const more: District[] = [
      ...districts,
      { slug: "saltmarsh", name: "Saltmarsh", overflowTo: "harborside" },
    ];
    for (const profile of profiles) {
      const before = maps[profile] ?? {};
      const after = addressMap(manifest, more, profile);
      const added = Object.keys(after).filter((k) => !(k in before));
      expect(added.sort()).toEqual(["hours:saltmarsh", "queue:saltmarsh-crew"]);
      for (const [k, v] of Object.entries(before)) expect(after[k]).toBe(v);
    }
  });
});
