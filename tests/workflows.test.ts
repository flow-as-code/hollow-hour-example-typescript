/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// The workflows' shape, read as text. Deliberately not a YAML parse, for the
// reason flow-as-code's tests/releaseGates.test.ts gives: the shapes read are
// narrow, and a line this cannot read is reported rather than skipped, so it
// cannot quietly read a shape it does not understand as absent.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const WORKFLOWS = join(ROOT, ".github", "workflows");
const read = (name: string) => readFileSync(join(WORKFLOWS, name), "utf8");

/** Every `uses:` in a workflow, as `{ file, line, ref }`. */
function usesRefs(yaml: string, file: string): { file: string; line: number; ref: string }[] {
  const out: { file: string; line: number; ref: string }[] = [];
  for (const [i, raw] of yaml.split("\n").entries()) {
    const line = raw.trim();
    if (line.startsWith("#")) continue;
    const match = /^(?:-\s+)?uses:\s*(?<ref>\S+)(?<rest>.*)$/.exec(line);
    if (!match?.groups) continue;
    const rest = (match.groups.rest ?? "").trim();
    if (rest !== "" && !rest.startsWith("#")) {
      throw new Error(`${file}:${String(i + 1)}: cannot read \`${line}\` as a \`uses:\`.`);
    }
    out.push({ file, line: i + 1, ref: match.groups.ref ?? "" });
  }
  return out;
}

/** The top-level keys of a workflow's block-form `on:`. */
function triggers(yaml: string, file: string): string[] {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => /^on:\s*$/.test(line));
  if (start === -1) throw new Error(`${file}: expected a block-form \`on:\``);
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (!line.startsWith("  ")) break;
    const key = /^ {2}(?<key>[a-z_]+):/.exec(line)?.groups?.key;
    if (key !== undefined) out.push(key);
  }
  return out;
}

// The SHAs flow-as-code pins on 2026-09-30, so the two repositories move
// together. Dependabot proposes updates; a PR that takes one updates this table
// in the same commit, which is the point: a pin change is always visible.
const EXPECTED_PINS: Record<string, string> = {
  "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
  "actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
  "opentofu/setup-opentofu": "a1320f892987e89d278cc92dc5adc984fb93aca4 # v2.0.2",
  "aws-actions/configure-aws-credentials": "e1253824e5c10ff9df46874f81ed3ec929e19cfd # v6.3.0",
};

describe("every third-party action is pinned to a commit", () => {
  // "Pinning an action to a full-length commit SHA is currently the only way to
  // use an action as an immutable release."
  // https://docs.github.com/en/actions/reference/security/secure-use
  const files = readdirSync(WORKFLOWS)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
  const sources = new Map(files.map((name) => [name, read(name)]));
  const refs = files.flatMap((name) => usesRefs(sources.get(name) ?? "", name));

  it("finds the workflows and their `uses:` lines, so a silent miss cannot pass", () => {
    expect(files).toEqual(["ci.yml", "deploy.yml"]);
    for (const file of files) {
      expect(refs.filter((r) => r.file === file).length).toBeGreaterThan(0);
    }
  });

  it("names a 40-character SHA everywhere but a reference into this repository", () => {
    const floating = refs
      .filter((r) => !r.ref.startsWith("./"))
      .filter((r) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(r.ref));
    expect(
      floating.map(
        (r) =>
          `${r.file}:${String(r.line)}: \`uses: ${r.ref}\` names a mutable ref. Pin it as \`owner/repo@<40 hex> # v1.2.3\`.`,
      ),
    ).toEqual([]);
  });

  it("keeps the human-readable version beside each SHA", () => {
    const uncommented = refs
      .filter((r) => /@[0-9a-f]{40}$/.test(r.ref))
      .filter((r) => {
        const line = (sources.get(r.file) ?? "").split("\n")[r.line - 1] ?? "";
        return !/@[0-9a-f]{40}\s+#\s*v\d\S*\s*$/.test(line);
      });
    expect(uncommented.map((r) => `${r.file}:${String(r.line)}: ${r.ref}`)).toEqual([]);
  });

  it("uses the same SHAs flow-as-code pins", () => {
    const mismatched = refs
      .filter((r) => !r.ref.startsWith("./"))
      .map((r) => {
        const [action = ""] = r.ref.split("@");
        const line = (sources.get(r.file) ?? "").split("\n")[r.line - 1] ?? "";
        const pinned = line.slice(line.indexOf("@") + 1).trim();
        return { where: `${r.file}:${String(r.line)}`, action, pinned };
      })
      .filter(({ action, pinned }) => EXPECTED_PINS[action] !== pinned)
      .map(({ where, action, pinned }) => `${where}: ${action}@${pinned}`);
    expect(mismatched).toEqual([]);
  });

  it("has Dependabot keeping the pins and the npm dependencies current", () => {
    const dependabot = readFileSync(join(ROOT, ".github", "dependabot.yml"), "utf8");
    expect(dependabot).toContain("package-ecosystem: github-actions");
    expect(dependabot).toContain("package-ecosystem: npm");
  });
});

