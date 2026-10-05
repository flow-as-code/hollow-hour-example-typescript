/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// VERIFY.md: every row carries its AWS documentation and an honest status.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const text = readFileSync(join(import.meta.dirname, "..", "VERIFY.md"), "utf8");
const lines = text.split("\n").filter((l) => l.startsWith("| "));
const [header, , ...rows] = lines;
const cells = (line: string) =>
  line
    .slice(1, -1)
    .split(" | ")
    .map((c) => c.trim());

// A documentation check carries the UTC date it was read. A sandbox result
// carries its UTC date, the Region it ran in and what the service said:
// `sandbox-checked 2026-10-01, us-west-2: accepted`. A harness result (a
// row an offline run such as the Terraform-first equivalence check settles,
// with no instance involved) carries its UTC date and the result:
// `harness-checked 2026-10-05: planned offline`.
const STATUS =
  /^(docs-checked \d{4}-\d{2}-\d{2}|needs sandbox|sandbox-checked \d{4}-\d{2}-\d{2}, [a-z]{2}(-gov)?-[a-z]+-\d: .+|harness-checked \d{4}-\d{2}-\d{2}: .+)$/;

describe("VERIFY.md", () => {
  it("has the columns the tasks rely on", () => {
    expect(cells(header ?? "")).toEqual([
      "#",
      "Question",
      "Answer",
      "Status",
      "AWS docs",
      "Design change forced",
    ]);
  });

  it("carries every question the synthesis verified", () => {
    const ids = rows.map((r) => cells(r)[0]);
    for (const id of [
      "16.1",
      "16.1b",
      "16.2",
      "16.3",
      "16.4",
      "16.5",
      "16.6",
      "16.7",
      "16.8",
      "16.9",
      "16.10",
      "16.11",
      "16.12",
      "5.4",
      "6.2",
      "7",
      "12.7",
      "15",
      "HC1",
      "RS1",
      "D1",
      "CB1",
      "DP1",
      "P1",
      "E1",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("reads a sandbox status only with its date, Region and result", () => {
    expect(STATUS.test("sandbox-checked 2026-10-01, us-west-2: accepted")).toBe(true);
    expect(STATUS.test("sandbox-checked 2026-10-01 accepted")).toBe(false);
    expect(STATUS.test("sandbox-checked 2026-10-01, accepted")).toBe(false);
  });

  it("reads a docs-checked status with any full date, never without one", () => {
    expect(STATUS.test("docs-checked 2026-09-30")).toBe(true);
    expect(STATUS.test("docs-checked 2026-10-05")).toBe(true);
    expect(STATUS.test("docs-checked")).toBe(false);
    expect(STATUS.test("docs-checked 2026-10-5")).toBe(false);
    expect(STATUS.test("docs-checked 2026-10-05: accepted")).toBe(false);
  });

  it("reads a harness status only with its date and result, and never a Region", () => {
    expect(STATUS.test("harness-checked 2026-10-05: planned offline")).toBe(true);
    expect(STATUS.test("harness-checked 2026-10-05")).toBe(false);
    expect(STATUS.test("harness-checked 2026-10-05, us-east-1: planned offline")).toBe(false);
    expect(STATUS.test("harness-checked: planned offline")).toBe(false);
  });

  it("gives every row six cells, an AWS doc URL, a status and a design change", () => {
    const bad = rows
      .map((row) => ({ row, c: cells(row) }))
      .filter(
        ({ c }) =>
          c.length !== 6 ||
          !STATUS.test(c[3] ?? "") ||
          !/https:\/\/docs\.aws\.amazon\.com\/\S+\.html/.test(c[4] ?? "") ||
          (c[5] ?? "").length === 0,
      )
      .map(({ c }) => `${c[0]}: status "${c[3]}"`);
    expect(bad).toEqual([]);
  });
});
