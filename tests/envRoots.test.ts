/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// The environment roots under envs/: one shape, one differing file, and an
// address behind every binding the maps make.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDistricts } from "../generators/config.js";
import { addressMap, loadManifest } from "../generators/refs.js";

const ROOT = join(import.meta.dirname, "..");
const ENVS = join(ROOT, "envs");
const ENVIRONMENTS = ["dev", "qa", "prod"] as const;

const tfFiles = (dir: string) =>
  readdirSync(join(ENVS, dir))
    .filter((f) => f.endsWith(".tf") && f !== "flows.tf")
    .sort();
const tfText = (dir: string) =>
  tfFiles(dir)
    .map((f) => readFileSync(join(ENVS, dir, f), "utf8"))
    .join("\n");

// Addresses the maps already bind whose resources later tasks create. Kept
// exact in both directions: a pending address that appears in envs/ fails
// "names exactly the pending addresses", so this list cannot go stale.
const PENDING = new Set([
  // T2: the prompt, through awscc.
  "awscc_connect_prompt.salt_line_tips.prompt_arn",
]);

/** The stub names lambdas.tf zips and deploys, read from its `stubs` set. */
function stubNames(env: string): Set<string> {
  const block = /stubs = toset\(\[([^\]]*)\]\)/.exec(tfText(env))?.[1] ?? "";
  return new Set([...block.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1] ?? ""));
}

/** The `for_each` keys a keyed resource can take, read from its root. */
function forEachKeys(env: string, resource: string): Set<string> | undefined {
  if (resource === "aws_connect_queue.crew") {
    return new Set(loadDistricts().map((d) => d.slug));
  }
  if (
    resource === "aws_connect_lambda_function_association.connect" ||
    resource === "aws_lambda_function.stub"
  ) {
    return stubNames(env);
  }
  if (resource === "aws_connect_queue.shared") {
    const block = /shared_queues = \{([^}]*)\}/.exec(tfText(env))?.[1] ?? "";
    return new Set([...block.matchAll(/^\s*"([a-z0-9-]+)"\s*=/gm)].map((m) => m[1] ?? ""));
  }
  return undefined;
}

/** Whether an address a map binds exists in an environment's roots. */
function resolves(env: string, address: string): boolean {
  const remote = /^data\.terraform_remote_state\.seasonal\.outputs\.([a-z0-9_]+)$/.exec(address);
  if (remote) {
    return (
      tfText(env).includes('data "terraform_remote_state" "seasonal"') &&
      tfText(`seasonal-${env}`).includes(`output "${remote[1]}"`)
    );
  }
  const parts = /^(data\.)?([a-z0-9_]+)\.([a-z0-9_]+)(?:\["([a-z0-9-]+)"\])?\./.exec(address);
  if (!parts) return false;
  const [, data, type, name, key] = parts;
  const kind = data ? "data" : "resource";
  if (!tfText(env).includes(`${kind} "${type}" "${name}"`)) return false;
  if (key === undefined) return true;
  return forEachKeys(env, `${type}.${name}`)?.has(key) ?? false;
}

