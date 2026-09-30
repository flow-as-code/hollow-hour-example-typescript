/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// What must never be committed, checked over every text file in the tree:
// ARNs, account ids, real phone numbers, em-dashes, and names borrowed from
// existing ghost-removal fiction or retired by the owner's rename.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "build",
  "coverage",
  ".terraform",
  ".tofu-cache",
  ".vitest",
  ".claude",
]);
// The lockfile is npm's; LICENSE is the Apache text verbatim.
const SKIP_FILES = new Set(["package-lock.json", "LICENSE"]);
const TEXT = new Set([".md", ".json", ".ts", ".mjs", ".js", ".tf", ".yml", ".yaml", ""]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (TEXT.has(extname(entry)) || entry.startsWith(".")) out.push(full);
  }
  return out;
}

const files = walk(ROOT).map((f) => ({
  path: relative(ROOT, f),
  text: readFileSync(f, "utf8"),
}));
// The tests name what they search for; everything else must not contain it.
const authored = files.filter((f) => !f.path.startsWith("tests/"));

function hits(pattern: RegExp, among = authored, allow: (m: string) => boolean = () => false) {
  return among.flatMap(({ path, text }) =>
    [...text.matchAll(pattern)].filter((m) => !allow(m[0])).map((m) => `${path}: ${m[0]}`),
  );
}

describe("nothing that identifies an account or a person", () => {
  it("reads the tree, so an empty scan cannot pass", () => {
    expect(files.map((f) => f.path)).toContain("README.md");
    expect(files.map((f) => f.path)).toContain("envs/dev/supporting.tf");
  });

  it("has no ARN", () => {
    expect(hits(new RegExp(["arn", "aws"].join(":"), "g"))).toEqual([]);
  });

  it("has no twelve-digit account id", () => {
    expect(hits(/(?<![\w.-])\d{12}(?![\w.-])/g, files)).toEqual([]);
  });

  it("has phone numbers only from the fictional 555-0100 to 555-0199 range", () => {
    const phone = /(?:\+?1[-. ]?)?(?:\(?\d{3}\)?[-. ])?\b\d{3}[-. ]\d{4}\b/g;
    const fictional = (m: string) => /555[-. ]01\d\d$/.test(m);
    expect(hits(phone, files, fictional)).toEqual([]);
  });
});

describe("house style and original names", () => {
  it("uses no em-dashes", () => {
    expect(hits(/\u2014/g, files)).toEqual([]);
  });

  it("uses none of the retired or borrowed names", () => {
    const retired = [
      ["Leg", "ion"],
      ["heavy", "containment"],
      ["Black", "wood"],
    ].map(([a, b]) => `${a}[- ]?${b}`);
    expect(hits(new RegExp(retired.join("|"), "gi"))).toEqual([]);
  });

  it("points callers at a local emergency number, not a bare 911", () => {
    const bare = /dial 911|call 911/gi;
    expect(hits(bare)).toEqual([]);
  });
});
