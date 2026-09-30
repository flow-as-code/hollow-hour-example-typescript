/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { configProblems, loadDistricts } from "../generators/config.js";

const ok = (overrides: object[] = []) => ({
  districts: [
    { slug: "old-town", name: "Old Town", overflowTo: "harborside" },
    { slug: "harborside", name: "Harborside", overflowTo: "old-town" },
    ...overrides,
  ],
});

describe("districts.config.json", () => {
  // Derived from the file rather than a fixed list, so adding a district is
  // one entry with no test to hand-edit (T1 criterion 5).
  it("holds districts that each overflow to another district in the file", () => {
    const districts = loadDistricts();
    const slugs = new Set(districts.map((d) => d.slug));
    expect(districts.length).toBeGreaterThan(1);
    for (const d of districts) {
      expect(d.overflowTo).not.toBe(d.slug);
      expect(slugs.has(d.overflowTo)).toBe(true);
    }
  });

  it("refuses the reserved menu slug and more districts than the keypad has keys", () => {
    expect(configProblems(ok([{ slug: "menu", name: "Menu", overflowTo: "old-town" }]))).toEqual([
      'districts[2].slug "menu" is reserved (hh-district-menu is generated)',
    ]);
    const many = Array.from({ length: 10 }, (_, i) => ({
      slug: `d${String(i)}`,
      name: `D${String(i)}`,
      overflowTo: `d${String((i + 1) % 10)}`,
    }));
    expect(configProblems({ districts: many })).toEqual([
      "districts holds 10 entries; the keypad menu offers at most 9",
    ]);
  });

  it("accepts a well-formed config, so the refusals below mean something", () => {
    expect(configProblems(ok())).toEqual([]);
  });

  it("refuses an overflow that is implicit, circular to itself, or unknown", () => {
    expect(configProblems(ok([{ slug: "moor", name: "Moor" }]))).toEqual([
      "districts[2].overflowTo must name another district (no implicit ring)",
    ]);
    expect(configProblems(ok([{ slug: "moor", name: "Moor", overflowTo: "moor" }]))).toEqual([
      "districts[2].overflowTo cannot be the district itself",
    ]);
    expect(configProblems(ok([{ slug: "moor", name: "Moor", overflowTo: "fen" }]))).toEqual([
      'districts[2].overflowTo "fen" is not a district in this file',
    ]);
  });

  it("refuses duplicate, malformed or unnamed districts", () => {
    expect(
      configProblems(ok([{ slug: "old-town", name: "Again", overflowTo: "harborside" }])),
    ).toEqual(['districts[2].slug "old-town" appears twice']);
    expect(configProblems(ok([{ slug: "Old_Town", name: "X", overflowTo: "old-town" }]))).toEqual([
      'districts[2].slug must be lowercase and hyphenated, got "Old_Town"',
    ]);
    expect(configProblems(ok([{ slug: "moor", name: " ", overflowTo: "old-town" }]))).toEqual([
      "districts[2].name must be a non-empty string",
    ]);
    expect(configProblems({ districts: [] })).toEqual(["districts must be a non-empty array"]);
  });
});
