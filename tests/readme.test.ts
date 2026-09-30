/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// T1 criterion 11: the README shows the keypad scene and the dev, qa, prod
// comparison. Both are checked against their sources, so neither can quietly
// disappear or drift: the scene against scenario S2 and the flows, the
// comparison against the derived address maps.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDistricts, ROOT } from "../generators/config.js";
import { addressMap, loadManifest } from "../generators/refs.js";

const readme = readFileSync(join(ROOT, "README.md"), "utf8");

function section(heading: string): string {
  const start = readme.indexOf(`\n## ${heading}\n`);
  expect(start, `README.md has "## ${heading}"`).toBeGreaterThan(-1);
  const rest = readme.slice(start + heading.length + 5);
  const end = rest.indexOf("\n## ");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("README.md", () => {
  it("walks through the keypad scene as S2 plays it", () => {
    const scene = section("Scene 1: the keypad");
    const s2 = JSON.parse(
      readFileSync(join(ROOT, "scenarios", "s2-keypad-restless-old-town.scenario.json"), "utf8"),
    ) as { steps: { kind: string; contains?: string; value?: string; path?: string }[] };
    expect(scene).toContain("s2-keypad-restless-old-town");
    for (const step of s2.steps) {
      if (step.kind === "expect-prompt" && step.contains !== undefined) {
        expect(scene.toLowerCase(), step.contains).toContain(step.contains.toLowerCase());
      }
    }
    const asserted = s2.steps.filter((s) => s.kind === "assert").map((s) => s.value ?? "");
    for (const value of asserted.filter((v) => v !== "2")) expect(scene).toContain(value);
  });

  describe("compares the environments as the maps bind them", () => {
    const text = section("Three environments, compared");
    const manifest = loadManifest();
    const districts = loadDistricts();
    const map = (p: string) => addressMap(manifest, districts, p);

    it("says qa and prod are identical, and they are", () => {
      expect(map("qa")).toEqual(map("prod"));
      expect(text).toContain("byte-identical");
    });

    // Every line the README shows is a real change, and every real change is
    // of the kind the prose names, so a new district (one more hours line)
    // needs no README edit to stay green.
    it.each([
      ["dev", "prod", /^hours:/],
      ["prod", "prod-october", /^hours:|^module:greeting@live$/],
    ] as const)("shows only real changes between %s and %s, of the kind it names", (a, b, kind) => {
      const from = map(a);
      const to = map(b);
      const changed = Object.keys(to).filter((k) => from[k] !== to[k]);
      expect(changed.length).toBeGreaterThan(0);
      for (const k of changed) expect(k).toMatch(kind);
      const block = text.split(`${a} against ${b}`)[1]?.split("```diff")[1]?.split("```")[0] ?? "";
      const shown = block.split("\n").filter((l) => /^[-+] /.test(l));
      expect(shown.length).toBeGreaterThan(0);
      for (const l of shown) {
        const m = /^([-+]) {2}"([^"]+)": "([^"]+)",$/.exec(l);
        expect(m, l).not.toBeNull();
        const [, sign, key, value] = m ?? [];
        expect(changed, l).toContain(key);
        expect(value, l).toBe(sign === "-" ? from[key ?? ""] : to[key ?? ""]);
      }
      if (changed.includes("module:greeting@live")) expect(block).toContain("module:greeting@live");
    });
  });

  it("does not describe the repository as a scaffold any more", () => {
    expect(readme).not.toMatch(/Status: \*\*scaffold\*\*/);
  });
});
