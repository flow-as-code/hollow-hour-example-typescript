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
  // flow-as-code has no artifact step to match; these are the releases
  // current on 2026-09-30, their tags resolved to commits through the GitHub
  // API. deploy.yml carries its saved plans from plan to apply with them.
  "actions/upload-artifact": "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1",
  "actions/download-artifact": "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1",
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

describe("deploy.yml plans one environment, then applies that plan, by hand", () => {
  const deploy = read("deploy.yml");
  const planJob = deploy.slice(deploy.indexOf("\n  plan:\n"), deploy.indexOf("\n  apply:\n"));
  const applyJob = deploy.slice(deploy.indexOf("\n  apply:\n"));

  it("has no trigger but workflow_dispatch", () => {
    expect(triggers(deploy, "deploy.yml")).toEqual(["workflow_dispatch"]);
  });

  it("offers exactly dev, qa and prod, planning ungated and applying in the gated GitHub environment", () => {
    expect(deploy).toMatch(/options: \[dev, qa, prod\]/);
    expect(planJob.length).toBeGreaterThan(0);
    expect(applyJob.length).toBeGreaterThan(0);
    expect(planJob).toContain("environment: ${{ inputs.environment }}-plan");
    expect(applyJob).toContain("environment: ${{ inputs.environment }}\n");
    expect(applyJob).toContain("needs: plan");
    expect(applyJob).toContain("if: inputs.apply");
  });

  it("serializes every deploy, whatever the environment, and never cancels an apply", () => {
    expect(deploy).toContain("group: hollow-hour-example-deploy\n");
    expect(deploy).not.toMatch(/group:.*inputs\.environment/);
    expect(deploy).toContain("cancel-in-progress: false");
    // The provider repository's lane; sharing it would queue behind acceptance.
    expect(deploy).not.toMatch(/group:\s*sandbox-acceptance/);
  });

  it("assumes roles named by secrets over OIDC and masks the account", () => {
    expect(deploy).toContain("id-token: write");
    expect(planJob).toContain("role-to-assume: ${{ secrets.AWS_PLAN_ROLE_ARN }}");
    expect(applyJob).toContain("role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}");
    expect(deploy.match(/mask-aws-account-id: true/g)).toHaveLength(2);
    expect(deploy).toContain("::add-mask::");
  });

  it("reads the role, the instance id and the bucket from secrets, never variables", () => {
    // GitHub prints with: and env: values in a step's log header before any
    // add-mask runs, and masks only secrets there.
    for (const name of [
      "AWS_DEPLOY_ROLE_ARN",
      "AWS_PLAN_ROLE_ARN",
      "CONNECT_INSTANCE_ID",
      "TF_STATE_BUCKET",
    ]) {
      expect(deploy).not.toContain(`vars.${name}`);
      expect(deploy).toContain(`secrets.${name}`);
    }
  });

  it("allows the october season only on prod", () => {
    expect(deploy).toContain("season october exists only for prod");
    expect(deploy).toContain("name=prod-october");
  });

  it("gates on the same check CI runs before it emits", () => {
    const check = planJob.indexOf("run: npm run check");
    const emit = planJob.indexOf('run: npm run "emit:');
    expect(check).toBeGreaterThan(-1);
    expect(emit).toBeGreaterThan(check);
  });

  it("installs only the providers the committed lock files hash", () => {
    expect(planJob.match(/init -input=false -lockfile=readonly/g)).toHaveLength(2);
    expect(applyJob.match(/init -input=false -lockfile=readonly/g)).toHaveLength(2);
  });

  it("reads state from the bucket's own Region with a lock object, not the instance's Region", () => {
    // One bucket (envs/bootstrap) serves every environment, and dev's
    // instance is in another Region than the bucket.
    expect(deploy.match(/-backend-config="region=\$TF_STATE_REGION"/g)).toHaveLength(4);
    expect(deploy.match(/-backend-config="use_lockfile=true"/g)).toHaveLength(4);
    expect(deploy).toContain('region=\\"$TF_STATE_REGION\\"}');
    expect(deploy).not.toContain("region=$TF_VAR_aws_region");
  });

  it("writes the plans to the summary and hands apply the saved plans, encrypted", () => {
    expect(planJob).toContain("-out=seasonal.tfplan");
    expect(planJob).toContain("-out=flows.tfplan");
    expect(planJob).toContain("GITHUB_STEP_SUMMARY");
    expect(planJob).toContain('"envs/$ENVIRONMENT/flows.tf"');
    expect(planJob).toContain('"envs/$ENVIRONMENT/build"');
    expect(planJob).toContain("openssl enc -aes-256-cbc");
    expect(applyJob).toContain("openssl enc -d -aes-256-cbc");
    expect(applyJob).toContain("apply -input=false seasonal.tfplan");
    expect(applyJob).toContain("apply -input=false flows.tfplan");
    expect(applyJob).not.toMatch(/\bplan -input/);
    expect(applyJob.indexOf("seasonal.tfplan")).toBeLessThan(applyJob.indexOf("flows.tfplan"));
  });

  it("refuses to plan the flow root before the seasonal root has ever been applied", () => {
    const seasonal = planJob.indexOf("name: Seasonal root");
    const guard = planJob.indexOf("if: steps.seasonal.outputs.plan_flows != 'true'");
    const flows = planJob.indexOf("name: Flow root");
    expect(seasonal).toBeGreaterThan(-1);
    expect(planJob).toContain('echo "applied=false"');
    expect(guard).toBeGreaterThan(seasonal);
    expect(flows).toBeGreaterThan(guard);
    expect(planJob).toContain("if: steps.seasonal.outputs.plan_flows == 'true'");
    expect(applyJob).toContain("if: needs.plan.outputs.flows_planned == 'true'");
    expect(applyJob).toContain("if: needs.plan.outputs.flows_planned != 'true'");
  });
});
