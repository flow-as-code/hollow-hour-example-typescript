#!/usr/bin/env node
/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// npm run drift -- <profile>
//
// Compares every FlowDoc in flows/ and seasonal/ with the flow or module of
// the same name on the profile's instance, action by action, and exits 1 on
// any difference. It is the drift check to use until `flow-cli diff` can be
// told how the flows' reference keys map to the deployed resources: 0.2.0
// turns each live ARN into a token named after the physical resource
// (`queue:hh-dev-old-town-crew`) while the FlowDocs use the logical key
// (`queue:old-town-crew`), so it reports every token-bearing flow as changed
// when nothing is.
//
// Both sides are normalized before they are compared:
//
//   - with scenarios/<profile>.resources.json present (written by
//     `node scenarios/resource-map.mjs <profile>`), each `${cdref:<key>}` and
//     each ARN becomes `${ref:<keys>}`, the sorted keys that the map binds to
//     that ARN, so a reference that points at another resource is drift.
//     What the map does not bind keeps its identity: a token becomes
//     `${ref:<type>:<name>:unmapped}` and an ARN
//     `${ref:<type>:unmapped:<first 12 hex of its SHA-256>}`, so an unmapped
//     token never equals an unmapped ARN, and two unmapped ARNs differ;
//   - without it, each becomes `${ref:<type>}` (queue, hours, flow, module,
//     lambda, ...), which catches every change except a reference moved to
//     another resource of the same type.
//
// No ARN or id is printed: every value shown has been normalized, and an
// error message has its ARNs, account ids and resource ids redacted. `Metadata`
// (canvas layout) is ignored. Nothing is written; the only calls are
// ListContactFlows, ListContactFlowModules, DescribeContactFlow and
// DescribeContactFlowModule.
//
// Those calls share one throttle bucket per account and Region, whatever the
// instance or caller: 2 requests per second with a burst of 5 for these
// operations (https://docs.aws.amazon.com/connect/latest/adminguide/amazon-connect-service-limits.html#connect-api-quotas).
// On 2026-09-30 a dev run was refused with "Too Many Requests". So every
// call goes through `pacedSender`: at most one request per PACE_MS, and a
// throttling refusal (TooManyRequestsException, ThrottlingException, HTTP 429)
// is retried with capped exponential backoff and full jitter, up to RETRIES
// times, before the error is reported. The SDK's own retries stay as they are
// underneath; this is the outer bound.
//
// The instance comes from TF_VAR_connect_instance_id and TF_VAR_aws_region
// (what a deploy exports), else from the gitignored .live/instances.json,
// keyed by environment: { "<environment>": { "id": ..., "region": ... } }.
// Credentials come from the SDK's default chain (AWS_PROFILE included).

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// Built from parts so this file never holds an ARN prefix itself.
const ARN = new RegExp(["arn", "aws[\\w-]*"].join(":") + ":[\\w-]+:[\\w-]*:\\d*:[^\\s\"'}]+", "g");
const TOKEN = /\$\{cdref:([a-z]+):([^}]+)\}/g;

/** Connect ARN resource segments, by the reference type the flows use. */
const CONNECT_TYPES = /** @type {Record<string, string>} */ ({
  queue: "queue",
  "operating-hours": "hours",
  "contact-flow": "flow",
  "flow-module": "module",
  prompt: "prompt",
  agent: "agent",
});

/**
 * The reference type an ARN names: `queue`, `hours`, `lambda`, ...
 * @param {string} arn
 */
export function arnType(arn) {
  const [, , service = "", , , ...rest] = arn.split(":");
  const resource = rest.join(":");
  if (service === "lambda") return "lambda";
  if (service === "connect") {
    const segment = resource.split("/")[2];
    if (segment !== undefined) return CONNECT_TYPES[segment] ?? segment;
    return "instance";
  }
  return service;
}

/**
 * ARN to the sorted reference keys that bind it, from a resource map
 * (`{ "<type>:<name>": "<ARN>" }`).
 * @param {Record<string, string>} map
 * @returns {Map<string, string>}
 */
