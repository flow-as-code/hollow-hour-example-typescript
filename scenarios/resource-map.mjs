#!/usr/bin/env node
/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// node scenarios/resource-map.mjs <profile>
//
// Writes scenarios/<profile>.resources.json, the --resource-map a
// `flow-cli simulate` run needs, from what is deployed: it reads the flow
// root's state (`tofu -chdir=envs/<environment> show -json`, so run it with
// that root initialized against its backend and credentials in the
// environment) and resolves
//
//   - every key in refs/<profile>.tfmap.json, by evaluating its address
//     against the state, and
//   - flow:<name> for every flowascode_contact_flow, by its name.
//
// The file holds ARNs, so it is gitignored and stays on the operator's
// machine. A key the state lacks (a later tier's resource) is reported; the
// file is written only when every key the scenarios here use is resolved.
//
// Then:
//   npx flow-cli simulate scenarios/ --instance "$INSTANCE_ARN" \
//     --resource-map scenarios/<profile>.resources.json

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * @typedef {{ mode: string, type: string, name: string, index?: string | number,
 *   values?: Record<string, unknown> }} StateResource
 */

/**
 * Every resource in a `show -json` document, child modules included.
 * @param {any} shown
 * @returns {StateResource[]}
 */
export function stateResources(shown) {
  /** @type {StateResource[]} */
  const out = [];
  /** @param {any} module */
  const walk = (module) => {
    if (module === undefined || module === null) return;
    for (const r of module.resources ?? []) out.push(r);
    for (const child of module.child_modules ?? []) walk(child);
  };
  walk(shown?.values?.root_module);
  return out;
}

/**
 * The value an address such as aws_connect_queue.crew["old-town"].arn or
 * data.terraform_remote_state.seasonal.outputs.greeting_standard_live_arn
 * has in the state, or undefined.
 * @param {StateResource[]} resources
 * @param {string} address
 * @returns {string | undefined}
 */
export function resolveAddress(resources, address) {
  const m = /^(data\.)?([a-z0-9_]+)\.([a-z0-9_]+)(?:\["([^"]+)"\])?((?:\.[a-z0-9_]+)+)$/.exec(
    address,
  );
  if (m === null) return undefined;
  const [, data, type, name, key, path] = m;
  const found = resources.find(
    (r) =>
      r.mode === (data ? "data" : "managed") &&
      r.type === type &&
      r.name === name &&
      (key === undefined ? r.index === undefined : r.index === key),
  );
  /** @type {unknown} */
  let value = found?.values;
  for (const part of (path ?? "").slice(1).split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = /** @type {Record<string, unknown>} */ (value)[part];
  }
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The resource map for one profile: every address-map key plus every flow, in-set module and alias.
 * @param {Record<string, string>} addressMap
 * @param {StateResource[]} resources
 * @returns {{ map: Record<string, string>, missing: string[] }}
 */
export function buildResourceMap(addressMap, resources) {
  /** @type {Record<string, string>} */
  const map = {};
  const missing = [];
  for (const [key, address] of Object.entries(addressMap)) {
    const value = resolveAddress(resources, address);
    if (value === undefined) missing.push(`${key} (${address})`);
    else map[key] = value;
  }
  // Every flow, every in-set module (hh-offer-callback since T2) and every
  // alias of one (module:<name>@<alias>), by name: the emitter binds those
  // itself, so no address map names them.
  const managed = resources.filter((r) => r.mode === "managed");
  /** @type {Record<string, "flow" | "module" | undefined>} */
  const kinds = { flowascode_contact_flow: "flow", flowascode_contact_flow_module: "module" };
  /** @type {Map<string, string>} */
  const moduleNames = new Map();
  for (const r of managed) {
    const kind = kinds[r.type];
    if (kind === undefined) continue;
    const name = r.values?.name;
    const arn = r.values?.arn;
    if (typeof name !== "string" || typeof arn !== "string") continue;
    map[`${kind}:${name}`] = arn;
    const moduleId = r.values?.contact_flow_module_id;
    if (kind === "module" && typeof moduleId === "string") moduleNames.set(moduleId, name);
  }
  for (const r of managed) {
    if (r.type !== "flowascode_contact_flow_module_alias") continue;
    const module = moduleNames.get(String(r.values?.contact_flow_module_id));
    const alias = r.values?.name;
    const arn = r.values?.arn;
    if (module !== undefined && typeof alias === "string" && typeof arn === "string") {
      map[`module:${module}@${alias}`] = arn;
    }
  }
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { map: sorted, missing };
}

/**
 * The type:name keys the scenario files in a directory refer to.
 * @param {string} dir
 * @returns {Set<string>}
 */
export function scenarioKeys(dir) {
  const keys = new Set();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".scenario.json"))) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const m of text.matchAll(/\$\{cdref:([a-z]+:[a-z0-9@-]+)\}/g)) keys.add(m[1]);
  }
  return keys;
}

function main() {
  const profile = process.argv[2];
  const manifest = JSON.parse(readFileSync(join(ROOT, "refs", "manifest.json"), "utf8"));
  const settings = profile === undefined ? undefined : manifest.profiles[profile];
  if (settings === undefined) {
    console.error(`usage: resource-map.mjs <${Object.keys(manifest.profiles).join("|")}>`);
    process.exit(2);
  }
  const addressMap = JSON.parse(readFileSync(join(ROOT, "refs", `${profile}.tfmap.json`), "utf8"));
  const tofu = process.env.TOFU ?? "tofu";
  const shown = spawnSync(
    tofu,
    [`-chdir=${join(ROOT, "envs", settings.environment)}`, "show", "-json"],
    {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (shown.status !== 0) {
    console.error(shown.stderr || `${tofu} show -json failed`);
    process.exit(1);
  }
  const { map, missing } = buildResourceMap(addressMap, stateResources(JSON.parse(shown.stdout)));
  if (missing.length > 0) {
    console.error(`not in the ${settings.environment} state:\n  ${missing.join("\n  ")}`);
  }
  const needed = [...scenarioKeys(join(ROOT, "scenarios"))].filter((k) => !(k in map));
  if (needed.length > 0) {
    console.error(`the scenarios need, and the state lacks: ${needed.join(", ")}`);
    process.exit(1);
  }
  const out = join(ROOT, "scenarios", `${profile}.resources.json`);
  writeFileSync(out, `${JSON.stringify(map, null, 2)}\n`);
  console.error(`${Object.keys(map).length} references -> ${out}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
