/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// `npm run generate`: everything derived from districts.config.json and
// refs/manifest.json (see generate.ts): the per-profile address maps, and
// hh-district-<slug> plus hh-queue-experience-<slug> (FlowDoc and companion)
// in flows/. `--check` writes nothing and exits 1 when a derived file on disk
// differs from what this would write, or a generated flow no district
// produces is still there, which is how CI holds the tree clean.

import { loadDistricts, ROOT } from "./config.js";
import { generate, type GenerateResult } from "./generate.js";

const check = process.argv.includes("--check");

let result: GenerateResult;
try {
  result = generate(ROOT, { check });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (check && (result.changed.length > 0 || result.orphaned.length > 0)) {
  const lines = [
    ...result.changed.map((p) => `${p} (stale)`),
    ...result.orphaned.map((p) => `${p} (no district generates it)`),
  ];
  console.error(`Generated files out of date (run npm run generate):\n  ${lines.join("\n  ")}`);
  process.exit(1);
}
const districts = loadDistricts().length;
console.log(
  check
    ? `${String(result.total)} generated file(s) up to date.`
    : `${String(result.total)} generated file(s) for ${String(districts)} district(s): ${String(result.changed.length)} written, ${String(result.orphaned.length)} removed.`,
);
