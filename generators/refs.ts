/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// refs/manifest.json expanded against the districts into one address map per
// deploy profile. The maps are derived, never hand-edited: a key added to the
// manifest reaches every profile at once, so the maps cannot disagree on keys.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, type District } from "./config.js";

export const MANIFEST_PATH = join(ROOT, "refs", "manifest.json");

export type Tier = 1 | 2 | 3 | "stretch";
export type Binding = "address-map" | "in-set";

export interface RefEntry {
  key: string;
  tier: Tier;
  binding: Binding;
  /** `default` plus per-profile overrides. Absent only outside tiers 1 and 2. */
  address?: Record<string, string>;
  usedBy: string[];
  note?: string;
}

export interface Profile {
  environment: "dev" | "qa" | "prod";
  season: "standard" | "october";
}

export interface Manifest {
  profiles: Record<string, Profile>;
  refs: RefEntry[];
}

/** The tiers whose address-map keys are in the maps today. */
export const MAPPED_TIERS: readonly Tier[] = [1, 2];

export const REF_TYPES = [
  "queue",
  "hours",
  "lambda",
  "lex",
  "module",
  "flow",
  "view",
  "prompt",
] as const;

export function loadManifest(path = MANIFEST_PATH): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

/** One manifest entry per district when its key names `{slug}`, else itself. */
export function expand(entry: RefEntry, districts: District[]): RefEntry[] {
  if (!entry.key.includes("{slug}")) return [entry];
  return districts.map((d) => {
    const sub = (s: string) => s.replaceAll("{slug}", d.slug);
    return {
      ...entry,
      key: sub(entry.key),
      address:
        entry.address === undefined
          ? undefined
          : Object.fromEntries(Object.entries(entry.address).map(([k, v]) => [k, sub(v)])),
      usedBy: entry.usedBy.map(sub),
    };
  });
}

export function expandAll(manifest: Manifest, districts: District[]): RefEntry[] {
  return manifest.refs.flatMap((e) => expand(e, districts));
}

export function manifestProblems(manifest: Manifest): string[] {
  const problems: string[] = [];
  const profiles = Object.keys(manifest.profiles);
  const seen = new Set<string>();
  for (const e of manifest.refs) {
    if (seen.has(e.key)) problems.push(`${e.key}: listed twice`);
    seen.add(e.key);
    const type = e.key.split(":")[0];
    if (!(REF_TYPES as readonly string[]).includes(type ?? "")) {
      problems.push(`${e.key}: "${String(type)}" is not a reference type`);
    }
    if (e.binding === "in-set" && e.address !== undefined) {
      problems.push(`${e.key}: an in-set reference is bound by the emitter, not by an address`);
    }
    if (e.binding === "in-set" && !/^(flow|module):hh-/.test(e.key)) {
      problems.push(`${e.key}: in-set flows and modules carry the constant hh- name prefix`);
    }
    if (e.binding === "address-map" && MAPPED_TIERS.includes(e.tier)) {
      if (e.address?.default === undefined) problems.push(`${e.key}: needs address.default`);
      for (const p of Object.keys(e.address ?? {})) {
        if (p !== "default" && !profiles.includes(p)) {
          problems.push(`${e.key}: address names unknown profile "${p}"`);
        }
      }
    }
  }
  return problems;
}

/** A profile's address map: every mapped key, sorted, with that profile's address. */
export function addressMap(
  manifest: Manifest,
  districts: District[],
  profile: string,
): Record<string, string> {
  if (!(profile in manifest.profiles)) throw new Error(`unknown profile "${profile}"`);
  const out: Record<string, string> = {};
  for (const e of expandAll(manifest, districts)) {
    if (e.binding !== "address-map" || !MAPPED_TIERS.includes(e.tier)) continue;
    const value = e.address?.[profile] ?? e.address?.default;
    if (value === undefined) throw new Error(`${e.key}: no address for profile "${profile}"`);
    out[e.key] = value;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function serializeMap(map: Record<string, string>): string {
  return `${JSON.stringify(map, null, 2)}\n`;
}

export function mapPath(profile: string): string {
  return join(ROOT, "refs", `${profile}.tfmap.json`);
}
