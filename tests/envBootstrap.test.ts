/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// envs/bootstrap: the instances and the state bucket every other root
// assumes. Read from the .tf text; tests/validate.test.ts runs OpenTofu over
// the same files, and the live apply is recorded in VERIFY.md.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const guide = readFileSync(join(import.meta.dirname, "..", "envs", "README.md"), "utf8");

const DIR = join(import.meta.dirname, "..", "envs", "bootstrap");
const text = readdirSync(DIR)
  .filter((f) => f.endsWith(".tf") && !f.endsWith("_override.tf"))
  .sort()
  .map((f) => readFileSync(join(DIR, f), "utf8"))
  .join("\n");

const block = (type: string, name: string) => {
  const start = text.indexOf(`resource "${type}" "${name}" {`);
  expect(start, `${type}.${name}`).toBeGreaterThan(-1);
  const end = text.indexOf("\n}\n", start);
  return text.slice(start, end);
};

describe("envs/bootstrap", () => {
  it("creates one Connect-managed instance per environment, in that environment's Region", () => {
    const instance = block("aws_connect_instance", "env");
    expect(instance).toContain("for_each = var.environments");
    expect(instance).toContain("region                    = each.value");
    expect(instance).toContain('identity_management_type  = "CONNECT_MANAGED"');
    expect(instance).toContain("inbound_calls_enabled     = true");
    expect(instance).toContain("outbound_calls_enabled    = true");
    expect(instance).toContain("contact_flow_logs_enabled = true");
    expect(instance).toContain(
      'instance_alias            = "hollow-hour-example-${each.key}-${random_id.suffix.hex}"',
    );
  });

  it("puts dev, qa and prod in us-east-1, the Region the owner chose", () => {
    expect(text).toMatch(
      /default = \{\s*dev\s*= "us-east-1"\s*qa\s*= "us-east-1"\s*prod = "us-east-1"\s*\}/,
    );
  });

  it("keeps state in a versioned, encrypted, private bucket that a destroy cannot remove", () => {
    expect(block("aws_s3_bucket", "state")).toContain("prevent_destroy = true");
    expect(block("aws_s3_bucket_versioning", "state")).toContain('status = "Enabled"');
    expect(block("aws_s3_bucket_server_side_encryption_configuration", "state")).toContain(
      "sse_algorithm",
    );
    const pab = block("aws_s3_bucket_public_access_block", "state");
    for (const flag of [
      "block_public_acls",
      "block_public_policy",
      "ignore_public_acls",
      "restrict_public_buckets",
    ]) {
      expect(pab).toMatch(new RegExp(`${flag}\\s*= true`));
    }
    expect(text).not.toContain("aws_dynamodb_table");
  });

  it("uses a partial S3 backend, so no bucket name is committed", () => {
    expect(readFileSync(join(DIR, "backend.tf"), "utf8")).toMatch(/backend "s3" \{\}/);
  });

  it("tags what it creates and never takes the sweeper's prefix", () => {
    expect(text).toContain('"hollow-hour-example" = "true"');
    expect(text).not.toContain("tfacc-");
  });

  // Tier decision 5 (tasks/README.md): on 2026-10-05 no instance had a
  // CALL_RECORDINGS storage config, so bootstrap adds one per environment.
  // The bucket name takes the amazon-connect- prefix because that is the
  // only S3 resource the service-linked role's managed policy grants, and
  // the root adds no bucket policy (VERIFY.md, RS1).
  it("stores call recordings in a private SSE-S3 bucket per environment, expired after 30 days, with no customer key", () => {
    const bucket = block("aws_s3_bucket", "recordings");
    expect(bucket).toContain("for_each = var.environments");
    expect(bucket).toContain("region = each.value");
    expect(bucket).toContain(
      'bucket = "amazon-connect-hollow-hour-example-${each.key}-recordings-${random_id.suffix.hex}"',
    );
    // 63 characters is the S3 limit; the longest environment name is prod.
    expect("amazon-connect-hollow-hour-example-prod-recordings-".length + 6).toBeLessThanOrEqual(
      63,
    );
    expect(text).not.toContain("aws_s3_bucket_policy");
    expect(block("aws_s3_bucket_server_side_encryption_configuration", "recordings")).toContain(
      'sse_algorithm = "AES256"',
    );
    const pab = block("aws_s3_bucket_public_access_block", "recordings");
    for (const flag of [
      "block_public_acls",
      "block_public_policy",
      "ignore_public_acls",
      "restrict_public_buckets",
    ]) {
      expect(pab).toMatch(new RegExp(`${flag}\\s*= true`));
    }
    const lifecycle = block("aws_s3_bucket_lifecycle_configuration", "recordings");
    expect(lifecycle).toContain('status = "Enabled"');
    expect(lifecycle).toMatch(/expiration \{\s*days = 30\s*\}/);
    const config = block("aws_connect_instance_storage_config", "call_recordings");
    expect(config).toContain("for_each = var.environments");
    expect(config).toContain("instance_id   = aws_connect_instance.env[each.key].id");
    expect(config).toContain('resource_type = "CALL_RECORDINGS"');
    expect(config).toContain('storage_type = "S3"');
    expect(config).toContain("bucket_name   = aws_s3_bucket.recordings[each.key].id");
    expect(config).not.toContain("encryption_config");
    expect(text).not.toContain("aws_kms_key");
  });

  it("creates no user, routing profile or security profile: Tier 1 needs none", () => {
    expect(text).not.toMatch(/resource "aws_connect_(user|routing_profile|security_profile)"/);
  });

  it("documents a teardown that reaches the bootstrap root, in an order that can succeed", () => {
    const start = guide.indexOf("## Teardown");
    expect(start, "envs/README.md has a Teardown section").toBeGreaterThan(-1);
    const next = guide.indexOf("\n## ", start + 1);
    const teardown = guide.slice(start, next === -1 ? undefined : next);
    const at = (needle: string) => {
      const i = teardown.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const steps = [
      "tofu -chdir=envs/<environment> destroy",
      "tofu -chdir=envs/seasonal-<environment> destroy",
      "tofu init -migrate-state -force-copy",
      "tofu destroy -target=aws_connect_instance.env",
      "aws logs delete-log-group --log-group-name /aws/connect/<alias>",
      "list-object-versions",
      "prevent_destroy = true",
      "tofu destroy\n",
    ].map(at);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(teardown).toContain("TF_VAR_connect_instance_id");
    expect(teardown).toContain("TF_VAR_seasonal_state");
    expect(teardown).toContain("BucketNotEmpty");
  });

  it("says how a fresh clone finds the state bucket again", () => {
    expect(guide).toContain("starts_with(Name,'hollow-hour-example-tfstate-')");
  });
});
