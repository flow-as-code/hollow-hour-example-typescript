#!/usr/bin/env node
/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// flow-cli lint over flows/ and over seasonal/. The CLI lints one directory
// per run, and each set is linted whole so cross-document rules can follow
// module references inside it.
//
// T1 criterion 1 is "no findings", warnings included, and flow-cli exits 0 on
// warnings alone, so this reads its JSON report and fails on any finding at
// all. A directory with no FlowDocs is a failure too: both sets exist from T1.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
let failed = false;

for (const dir of ["flows", "seasonal"]) {
  const full = join(ROOT, dir);
  if (!existsSync(full) || !readdirSync(full).some((f) => f.endsWith(".flowdoc.json"))) {
    console.error(`${dir}/: no FlowDocs to lint.`);
    failed = true;
    continue;
  }
  const result = spawnSync("npx", ["--no-install", "flow-cli", "lint", dir, "--format", "json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    process.stderr.write(result.stdout + result.stderr);
    console.error(`${dir}/: flow-cli lint did not produce a JSON report (exit ${result.status}).`);
    failed = true;
    continue;
  }
  const { summary, findings } = report;
  if (summary.total === 0 && result.status === 0) {
    console.log(`${dir}/: no findings.`);
    continue;
  }
  failed = true;
  console.error(
    `${dir}/: ${summary.total} finding(s): ${summary.errors} error(s), ${summary.warnings} warning(s).`,
  );
  for (const f of findings) console.error(`  ${JSON.stringify(f)}`);
}

process.exit(failed ? 1 : 0);
