/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// The round-trip invariants flow-as-code holds for its own fixtures, held here
// for every FlowDoc in flows/ and seasonal/:
//
// 1. the companion is exactly codegen(doc), and meta.sourceHash is its hash,
//    so the studio opens each pair in sync;
// 2. synth(companion) reproduces the document, modulo layout and meta;
// 3. a second pass, codegen(synth(companion)), is byte-identical to the
//    companion.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { codegen, serialize, synth, type Flow, type FlowDoc } from "@flow-as-code/core";
import { describe, expect, it } from "vitest";
import { ROOT } from "../generators/config.js";
import { loadAll } from "../generators/flowset.js";

const loaded = loadAll();

/** The document with the parts synth does not own taken out. */
function comparable(doc: FlowDoc): string {
  const { layout: _layout, meta: _meta, ...rest } = doc;
  return serialize(rest as FlowDoc);
}

async function build(companionPath: string): Promise<Flow> {
  const mod = (await import(pathToFileURL(join(ROOT, companionPath)).href)) as Record<
    string,
    unknown
  >;
  const factories = Object.values(mod).filter((v): v is () => Flow => typeof v === "function");
  expect(factories).toHaveLength(1);
  return (factories[0] as () => Flow)();
}

describe("round trip", () => {
  it("covers both sets", () => {
    expect(loaded.some((l) => l.set === "flows")).toBe(true);
    expect(loaded.some((l) => l.set === "seasonal")).toBe(true);
  });

  describe.each(loaded.map((l) => [l.path, l] as const))("%s", (_path, l) => {
    const companion = readFileSync(join(ROOT, l.companionPath), "utf8");

    it("has a companion that is exactly codegen(doc), hashed in meta", () => {
      expect(codegen(l.doc, { previous: companion })).toBe(companion);
      const hash = createHash("sha256").update(companion, "utf8").digest("hex");
      expect(l.doc.meta?.sourceHash).toBe(`sha256:${hash}`);
      expect(l.doc.meta?.sourceKind).toBe("ts");
    });

    it("synthesizes back to the same document, modulo layout and meta", async () => {
      const doc = synth(await build(l.companionPath), { includeMeta: false });
      expect(comparable(doc)).toBe(comparable(l.doc));
    });

    it("is byte-stable on a second codegen pass", async () => {
      const doc = synth(await build(l.companionPath), { includeMeta: false });
      expect(codegen(doc, { previous: companion })).toBe(companion);
    });
  });
});
