/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// `tofu init -backend=false` and `tofu validate` over all six roots, each with
// the flows.tf its profile emits in place, plus envs/prod with the October
// profile's, and envs/bootstrap, which has no flows. Gated: skipped when OpenTofu is not on PATH (or TOFU names none),
// when the registry cannot be reached, or when HH_SKIP_TOFU=1. No
// credentials, no backend, no AWS call; providers are cached in .tofu-cache/.
//
// The roots are copied into a temporary tree of the same shape (envs/<root>,
// lambdas/, districts.config.json), so the working tree's envs/ is never
// written to and a stale flows.tf there cannot mask a failure. Each root's
// committed lock file is copied with it and init runs -lockfile=readonly, so
// a lock file that no longer covers the constraints fails here.

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeFixtureFlows, writeFixtureGreetings } from "./envFixture.js";

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "node_modules", "@flow-as-code", "cli", "dist", "bin.js");
const TOFU = process.env.TOFU ?? "tofu";
const CACHE = join(ROOT, ".tofu-cache");

/** Each root to validate: the directory it is copied from and the profile emitted into it. */
const ROOTS = [
  { name: "dev", from: "dev", profile: "dev" },
  { name: "qa", from: "qa", profile: "qa" },
  { name: "prod", from: "prod", profile: "prod" },
  { name: "prod-october", from: "prod", profile: "prod-october" },
  { name: "seasonal-dev", from: "seasonal-dev", set: "seasonal" },
  { name: "seasonal-qa", from: "seasonal-qa", set: "seasonal" },
  { name: "seasonal-prod", from: "seasonal-prod", set: "seasonal" },
  { name: "bootstrap", from: "bootstrap", set: "none" },
] as const;

function tofuVersion(): string | undefined {
  const r = spawnSync(TOFU, ["version"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.split("\n")[0] : undefined;
}

async function registryReachable(): Promise<boolean> {
  try {
    const r = await fetch(
      "https://registry.opentofu.org/v1/providers/flow-as-code/flowascode/versions",
      {
        signal: AbortSignal.timeout(5000),
      },
    );
    return r.ok;
  } catch {
    return false;
  }
}

const version = process.env.HH_SKIP_TOFU === "1" ? undefined : tofuVersion();
const online = version === undefined ? false : await registryReachable();
const gate = version !== undefined && online;
if (!gate) {
  console.warn(
    `validate.test: skipped (${version === undefined ? `no ${TOFU} on PATH, or HH_SKIP_TOFU=1` : "registry unreachable"})`,
  );
}

const hasFlowDocs = (dir: string) => readdirSync(dir).some((f) => f.endsWith(".flowdoc.json"));

let work: string;

function emitFlowsTf(source: string, into: string, map?: string) {
  const out = join(work, "emit", into.replaceAll("/", "-"));
  const args = [CLI, "emit", source, "--target", "flowascode", "--out", out];
  if (map !== undefined) args.push("--address-map", map);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`emit ${source} failed:\n${r.stdout}${r.stderr}`);
  copyFileSync(join(out, "flows.tf"), join(into, "flows.tf"));
}

function tofu(dir: string, args: string[]) {
  const r = spawnSync(TOFU, [`-chdir=${dir}`, ...args], {
    encoding: "utf8",
    env: { ...process.env, TF_PLUGIN_CACHE_DIR: CACHE, TF_IN_AUTOMATION: "1" },
    timeout: 240_000,
  });
  return { status: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe.runIf(gate)(`tofu validate (${version ?? "no tofu"})`, () => {
  beforeAll(() => {
    mkdirSync(CACHE, { recursive: true });
    work = mkdtempSync(join(tmpdir(), "hh-validate-"));
    const tree = join(work, "tree");
    mkdirSync(join(tree, "envs"), { recursive: true });
    copyFileSync(join(ROOT, "districts.config.json"), join(tree, "districts.config.json"));
    cpSync(join(ROOT, "lambdas"), join(tree, "lambdas"), { recursive: true });

    let flows = join(work, "flows");
    let seasonal = join(work, "seasonal");
    mkdirSync(flows);
    mkdirSync(seasonal);
    for (const [from, to] of [
      [join(ROOT, "flows"), flows],
      [join(ROOT, "seasonal"), seasonal],
    ] as const) {
      for (const f of readdirSync(from).filter((n) => n.endsWith(".flowdoc.json"))) {
        copyFileSync(join(from, f), join(to, f));
      }
    }
    if (!hasFlowDocs(flows)) writeFixtureFlows((flows = join(work, "fixture-flows")));
    if (!hasFlowDocs(seasonal)) writeFixtureGreetings((seasonal = join(work, "fixture-seasonal")));

    for (const root of ROOTS) {
      const dir = join(tree, "envs", root.name);
      mkdirSync(dir, { recursive: true });
      for (const f of readdirSync(join(ROOT, "envs", root.from))) {
        const authored =
          (f.endsWith(".tf") && f !== "flows.tf" && !f.endsWith("_override.tf")) ||
          f === ".terraform.lock.hcl";
        if (authored) copyFileSync(join(ROOT, "envs", root.from, f), join(dir, f));
      }
      if ("profile" in root)
        emitFlowsTf(flows, dir, join(ROOT, "refs", `${root.profile}.tfmap.json`));
      else if (root.set === "seasonal") emitFlowsTf(seasonal, dir);
    }
  }, 120_000);

  afterAll(() => {
    if (work !== undefined && existsSync(work)) rmSync(work, { recursive: true, force: true });
  });

  for (const root of ROOTS) {
    it(`envs/${root.from}${"profile" in root ? ` with the ${root.profile} emit` : ""} initializes and validates`, () => {
      const dir = join(work, "tree", "envs", root.name);
      const init = tofu(dir, [
        "init",
        "-backend=false",
        "-input=false",
        "-lockfile=readonly",
        "-no-color",
      ]);
      expect(init.status, init.output).toBe(0);
      const validate = tofu(dir, ["validate", "-no-color"]);
      expect(validate.status, validate.output).toBe(0);
      expect(validate.output).toContain("The configuration is valid");
    }, 300_000);
  }
});

describe.skipIf(gate)("tofu validate", () => {
  it.skip("needs OpenTofu on PATH and the registry reachable", () => {});
});
