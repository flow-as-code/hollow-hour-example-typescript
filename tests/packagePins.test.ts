/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// @flow-as-code/cli and @flow-as-code/core are pinned exactly and together.
// Codegen output in flows/ imports core, and the CLI pins core at its own
// version, so two different versions would mean two different builders.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
const EXACT = /^\d+\.\d+\.\d+$/;

describe("package.json", () => {
  it("is private and floors Node at 22.12", () => {
    expect(pkg.private).toBe(true);
    expect(pkg.engines).toEqual({ node: ">=22.12" });
  });

  it("pins the flow-as-code packages exactly, at one version", () => {
    const cli = pkg.devDependencies["@flow-as-code/cli"];
    const core = pkg.devDependencies["@flow-as-code/core"];
    expect(cli).toMatch(EXACT);
    expect(core).toBe(cli);
  });

  it("resolves every @flow-as-code package in the lockfile to that version", () => {
    const version = pkg.devDependencies["@flow-as-code/cli"];
    const resolved = Object.entries(lock.packages as Record<string, { version?: string }>)
      .filter(([path]) => path.startsWith("node_modules/@flow-as-code/"))
      .map(([path, entry]) => [path, entry.version]);
    expect(resolved.length).toBeGreaterThanOrEqual(2);
    expect(resolved.filter(([, v]) => v !== version)).toEqual([]);
  });

  it("has every script the tasks and workflows call", () => {
    for (const name of [
      "generate",
      "generate:check",
      "lint",
      "lint:flows",
      "typecheck",
      "test",
      "emit:dev",
      "emit:qa",
      "emit:prod",
      "emit:prod-october",
      "validate",
      "headers:fix",
      "check",
    ]) {
      expect(pkg.scripts, name).toHaveProperty([name]);
    }
  });
});
