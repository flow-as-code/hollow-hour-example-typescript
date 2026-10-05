/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// What each environment root creates beside its flows: the stub Lambdas and
// what Connect needs to run them, the seasonal aliases, the provider pins,
// and the guard against planning without flows. Read from the .tf text; the
// gated tests/validate.test.ts runs OpenTofu over the same files.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadManifest } from "../generators/refs.js";

const ROOT = join(import.meta.dirname, "..");
const ENVS = join(ROOT, "envs");
const ENVIRONMENTS = ["dev", "qa", "prod"] as const;

const read = (dir: string, file: string) => readFileSync(join(ENVS, dir, file), "utf8");
const all = (dir: string) =>
  readdirSync(join(ENVS, dir))
    .filter((f) => f.endsWith(".tf") && f !== "flows.tf")
    .map((f) => read(dir, f))
    .join("\n");

/** Every resource block's type and name in a root's authored files. */
const resources = (dir: string) =>
  [...all(dir).matchAll(/^resource "([a-z0-9_]+)" "([a-z0-9_]+)"/gm)].map(
    (m) => `${m[1] ?? ""}.${m[2] ?? ""}`,
  );

const lambdaKeys = loadManifest()
  .refs.map((e) => e.key)
  .filter((k) => k.startsWith("lambda:"))
  .map((k) => k.slice("lambda:".length))
  .sort();

describe("the stub Lambdas in envs/<environment>/lambdas.tf", () => {
  for (const env of ENVIRONMENTS) {
    const text = read(env, "lambdas.tf");

    it(`${env}: deploys exactly the manifest's lambda: keys`, () => {
      const block = /stubs = toset\(\[([^\]]*)\]\)/.exec(text)?.[1] ?? "";
      const names = [...block.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]).sort();
      expect(names).toEqual(lambdaKeys);
    });

    it(`${env}: zips each lambdas/<name>/ at plan time into the ignored build/`, () => {
      expect(text).toContain('source_dir  = "${path.module}/../../lambdas/${each.key}"');
      expect(text).toContain('output_path = "${path.module}/build/lambda-${each.key}.zip"');
      expect(text).toContain(
        "source_code_hash = data.archive_file.stub[each.key].output_base64sha256",
      );
    });

    it(`${env}: runs Node 22 with a role, a log group and an association each`, () => {
      expect(text).toContain('runtime          = "nodejs22.x"');
      expect(text).toContain('handler          = "index.handler"');
      for (const r of [
        "aws_iam_role.stub",
        "aws_iam_role_policy.stub_logs",
        "aws_cloudwatch_log_group.stub",
        "aws_lambda_function.stub",
        "aws_lambda_permission.connect",
        "aws_connect_lambda_function_association.connect",
      ]) {
        expect(resources(env), r).toContain(r);
      }
    });

    it(`${env}: lets only this instance invoke, never a wildcard`, () => {
      expect(text).toContain('principal      = "connect.amazonaws.com"');
      expect(text).toContain("source_arn     = data.aws_connect_instance.this.arn");
      expect(text).toContain("source_account = data.aws_caller_identity.current.account_id");
      expect(text).not.toMatch(/"\*"/);
    });

    it(`${env}: names every account-global and instance resource hh-<env>-`, () => {
      expect(all(env)).toMatch(/name_prefix = "hh-\$\{local\.environment\}"/);
      for (const m of all(env).matchAll(/^\s*(?:name|function_name)\s*=\s*"([^"]*)"/gm)) {
        const value = m[1] ?? "";
        if (value === "logs" || value === "live") continue;
        expect(value, m[0]).toMatch(/^(\/aws\/lambda\/)?\$\{local\.name_prefix\}-/);
      }
    });

    it(`${env}: tags everything the aws provider creates hollow-hour-example and environment`, () => {
      const providers = read(env, "providers.tf");
      expect(providers).toMatch(/default_tags \{\s*tags = local\.tags\s*\}/);
      expect(providers).toContain('"hollow-hour-example" = "true"');
      expect(providers).toContain('"environment" = local.environment');
    });

    it(`${env}: binds lambdas through their association, so flows wait for it`, () => {
      const map = JSON.parse(
        readFileSync(join(ROOT, "refs", `${env}.tfmap.json`), "utf8"),
      ) as Record<string, string>;
      for (const name of lambdaKeys) {
        expect(map[`lambda:${name}`]).toBe(
          `aws_connect_lambda_function_association.connect["${name}"].function_arn`,
        );
      }
    });

    it(`${env}: refuses to plan without an emitted flows.tf`, () => {
      const main = read(env, "main.tf");
      expect(main).toContain('resource "terraform_data" "flow_set"');
      expect(main).toMatch(/precondition \{[\s\S]*file\("\$\{path\.module\}\/flows\.tf"\)/);
    });
  }
});