export function labels(map) {
  /** @type {Map<string, string[]>} */
  const byArn = new Map();
  for (const [key, arn] of Object.entries(map)) {
    byArn.set(arn, [...(byArn.get(arn) ?? []), key]);
  }
  return new Map([...byArn].map(([arn, keys]) => [arn, keys.sort().join(",")]));
}

/**
 * A copy of `value` with every `${cdref:...}` token and every ARN inside a
 * string replaced by its normalized `${ref:...}` form, and every `Metadata`
 * key dropped.
 * @param {unknown} value
 * @param {Record<string, string>} [map] reference key to ARN, when known
 * @returns {unknown}
 */
export function normalize(value, map) {
  const byArn = map === undefined ? undefined : labels(map);
  /** @param {string} arn @param {string} type */
  const label = (arn, type) => {
    if (byArn === undefined) return `\${ref:${type}}`;
    const key = byArn.get(arn);
    if (key !== undefined) return `\${ref:${key}}`;
    const digest = createHash("sha256").update(arn).digest("hex").slice(0, 12);
    return `\${ref:${type}:unmapped:${digest}}`;
  };
  /** @param {string} s */
  const str = (s) =>
    s
      .replace(TOKEN, (_, type, name) => {
        const arn = map?.[`${type}:${name}`];
        return arn === undefined
          ? map === undefined
            ? `\${ref:${type}}`
            : `\${ref:${type}:${name}:unmapped}`
          : label(arn, type);
      })
      .replace(ARN, (arn) => label(arn, arnType(arn)));
  /** @param {unknown} v @returns {unknown} */
  const walk = (v) => {
    if (typeof v === "string") return str(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v)
          .filter((k) => k !== "Metadata")
          .sort()
          .map((k) => [k, walk(/** @type {Record<string, unknown>} */ (v)[k])]),
      );
    }
    return v;
  };
  return walk(value);
}

/** Minimum spacing between two Connect calls: the documented 2 per second. */
export const PACE_MS = 500;
/** Throttling retries after the first attempt. */
export const RETRIES = 6;
/** First backoff ceiling and the cap on any one backoff, in ms. */
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 20000;

/**
 * Whether an SDK error is Connect refusing a call for its rate.
 * @param {unknown} err
 */
export function isThrottle(err) {
  if (err === null || typeof err !== "object") return false;
  const e =
    /** @type {{ name?: unknown, $metadata?: { httpStatusCode?: unknown }, message?: unknown }} */ (
      err
    );
  return (
    e.name === "TooManyRequestsException" ||
    e.name === "ThrottlingException" ||
    e.$metadata?.httpStatusCode === 429 ||
    (typeof e.message === "string" && /too many requests/i.test(e.message))
  );
}

/**
 * The wait before retry `attempt` (0 for the first retry): full jitter over
 * a ceiling that doubles from `base` and stops at `max`.
 * @param {number} attempt
 * @param {{ base?: number, max?: number, random?: () => number }} [options]
 */
export function backoffMs(attempt, options = {}) {
  const { base = BACKOFF_BASE_MS, max = BACKOFF_MAX_MS, random = Math.random } = options;
  return Math.floor(random() * Math.min(max, base * 2 ** attempt));
}

/**
 * A runner that spaces calls at least `paceMs` apart and retries a
 * throttling refusal up to `retries` times with `backoffMs`. Any other error,
 * and the last throttling one, is thrown as it came. Each call is a thunk,
 * `paced(() => client.send(command))`, so the SDK's types carry through.
 * @param {{ paceMs?: number, retries?: number, base?: number, max?: number,
 *   random?: () => number, sleep?: (ms: number) => Promise<void>, now?: () => number,
 *   onRetry?: (attempt: number, waitMs: number) => void }} [options]
 * @returns {<T>(call: () => Promise<T>) => Promise<T>}
 */
