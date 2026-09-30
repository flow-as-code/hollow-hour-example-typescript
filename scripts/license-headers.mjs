#!/usr/bin/env node
/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// Applies or verifies the Apache-2.0 header on every source file.
//
// The copyright holder is deliberately entity-neutral and lives in exactly one
// place: the HOLDER constant below. Do not write a legal entity name into
// individual files; if the name ever changes, change this string and run
// `npm run headers:fix`.

import { readFileSync, writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HOLDER = "The flow-as-code Authors";
const YEAR = "2026";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
// Dependencies, build output and gitignored scratch, plus the two directories
// whose .ts files are codegen output: a generated companion is rewritten on
// every regeneration, so a header added by hand would be a diff the generator
// then removes. The generator stamps its own banner instead.
const SKIP_DIRS = new Set([
  "node_modules",
  "flows",
  "seasonal",
  "build",
  "coverage",
  ".git",
  ".claude",
  ".vitest",
  ".terraform",
]);
const EXTS = new Set([".ts", ".tsx", ".mjs", ".js"]);

const HEADER = `/*\n * Copyright ${YEAR} ${HOLDER}\n * SPDX-License-Identifier: Apache-2.0\n */\n`;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.has(extname(entry))) out.push(full);
  }
  return out;
}

// A file is compliant if it carries an SPDX Apache-2.0 tag in its opening
// comment. Matching on SPDX rather than the holder string means a rename does
// not have to be atomic with this check.
function hasHeader(src) {
  return /SPDX-License-Identifier:\s*Apache-2\.0/.test(src.slice(0, 500));
}

function addHeader(src) {
  // Preserve a shebang as the first line.
  if (src.startsWith("#!")) {
    const nl = src.indexOf("\n");
    return src.slice(0, nl + 1) + HEADER + src.slice(nl + 1);
  }
  return HEADER + src;
}

const fix = process.argv.includes("--fix");
const files = walk(ROOT);
const missing = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (hasHeader(src)) continue;
  if (fix) writeFileSync(file, addHeader(src));
  else missing.push(relative(ROOT, file));
}

if (missing.length > 0) {
  console.error(`Missing Apache-2.0 header in ${missing.length} file(s):`);
  for (const f of missing) console.error(`  ${f}`);
  console.error("\nRun: npm run headers:fix");
  process.exit(1);
}

console.log(
  fix
    ? `Headers applied across ${files.length} file(s).`
    : `All ${files.length} file(s) carry a header.`,
);