describe("the hours", () => {
  const text = read("dev", "supporting.tf");

  it("has a 24x7 schedule: seven 0:00 to 0:00 ranges", () => {
    const always =
      /resource "aws_connect_hours_of_operation" "always_open" \{([\s\S]*?)\n\}/.exec(text)?.[1] ??
      "";
    expect(always).toContain("for_each = local.days");
    expect(always).toMatch(
      /start_time \{\s*hours\s*= 0\s*minutes = 0\s*\}\s*end_time \{\s*hours\s*= 0\s*minutes = 0/,
    );
  });

  it("has the night shift, 4 pm to 6 am, as two ranges a day that never wrap", () => {
    const night =
      /resource "aws_connect_hours_of_operation" "night_shift" \{([\s\S]*?)\n\}/.exec(text)?.[1] ??
      "";
    const ranges = [
      ...night.matchAll(/start_time \{\s*hours\s*= (\d+)[\s\S]*?end_time \{\s*hours\s*= (\d+)/g),
    ].map((m) => `${m[1] ?? ""}-${m[2] ?? ""}`);
    expect(ranges).toEqual(["0-6", "16-0"]);
  });
});

describe("the closed hours (T2, scenario S4)", () => {
  // The resource needs at least one config block, so "closed" is open for
  // one minute a week and S4 is never run in that minute (VERIFY.md, HC1).
  for (const env of ENVIRONMENTS) {
    it(`${env}: is open Sunday 03:00 to 03:01 America/New_York and nothing else`, () => {
      const closed =
        /resource "aws_connect_hours_of_operation" "closed" \{([\s\S]*?)\n\}/.exec(
          read(env, "supporting.tf"),
        )?.[1] ?? "";
      expect(closed).toContain('time_zone   = "America/New_York"');
      const ranges = [
        ...closed.matchAll(
          /config \{\s*day = "([A-Z]+)"\s*start_time \{\s*hours\s*= (\d+)\s*minutes = (\d+)\s*\}\s*end_time \{\s*hours\s*= (\d+)\s*minutes = (\d+)/g,
        ),
      ].map((m) => m.slice(1).join(" "));
      expect(ranges).toEqual(["SUNDAY 3 0 3 1"]);
      expect(closed).not.toContain("for_each");
    });
  }

  it("is the hours:closed binding in every profile", () => {
    for (const profile of Object.keys(loadManifest().profiles)) {
      const map = JSON.parse(
        readFileSync(join(ROOT, "refs", `${profile}.tfmap.json`), "utf8"),
      ) as Record<string, string>;
      expect(map["hours:closed"]).toBe("aws_connect_hours_of_operation.closed.arn");
    }
  });
});

describe("the recorded prompt (T2, the hold A/B split)", () => {
  for (const env of ENVIRONMENTS) {
    const text = read(env, "supporting.tf");
    const providers = read(env, "providers.tf");

    it(`${env}: declares awscc with region only, no default_tags and no skip_ flags`, () => {
      expect(providers).toMatch(
        /awscc = \{\s*source\s*= "hashicorp\/awscc"\s*version = "~> 1\.104"/,
      );
      const block = /provider "awscc" \{([\s\S]*?)\n\}/.exec(providers)?.[1] ?? "";
      expect(block.trim()).toBe("region = var.aws_region");
    });

    it(`${env}: keeps the audio in a private, encrypted bucket with one object from prompts/`, () => {
      for (const r of [
        "aws_s3_bucket.prompts",
        "aws_s3_bucket_public_access_block.prompts",
        "aws_s3_bucket_ownership_controls.prompts",
        "aws_s3_bucket_server_side_encryption_configuration.prompts",
        "aws_s3_object.salt_line_tips",
        "awscc_connect_prompt.salt_line_tips",
      ]) {
        expect(resources(env), r).toContain(r);
      }
      expect(text).toMatch(
        /bucket = "\$\{local\.name_prefix\}-prompts-\$\{data\.aws_caller_identity\.current\.account_id\}"/,
      );
      for (const flag of [
        "block_public_acls       = true",
        "block_public_policy     = true",
        "ignore_public_acls      = true",
        "restrict_public_buckets = true",
        'sse_algorithm = "AES256"',
        'object_ownership = "BucketOwnerEnforced"',
      ]) {
        expect(text).toContain(flag);
      }
      expect(text).toContain('source       = "${path.module}/../../prompts/salt-line-tips.wav"');
      expect(text).toContain(
        'source_hash  = filemd5("${path.module}/../../prompts/salt-line-tips.wav")',
      );
      expect(text).not.toMatch(/aws_s3_bucket_policy/);
    });

    it(`${env}: makes the prompt from that object on this instance`, () => {
      const prompt =
        /resource "awscc_connect_prompt" "salt_line_tips" \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? "";
      expect(prompt).toContain("instance_arn = data.aws_connect_instance.this.arn");
      expect(prompt).toContain('name         = "${local.name_prefix}-salt-line-tips"');
      expect(prompt).toContain(
        's3_uri       = "s3://${aws_s3_object.salt_line_tips.bucket}/${aws_s3_object.salt_line_tips.key}"',
      );
    });
  }

  it("is the prompt:salt-line-tips binding in every profile", () => {
    for (const profile of Object.keys(loadManifest().profiles)) {
      const map = JSON.parse(
        readFileSync(join(ROOT, "refs", `${profile}.tfmap.json`), "utf8"),
      ) as Record<string, string>;
      expect(map["prompt:salt-line-tips"]).toBe("awscc_connect_prompt.salt_line_tips.prompt_arn");
    }
  });
});

describe("the seasonal roots", () => {
  for (const env of ENVIRONMENTS) {
    const text = read(`seasonal-${env}`, "greetings.tf");

    it(`seasonal-${env}: versions and aliases both greetings as live`, () => {
      expect(text).toContain("standard  = flowascode_contact_flow_module.hh_greeting_standard");
      expect(text).toContain("halloween = flowascode_contact_flow_module.hh_greeting_halloween");
      expect(text).toContain('resource "flowascode_contact_flow_module_version" "greeting"');
      expect(text).toContain('resource "flowascode_contact_flow_module_alias" "greeting_live"');
      expect(text).toContain('name                        = "live"');
      expect(text).toMatch(/lifecycle \{\s*create_before_destroy = true\s*\}/);
    });

    it(`seasonal-${env}: outputs the two alias ARNs the maps bind`, () => {
      const outputs = [...all(`seasonal-${env}`).matchAll(/^output "([a-z0-9_]+)"/gm)].map(
        (m) => m[1],
      );
      expect(outputs.sort()).toEqual(["greeting_halloween_live_arn", "greeting_standard_live_arn"]);
      expect(text).toContain('flowascode_contact_flow_module_alias.greeting_live["standard"].arn');
      expect(text).toContain('flowascode_contact_flow_module_alias.greeting_live["halloween"].arn');
    });
  }
});

describe("provider pins", () => {
  // envs/bootstrap creates the instances and the state bucket, no flow.
  for (const dir of readdirSync(ENVS).filter((d) => !d.endsWith(".md") && d !== "bootstrap")) {
    it(`${dir}: takes the published flowascode provider within 0.1`, () => {
      expect(read(dir, "providers.tf")).toMatch(
        /flowascode = \{\s*source\s*= "flow-as-code\/flowascode"\s*version = "~> 0\.1\.1"/,
      );
    });
  }
});
