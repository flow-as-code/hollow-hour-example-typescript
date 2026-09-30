/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// Which modeled action types and reference types the flows use so far. The
// showcase aims to use all of them by Tier 3; until then this reports what is
// missing and does not fail on it. It fails on what should never happen: an
// action type the catalog does not model (a GenericBlock) without an entry in
// ALLOWED_GENERIC saying why.

import { collectRefs, modeledTypes } from "@flow-as-code/core";
import { describe, expect, it } from "vitest";
import { loadAll } from "../generators/flowset.js";
import { REF_TYPES } from "../generators/refs.js";

/** Unmodeled types a flow may carry as a GenericBlock, each with its reason. Tier 1 has none. */
const ALLOWED_GENERIC: Record<string, string> = {};

const docs = loadAll().map((l) => l.doc);
const usedTypes = new Map<string, Set<string>>();
for (const d of docs) {
  for (const a of d.content.Actions) {
    usedTypes.set(a.Type, (usedTypes.get(a.Type) ?? new Set()).add(d.name));
  }
}
const modeled = modeledTypes().sort();
const usedRefTypes = new Set(docs.flatMap((d) => collectRefs(d.content).map((r) => r.type)));

describe("coverage", () => {
  it("reports the modeled action types used and missing", () => {
    const used = modeled.filter((t) => usedTypes.has(t));
    const missing = modeled.filter((t) => !usedTypes.has(t));
    const lines = [
      `Modeled action types used: ${String(used.length)} of ${String(modeled.length)}`,
      ...used.map((t) => `  used     ${t} (${[...(usedTypes.get(t) ?? [])].sort().join(", ")})`),
      ...missing.map((t) => `  missing  ${t}`),
      `Reference types used: ${String(usedRefTypes.size)} of ${String(REF_TYPES.length)}`,
      ...REF_TYPES.map((r) => `  ${usedRefTypes.has(r) ? "used   " : "missing"}  ${r}`),
    ];
    console.log(lines.join("\n"));
    expect(used.length + missing.length).toBe(modeled.length);
  });

  it("uses no unmodeled action type without a recorded reason", () => {
    const generic = [...usedTypes.keys()].filter(
      (t) => !modeled.includes(t) && !(t in ALLOWED_GENERIC),
    );
    expect(generic).toEqual([]);
  });

  it("uses only the eight reference types the catalog defines", () => {
    expect([...usedRefTypes].filter((r) => !(REF_TYPES as readonly string[]).includes(r))).toEqual(
      [],
    );
  });
});