export function pacedSender(options = {}) {
  const {
    paceMs = PACE_MS,
    retries = RETRIES,
    base,
    max,
    random,
    sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms)),
    now = Date.now,
    onRetry,
  } = options;
  let last = -Infinity;
  const pace = async () => {
    const wait = last + paceMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
  };
  return async (call) => {
    for (let attempt = 0; ; attempt++) {
      await pace();
      try {
        return await call();
      } catch (err) {
        if (!isThrottle(err) || attempt >= retries) throw err;
        const wait = backoffMs(attempt, { base, max, random });
        onRetry?.(attempt + 1, wait);
        await sleep(wait);
      }
    }
  };
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ACCOUNT = /\b\d{12}\b/g;

/**
 * An error message with every ARN, UUID (instance and resource ids) and
 * 12-digit account id replaced, since the SDK's messages often name the
 * caller's role and the instance.
 * @param {string} message
 */
export function redact(message) {
  return message.replace(ARN, "<arn>").replace(UUID, "<id>").replace(ACCOUNT, "<account>");
}

/**
 * Where two normalized values differ, as `path: local ... live ...` lines.
 * @param {unknown} a
 * @param {unknown} b
 * @param {string} [path]
 * @returns {string[]}
 */
function differences(a, b, path = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObj = (/** @type {unknown} */ v) => v !== null && typeof v === "object";
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    const ra = /** @type {Record<string, unknown>} */ (a);
    const rb = /** @type {Record<string, unknown>} */ (b);
    const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])];
    return keys.flatMap((k) => differences(ra[k], rb[k], path === "" ? k : `${path}.${k}`));
  }
  return [`${path}: local ${JSON.stringify(a)}, live ${JSON.stringify(b)}`];
}

/**
 * Compares a FlowDoc's content with the live content, action by action. Both
 * are Connect flow language documents; returns the differences, empty when
 * they match.
 * @param {any} local
 * @param {any} live
 * @param {Record<string, string>} [map]
 * @returns {string[]}
 */
export function compareContent(local, live, map) {
  const a = /** @type {any} */ (normalize(local, map));
  const b = /** @type {any} */ (normalize(live, map));
  /** @type {string[]} */
  const out = [];
  if (a.StartAction !== b.StartAction) {
    out.push(`StartAction: local ${a.StartAction}, live ${b.StartAction}`);
  }
  /** @param {any} doc @returns {string[]} */
  const ids = (doc) => (doc.Actions ?? []).map((/** @type {any} */ x) => x.Identifier);
  const la = ids(a);
  const lb = ids(b);
  if (JSON.stringify(la) !== JSON.stringify(lb)) {
    const missing = la.filter((id) => !lb.includes(id));
    const extra = lb.filter((id) => !la.includes(id));
    if (missing.length > 0) out.push(`actions not live: ${missing.join(", ")}`);
    if (extra.length > 0) out.push(`actions only live: ${extra.join(", ")}`);
    if (missing.length === 0 && extra.length === 0) out.push("actions: same set, other order");
  }
  /** @param {any} doc @param {string} id */
  const action = (doc, id) =>
    (doc.Actions ?? []).find((/** @type {any} */ x) => x.Identifier === id);
  for (const id of la.filter((i) => lb.includes(i))) {
    for (const d of differences(action(a, id), action(b, id))) out.push(`action ${id}: ${d}`);
  }
  const rest = (/** @type {any} */ doc) => ({ ...doc, Actions: undefined, StartAction: undefined });
  out.push(...differences(rest(a), rest(b)));
  return out;
}

/**
 * The instance to read: from the deploy's exports, else .live/instances.json.
 * @param {string} environment
 * @returns {{ id: string, region: string }}
 */
function instanceFor(environment) {
  const id = process.env.TF_VAR_connect_instance_id;
  const region = process.env.TF_VAR_aws_region;
  if (id && region) return { id, region };
  const file = join(ROOT, ".live", "instances.json");
  if (!existsSync(file)) {
    throw new Error(
      "Set TF_VAR_connect_instance_id and TF_VAR_aws_region, or write .live/instances.json.",
    );
  }
  const entry = JSON.parse(readFileSync(file, "utf8"))[environment];
  if (!entry?.id || !entry?.region) throw new Error(`.live/instances.json has no ${environment}.`);
  return { id: entry.id, region: entry.region };
}

