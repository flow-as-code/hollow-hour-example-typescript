#!/usr/bin/env node
/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// npm run validate: `tofu init -backend=false` and `tofu validate` of every
// environment root, each with the flows.tf its profile emits in place:
// envs/dev, envs/qa and envs/prod with their own profile, envs/prod again with
// prod-october, and the three seasonal roots with the greetings.
//
// It works on a temporary copy of the roots (with lambdas/ and
// districts.config.json beside them, which the roots read) and emits into that
// copy itself, so it passes from a fresh clone with nothing emitted, never
// writes to envs/, and cannot be fooled by a stale flows.tf there. The
// committed .terraform.lock.hcl of each root is copied too, so init checks
// the providers against the reviewed hashes. tests/validate.test.ts does the
// same inside `npm test` when OpenTofu is on PATH.
//
// Needs `tofu` on PATH (OpenTofu 1.10 or later, the flowascode provider's
// floor) and the registry the first time; providers are cached in
// .tofu-cache/. No credentials, no backend, no AWS call.

import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = join(ROOT, "node_modules", "@flow-as-code", "cli", "dist", "bin.js");
const TOFU = process.env.TOFU ?? "tofu";
const cache = join(ROOT, ".tofu-cache");
mkdirSync(cache, { recursive: true });
const env = { ...process.env, TF_PLUGIN_CACHE_DIR: cache, TF_IN_AUTOMATION: "1" };

/** Each root to validate: the directory it is copied from, and what is emitted into it. */
const ROOTS = [
  { name: "dev", from: "dev", set: "flows", profile: "dev" },
  { name: "qa", from: "qa", set: "flows", profile: "qa" },
  { name: "prod", from: "prod", set: "flows", profile: "prod" },
  { name: "prod-october", from: "prod", set: "flows", profile: "prod-october" },
  { name: "seasonal-dev", from: "seasonal-dev", set: "seasonal" },
  { name: "seasonal-qa", from: "seasonal-qa", set: "seasonal" },
  { name: "seasonal-prod", from: "seasonal-prod", set: "seasonal" },
];

// A stale map would validate yesterday's bindings, so refuse first.
const check = spawnSync("npx", ["--no-install", "tsx", "generators/districts.ts", "--check"], {
  cwd: ROOT,
  stdio: "inherit",
});
if (check.status !== 0) process.exit(check.status ?? 1);

const work = mkdtempSync(join(tmpdir(), "hh-validate-"));
let failed = false;
try {
  const tree = join(work, "tree");
  mkdirSync(join(tree, "envs"), { recursive: true });
  copyFileSync(join(ROOT, "districts.config.json"), join(tree, "districts.config.json"));
  cpSync(join(ROOT, "lambdas"), join(tree, "lambdas"), { recursive: true });

  for (const root of ROOTS) {
    const dir = join(tree, "envs", root.name);
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(join(ROOT, "envs", root.from))) {
      if ((f.endsWith(".tf") && f !== "flows.tf") || f === ".terraform.lock.hcl") {
        copyFileSync(join(ROOT, "envs", root.from, f), join(dir, f));
      }
    }
    const out = join(work, "emit", root.name);
    const args = [CLI, "emit", root.set, "--target", "flowascode", "--out", out];
    if (root.profile !== undefined) {
      args.push("--address-map", join("refs", `${root.profile}.tfmap.json`));
    }
    const emit = spawnSync(process.execPath, args, {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "inherit"],
    });
    if (emit.status !== 0) {
      console.error(`envs/${root.from}: emitting ${root.set}/ failed.`);
      process.exit(emit.status ?? 1);
    }
    copyFileSync(join(out, "flows.tf"), join(dir, "flows.tf"));
  }

  for (const root of ROOTS) {
    const dir = join(tree, "envs", root.name);
    const label = root.profile === undefined ? "" : ` with the ${root.profile} emit`;
    console.log(`envs/${root.from}${label}:`);
    for (const args of [
      ["init", "-backend=false", "-input=false", "-lockfile=readonly", "-no-color"],
      ["validate", "-no-color"],
    ]) {
      const result = spawnSync(TOFU, [`-chdir=${dir}`, ...args], { env, stdio: "inherit" });
      if (result.error) {
        console.error(`cannot run ${TOFU}: ${result.error.message}`);
        process.exit(2);
      }
      if (result.status !== 0) {
        failed = true;
        break;
      }
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
