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

  it("puts dev, qa and prod in the Regions the owner chose", () => {
    expect(text).toMatch(
      /default = \{\s*dev\s*= "us-west-2"\s*qa\s*= "us-east-1"\s*prod = "us-east-1"\s*\}/,
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

  it("creates no user, routing profile or security profile: Tier 1 needs none", () => {
    expect(text).not.toMatch(/resource "aws_connect_(user|routing_profile|security_profile)"/);
  });
});