describe("envs/", () => {
  it("has a flow root and a seasonal root per environment, and nothing else", () => {
    const dirs = readdirSync(ENVS, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual([...ENVIRONMENTS, ...ENVIRONMENTS.map((e) => `seasonal-${e}`)].sort());
  });

  for (const group of [[...ENVIRONMENTS], ENVIRONMENTS.map((e) => `seasonal-${e}`)]) {
    it(`${group.join(", ")} are byte-identical except environment.tf`, () => {
      const [first, ...rest] = group;
      const files = tfFiles(first ?? "");
      expect(files).toContain("environment.tf");
      for (const other of rest) {
        expect(tfFiles(other), other).toEqual(files);
        for (const file of files.filter((f) => f !== "environment.tf")) {
          expect(readFileSync(join(ENVS, other, file), "utf8"), `${other}/${file}`).toBe(
            readFileSync(join(ENVS, first ?? "", file), "utf8"),
          );
        }
      }
    });
  }

  for (const group of [[...ENVIRONMENTS], ENVIRONMENTS.map((e) => `seasonal-${e}`)]) {
    it(`${group.join(", ")} commit one provider lock file, the same in each, locking every required provider`, () => {
      const locks = group.map((dir) => {
        const path = join(ENVS, dir, ".terraform.lock.hcl");
        expect(existsSync(path), `${dir}/.terraform.lock.hcl`).toBe(true);
        return readFileSync(path, "utf8");
      });
      for (const lock of locks.slice(1)) expect(lock).toBe(locks[0]);
      const required = [
        ...tfText(group[0] ?? "").matchAll(/source\s*=\s*"([a-z0-9-]+\/[a-z0-9-]+)"/g),
      ].map((m) => m[1]);
      const locked = [
        ...(locks[0] ?? "").matchAll(/^provider "registry\.opentofu\.org\/([^"]+)"/gm),
      ].map((m) => m[1]);
      expect(locked.sort()).toEqual([...new Set(required)].sort());
    });
  }

  it("names its own environment in environment.tf", () => {
    for (const env of ENVIRONMENTS) {
      for (const dir of [env, `seasonal-${env}`]) {
        const text = readFileSync(join(ENVS, dir, "environment.tf"), "utf8");
        expect(text, dir).toContain(`environment = "${env}"`);
      }
    }
  });

  it("takes the instance, region and state location at plan time, never as a default", () => {
    for (const env of ENVIRONMENTS) {
      for (const dir of [env, `seasonal-${env}`]) {
        const text = tfText(dir);
        expect(text, dir).toContain('variable "connect_instance_id"');
        expect(text, dir).not.toMatch(/^\s*default\s*=/m);
        expect(text, dir).toMatch(/backend "s3" \{\}/);
      }
    }
  });

  it("never names anything with the provider sweeper's tfacc- prefix", () => {
    for (const dir of readdirSync(ENVS)) {
      if (existsSync(join(ENVS, dir)) && dir !== "README.md") {
        expect(tfText(dir), dir).not.toMatch(/"tfacc-|= "tfacc/);
      }
    }
  });
});

describe("every address a map binds exists in its environment", () => {
  const manifest = loadManifest();
  const districts = loadDistricts();

  it("resolves a real address and refuses a made-up one, so the check means something", () => {
    expect(resolves("dev", 'aws_connect_queue.crew["old-town"].arn')).toBe(true);
    expect(resolves("dev", 'aws_connect_queue.crew["nowhere"].arn')).toBe(false);
    expect(resolves("dev", 'aws_connect_queue.shared["lantern-crew"].arn')).toBe(true);
    expect(resolves("dev", "aws_connect_queue.nothing.arn")).toBe(false);
    expect(
      resolves("dev", 'aws_connect_lambda_function_association.connect["crew-eta"].function_arn'),
    ).toBe(true);
    expect(
      resolves("dev", 'aws_connect_lambda_function_association.connect["ouija"].function_arn'),
    ).toBe(false);
    expect(
      resolves("dev", "data.terraform_remote_state.seasonal.outputs.greeting_standard_live_arn"),
    ).toBe(true);
    expect(resolves("dev", "data.terraform_remote_state.seasonal.outputs.nothing_arn")).toBe(false);
  });

  it("names exactly the pending addresses as missing", () => {
    for (const [profile, settings] of Object.entries(manifest.profiles)) {
      const missing = Object.values(addressMap(manifest, districts, profile)).filter(
        (address) => !resolves(settings.environment, address),
      );
      const pendingHere = [...PENDING].filter((a) =>
        Object.values(addressMap(manifest, districts, profile)).includes(a),
      );
      expect([...new Set(missing)].sort(), profile).toEqual(pendingHere.sort());
    }
  });
});
