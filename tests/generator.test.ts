/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// `npm run generate`: idempotent, clean against the committed tree, and
// local in its effect: one more district is exactly two more flows and one
// more key in the generated district menu, with no hand edit anywhere.

import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDistricts, ROOT } from "../generators/config.js";
import { BANNER, derivedFiles, generate, GENERATED_FLOW_FILE } from "../generators/generate.js";

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

/** The inputs and outputs of the generator, copied into a scratch checkout. */
function scratchCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "hollow-hour-example-generate-"));
  temps.push(dir);
  cpSync(join(ROOT, "districts.config.json"), join(dir, "districts.config.json"));
  cpSync(join(ROOT, "refs"), join(dir, "refs"), { recursive: true });
  cpSync(join(ROOT, "flows"), join(dir, "flows"), { recursive: true });
  return dir;
}

function snapshot(dir: string): Map<string, string> {
  return new Map(
    readdirSync(join(dir, "flows"))
      .sort()
      .map((f) => [f, readFileSync(join(dir, "flows", f), "utf8")]),
  );
}

function editConfig(dir: string, edit: (districts: Record<string, string>[]) => void): void {
  const path = join(dir, "districts.config.json");
  const config = JSON.parse(readFileSync(path, "utf8")) as { districts: Record<string, string>[] };
  edit(config.districts);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

describe("generator", () => {
  it("leaves the committed tree clean (what npm run generate:check holds in CI)", () => {
    expect(generate(ROOT, { check: true })).toMatchObject({ changed: [], orphaned: [] });
  });

  it("is deterministic: two runs derive identical bytes", () => {
    expect([...derivedFiles(ROOT)]).toEqual([...derivedFiles(ROOT)]);
  });

  it("is idempotent on disk: a second run writes nothing", () => {
    const dir = scratchCopy();
    generate(dir);
    const first = snapshot(dir);
    expect(generate(dir).changed).toEqual([]);
    expect(snapshot(dir)).toEqual(first);
  });

  it("stamps each generated companion with the banner and each document with its source", () => {
    const generated = readdirSync(join(ROOT, "flows")).filter((f) => GENERATED_FLOW_FILE.test(f));
    // Two flows per district plus hh-district-menu, each a FlowDoc and a companion.
    expect(generated).toHaveLength(2 * (2 * loadDistricts().length + 1));
    for (const f of generated.filter((g) => g.endsWith(".flow.ts"))) {
      const text = readFileSync(join(ROOT, "flows", f), "utf8");
      for (const line of BANNER) expect(text).toContain(line);
    }
    for (const f of generated.filter((g) => g.endsWith(".flowdoc.json"))) {
      const doc = JSON.parse(readFileSync(join(ROOT, "flows", f), "utf8")) as {
        description: string;
      };
      expect(doc.description).toContain("Generated from districts.config.json");
    }
  });

  it("adds exactly two flows for a new district, and changes only the generated menu", () => {
    const dir = scratchCopy();
    const before = snapshot(dir);
    editConfig(dir, (ds) =>
      ds.push({ slug: "lamplight-row", name: "Lamplight Row", overflowTo: "old-town" }),
    );

    const result = generate(dir);
    const after = snapshot(dir);

    const added = [...after.keys()].filter((f) => !before.has(f));
    expect(added.sort()).toEqual([
      "hh-district-lamplight-row.flow.ts",
      "hh-district-lamplight-row.flowdoc.json",
      "hh-queue-experience-lamplight-row.flow.ts",
      "hh-queue-experience-lamplight-row.flowdoc.json",
    ]);
    const changed = [...before.keys()].filter((f) => after.get(f) !== before.get(f));
    expect(changed).toEqual(["hh-district-menu.flow.ts", "hh-district-menu.flowdoc.json"]);
    expect(result.orphaned).toEqual([]);
    // The maps follow by derivation: the district's crew queue and hours, in every profile.
    const mapChanges = result.changed.filter((p) => p.startsWith("refs/"));
    expect(mapChanges.sort()).toEqual([
      "refs/dev.tfmap.json",
      "refs/prod-october.tfmap.json",
      "refs/prod.tfmap.json",
      "refs/qa.tfmap.json",
    ]);
  });

  it("removes a retired district's two flows and nothing else", () => {
    const dir = scratchCopy();
    editConfig(dir, (ds) => {
      ds.splice(
        ds.findIndex((d) => d.slug === "graveyard-hill"),
        1,
      );
      const harborside = ds.find((d) => d.slug === "harborside");
      if (harborside) harborside.overflowTo = "old-town";
    });
    const before = snapshot(dir);
    const result = generate(dir);
    const after = snapshot(dir);
    expect(result.orphaned).toEqual([
      "flows/hh-district-graveyard-hill.flow.ts",
      "flows/hh-district-graveyard-hill.flowdoc.json",
      "flows/hh-queue-experience-graveyard-hill.flow.ts",
      "flows/hh-queue-experience-graveyard-hill.flowdoc.json",
    ]);
    const gone = [...before.keys()].filter((f) => !after.has(f));
    expect(gone).toHaveLength(4);
    // Harborside's two flows change, because its overflow sibling did, and the
    // menu loses a key; Old Town, which overflows to Harborside, keeps both.
    const changed = [...before.keys()].filter(
      (f) => after.has(f) && after.get(f) !== before.get(f),
    );
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((f) => f.includes("-harborside.") || f.includes("-menu."))).toBe(true);
  });
});