/** @param {string} profile */
async function main(profile) {
  const manifest = JSON.parse(readFileSync(join(ROOT, "refs", "manifest.json"), "utf8"));
  const environment = manifest.profiles?.[profile]?.environment;
  if (environment === undefined) {
    const known = Object.keys(manifest.profiles ?? {}).join(", ");
    throw new Error(`Usage: npm run drift -- <profile>, one of ${known}.`);
  }
  const { id, region } = instanceFor(environment);
  const mapFile = join(ROOT, "scenarios", `${profile}.resources.json`);
  /** @type {Record<string, string> | undefined} */
  const map = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, "utf8")) : undefined;
  console.log(
    map === undefined
      ? `No scenarios/${profile}.resources.json: references compared by type only.`
      : `References compared through scenarios/${profile}.resources.json.`,
  );

  const sdk = await import("@aws-sdk/client-connect");
  const client = new sdk.ConnectClient({ region });
  const paced = pacedSender({
    onRetry: (n, ms) =>
      console.error(`Throttled by Connect; retry ${n} of ${RETRIES} in ${ms} ms.`),
  });

  /** @type {Map<string, string>} */
  const flows = new Map();
  /** @type {string | undefined} */
  let next;
  do {
    const page = await paced(() =>
      client.send(new sdk.ListContactFlowsCommand({ InstanceId: id, NextToken: next })),
    );
    for (const f of page.ContactFlowSummaryList ?? []) {
      if (f.Name && f.Id) flows.set(f.Name, f.Id);
    }
    next = page.NextToken;
  } while (next);
  /** @type {Map<string, string>} */
  const modules = new Map();
  /** @type {string | undefined} */
  let nextModule;
  do {
    const page = await paced(() =>
      client.send(new sdk.ListContactFlowModulesCommand({ InstanceId: id, NextToken: nextModule })),
    );
    for (const m of page.ContactFlowModulesSummaryList ?? []) {
      if (m.Name && m.Id) modules.set(m.Name, m.Id);
    }
    nextModule = page.NextToken;
  } while (nextModule);

  let drift = 0;
  for (const dir of ["flows", "seasonal"]) {
    for (const file of readdirSync(join(ROOT, dir))
      .filter((f) => f.endsWith(".flowdoc.json"))
      .sort()) {
      const doc = JSON.parse(readFileSync(join(ROOT, dir, file), "utf8"));
      const isModule = doc.kind === "module";
      const liveId = (isModule ? modules : flows).get(doc.name);
      if (liveId === undefined) {
        console.log(
          `${dir}/${file}: not live (no ${isModule ? "module" : "flow"} named ${doc.name})`,
        );
        drift++;
        continue;
      }
      const content = isModule
        ? (
            await paced(() =>
              client.send(
                new sdk.DescribeContactFlowModuleCommand({
                  InstanceId: id,
                  ContactFlowModuleId: liveId,
                }),
              ),
            )
          ).ContactFlowModule?.Content
        : (
            await paced(() =>
              client.send(
                new sdk.DescribeContactFlowCommand({ InstanceId: id, ContactFlowId: liveId }),
              ),
            )
          ).ContactFlow?.Content;
      const found = compareContent(doc.content, JSON.parse(content ?? "{}"), map);
      if (found.length === 0) {
        console.log(`${dir}/${file}: unchanged`);
      } else {
        drift++;
        console.log(`${dir}/${file}: changed`);
        for (const line of found) console.log(`  ${line}`);
      }
    }
  }
  console.log(drift === 0 ? "No drift." : `${drift} FlowDoc(s) differ from ${environment}.`);
  return drift === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2] ?? "").then(
    (code) => process.exit(code),
    (err) => {
      console.error(redact(err instanceof Error ? err.message : String(err)));
      process.exit(2);
    },
  );
}