describe("ci.yml stays offline", () => {
  const ci = read("ci.yml");

  it("runs the check on Node 22, 24 and 26", () => {
    expect(ci).toMatch(/node: \[22, 24, 26\]/);
    expect(ci).toContain("run: npm ci");
    expect(ci).toContain("run: npm run check");
  });

  it("can reach no AWS account", () => {
    expect(ci).not.toContain("id-token");
    expect(ci).not.toContain("uses: aws-actions/configure-aws-credentials");
    expect(ci).not.toMatch(/secrets\./);
  });
});

describe("deploy.yml applies one environment, by hand", () => {
  const deploy = read("deploy.yml");

  it("has no trigger but workflow_dispatch", () => {
    expect(triggers(deploy, "deploy.yml")).toEqual(["workflow_dispatch"]);
  });

  it("offers exactly dev, qa and prod, each a GitHub environment", () => {
    expect(deploy).toMatch(/options: \[dev, qa, prod\]/);
    expect(deploy).toContain("environment: ${{ inputs.environment }}");
  });

  it("serializes each environment and never cancels an apply", () => {
    expect(deploy).toContain("group: hollow-hour-${{ inputs.environment }}");
    expect(deploy).toContain("cancel-in-progress: false");
    // The provider repository's lane; sharing it would queue behind acceptance.
    expect(deploy).not.toMatch(/group:\s*sandbox-acceptance/);
  });

  it("assumes a role named by a variable over OIDC and masks the account", () => {
    expect(deploy).toContain("id-token: write");
    expect(deploy).toContain("role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}");
    expect(deploy).toContain("mask-aws-account-id: true");
    expect(deploy).toContain("::add-mask::");
  });

  it("allows the october season only on prod", () => {
    expect(deploy).toContain("season october exists only for prod");
    expect(deploy).toContain("name=prod-october");
  });

  it("gates on the same check CI runs before it emits", () => {
    const check = deploy.indexOf("run: npm run check");
    const emit = deploy.indexOf('run: npm run "emit:');
    expect(check).toBeGreaterThan(-1);
    expect(emit).toBeGreaterThan(check);
  });

  it("installs only the providers the committed lock files hash", () => {
    expect(deploy.match(/init -input=false -lockfile=readonly/g)).toHaveLength(2);
  });

  it("refuses to plan the flow root before the seasonal root has ever been applied", () => {
    const seasonal = deploy.indexOf("name: Seasonal root");
    const guard = deploy.indexOf("if: steps.seasonal.outputs.applied != 'true'");
    const flows = deploy.indexOf("name: Flow root");
    expect(seasonal).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(seasonal);
    expect(flows).toBeGreaterThan(guard);
  });
});
