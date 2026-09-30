/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// districts.config.json: read, and refused loudly when it is not a set the
// generator can turn into flows.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface District {
  /** Lowercase, hyphenated. Becomes part of flow names and Terraform keys. */
  slug: string;
  /** What callers and crews hear. */
  name: string;
  /** The sibling district whose crew takes this district's overflow. */
  overflowTo: string;
}

export const ROOT = join(import.meta.dirname, "..");
export const CONFIG_PATH = join(ROOT, "districts.config.json");

const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The generated district menu is hh-district-menu, so no district may be called that. */
export const RESERVED_SLUGS: readonly string[] = ["menu"];

/** The keypad menu offers one key per district, 1 to 9. */
export const MAX_DISTRICTS = 9;

/** Every problem with a config, at once, so one run names them all. */
export function configProblems(raw: unknown): string[] {
  const problems: string[] = [];
  const list = (raw as { districts?: unknown } | null)?.districts;
  if (!Array.isArray(list) || list.length === 0) {
    return ["districts must be a non-empty array"];
  }
  if (list.length > MAX_DISTRICTS) {
    problems.push(
      `districts holds ${String(list.length)} entries; the keypad menu offers at most ${String(MAX_DISTRICTS)}`,
    );
  }
  const slugs = new Set<string>();
  for (const [i, entry] of list.entries()) {
    const d = entry as Partial<District>;
    const at = `districts[${String(i)}]`;
    if (typeof d.slug !== "string" || !SLUG.test(d.slug)) {
      problems.push(`${at}.slug must be lowercase and hyphenated, got ${JSON.stringify(d.slug)}`);
      continue;
    }
    if (RESERVED_SLUGS.includes(d.slug)) {
      problems.push(`${at}.slug "${d.slug}" is reserved (hh-district-${d.slug} is generated)`);
    }
    if (slugs.has(d.slug)) problems.push(`${at}.slug "${d.slug}" appears twice`);
    slugs.add(d.slug);
    if (typeof d.name !== "string" || d.name.trim() === "") {
      problems.push(`${at}.name must be a non-empty string`);
    }
  }
  for (const [i, entry] of list.entries()) {
    const d = entry as Partial<District>;
    const at = `districts[${String(i)}]`;
    if (typeof d.slug !== "string") continue;
    if (typeof d.overflowTo !== "string") {
      problems.push(`${at}.overflowTo must name another district (no implicit ring)`);
    } else if (d.overflowTo === d.slug) {
      problems.push(`${at}.overflowTo cannot be the district itself`);
    } else if (!slugs.has(d.overflowTo)) {
      problems.push(`${at}.overflowTo "${d.overflowTo}" is not a district in this file`);
    }
  }
  return problems;
}

export function parseConfig(raw: unknown): District[] {
  const problems = configProblems(raw);
  if (problems.length > 0) {
    throw new Error(`districts.config.json:\n  ${problems.join("\n  ")}`);
  }
  return (raw as { districts: District[] }).districts.map(({ slug, name, overflowTo }) => ({
    slug,
    name,
    overflowTo,
  }));
}

export function loadDistricts(path = CONFIG_PATH): District[] {
  return parseConfig(JSON.parse(readFileSync(path, "utf8")));
}
