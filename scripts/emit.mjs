#!/usr/bin/env node
/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// npm run emit:<profile>: the deploy artifact for one profile.
//
//   1. flow-cli emit flows/ --target flowascode --address-map refs/<profile>.tfmap.json
//      into build/emit/<profile>/ (the raw tree the invariant tests compare);
//   2. its flows.tf copied into envs/<environment>/, where it is applied from;
//   3. the same for seasonal/ into envs/seasonal-<environment>/.
//
// Only flows.tf is copied: each root declares connect_instance_id itself, so it
// validates with or without emitted content. Both copies are gitignored.
// prod and prod-october share envs/prod; the last emit decides which season an
// apply there deploys, and deploy.yml always emits right before it applies.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const profile = process.argv[2];
const manifest = JSON.parse(readFileSync(join(ROOT, "refs", "manifest.json"), "utf8"));
const settings = manifest.profiles[profile];
if (settings === undefined) {
  console.error(`usage: emit.mjs <${Object.keys(manifest.profiles).join("|")}>`);
  process.exit(2);
}
const { environment } = settings;

function run(args) {
  const result = spawnSync("npx", ["--no-install", ...args], { cwd: ROOT, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const hasFlowDocs = (dir) =>
  existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".flowdoc.json"));

// A stale map would deploy yesterday's bindings, so refuse rather than emit.
run(["tsx", "generators/districts.ts", "--check"]);

function emitInto(sourceDir, addressMap, outDir, rootDir) {
  const source = join(ROOT, sourceDir);
  if (!hasFlowDocs(source)) {
    console.error(`${sourceDir}/ holds no FlowDocs yet (task T1 adds them); nothing to emit.`);
    return false;
  }
  rmSync(join(ROOT, outDir), { recursive: true, force: true });
  mkdirSync(join(ROOT, outDir), { recursive: true });
  const args = ["flow-cli", "emit", sourceDir, "--target", "flowascode", "--out", outDir];
  if (addressMap !== undefined) args.push("--address-map", addressMap);
  run(args);
  copyFileSync(join(ROOT, outDir, "flows.tf"), join(ROOT, rootDir, "flows.tf"));
  console.log(`${outDir}/flows.tf -> ${rootDir}/flows.tf`);
  return true;
}

const seasonal = emitInto(
  "seasonal",
  undefined,
  `build/emit/seasonal-${environment}`,
  `envs/seasonal-${environment}`,
);
const flows = emitInto(
  "flows",
  `refs/${profile}.tfmap.json`,
  `build/emit/${profile}`,
  `envs/${environment}`,
);
if (!seasonal || !flows) process.exit(1);
