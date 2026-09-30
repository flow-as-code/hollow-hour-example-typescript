#!/usr/bin/env node
/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// npm run lock:providers: rewrite each environment root's committed
// .terraform.lock.hcl with the hashes of every platform a deploy or a
// contributor runs on, so `tofu init` in deploy.yml installs only reviewed
// provider builds. Run it after changing a version constraint in a root's
// providers.tf, or to take a provider release inside the constraint (delete
// the lock files first to move them forward), and review the diff like code.
// tests/envRoots.test.ts holds that the roots of each group share one lock
// file.
// https://opentofu.org/docs/cli/commands/providers/lock/

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const TOFU = process.env.TOFU ?? "tofu";
export const PLATFORMS = ["linux_amd64", "linux_arm64", "darwin_amd64", "darwin_arm64"];

const roots = readdirSync(join(ROOT, "envs"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const name of roots) {
  console.log(`envs/${name}:`);
  const result = spawnSync(
    TOFU,
    [
      `-chdir=${join(ROOT, "envs", name)}`,
      "providers",
      "lock",
      ...PLATFORMS.map((p) => `-platform=${p}`),
    ],
    { stdio: "inherit" },
  );
  if (result.error) {
    console.error(`cannot run ${TOFU}: ${result.error.message}`);
    process.exit(2);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
