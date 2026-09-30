/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// One FlowDoc set, four deploy profiles, and the emitted trees differ only
// where the design says: the synthesis's environment invariants, run against
// the real emitter (the pinned @flow-as-code/cli) over whatever flows/ and
// seasonal/ hold. While either directory has no FlowDocs, a fixture set that
// references every mapped key stands in (tests/envFixture.ts), so the
// invariants never pass vacuously.
//
//   --target flowascode (what deploys): dev differs from qa and prod only in
//     flows.tf, and only in hours:<district> lines; qa and prod are identical.
//   --target tf (offline invariant only): the same, in flow_refs.tf.
//   prod vs prod-october: only hours:<district> and module:greeting@live.
//   Nowhere an ARN, a TODO, or a null binding.

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDistricts } from "../generators/config.js";
import { loadManifest } from "../generators/refs.js";
import { writeFixtureFlows, writeFixtureGreetings } from "./envFixture.js";

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "node_modules", "@flow-as-code", "cli", "dist", "bin.js");
const PROFILES = Object.keys(loadManifest().profiles);
const TARGETS = { flowascode: "flows.tf", tf: "flow_refs.tf" } as const;
type Target = keyof typeof TARGETS;
type Tree = Map<string, string>;

const slugs = loadDistricts().map((d) => d.slug);
/** A binding line for hours:<district>, in each target's spelling. */
const HOURS_LINE: Record<Target, RegExp> = {
  flowascode: new RegExp(`^\\s*"hours:(${slugs.join("|")})"\\s*=`),
  tf: new RegExp(`^\\s*hours_(${slugs.map((s) => s.replaceAll("-", "_")).join("|")})_arn\\s*=`),
};
const GREETING_LINE: Record<Target, RegExp> = {
  flowascode: /^\s*"module:greeting@live"\s*=/,
  tf: /^\s*module_greeting_live_arn\s*=/,
};

// HH_EMIT_FIXTURE=1 runs the invariants over the fixture set even when real
// FlowDocs exist, to check the fixture still covers every mapped key.
const FORCE_FIXTURE = process.env.HH_EMIT_FIXTURE === "1";
const hasFlowDocs = (dir: string) => readdirSync(dir).some((f) => f.endsWith(".flowdoc.json"));

let work: string;
let flowsDir: string;
let seasonalDir: string;
const usingFixture: string[] = [];
const trees = new Map<string, Tree>();

function emit(
  source: string,
  target: Target,
  out: string,
  map?: string,
): { status: number; output: string } {
  const args = [CLI, "emit", source, "--target", target, "--out", out];
  if (map !== undefined) args.push("--address-map", map);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  return { status: r.status ?? 1, output: `${r.stdout}${r.stderr}` };
}

function readTree(dir: string): Tree {
  const tree: Tree = new Map();
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else tree.set(relative(dir, full), readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return tree;
}

/** Copies a directory's FlowDocs into `to` and returns `to`. */
function snapshot(from: string, to: string): string {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from).filter((n) => n.endsWith(".flowdoc.json"))) {
    copyFileSync(join(from, f), join(to, f));
  }
  return to;
}

const tree = (target: Target, profile: string) => {
  const t = trees.get(`${target}/${profile}`);
  if (t === undefined) throw new Error(`no emit for ${target}/${profile}`);
  return t;
};

/** Files whose bytes differ, or that exist on one side only. */
function differingFiles(a: Tree, b: Tree): string[] {
  const names = new Set([...a.keys(), ...b.keys()]);
  return [...names].filter((n) => a.get(n) !== b.get(n)).sort();
}

/** Lines that differ between two versions of one file, which must align line for line. */
function differingLines(a: string, b: string): string[] {
  const left = a.split("\n");
  const right = b.split("\n");
  expect(right.length, "a binding change must not add or remove lines").toBe(left.length);
  return left.flatMap((line, i) => (line === right[i] ? [] : [line, right[i] ?? ""]));
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "hh-emit-"));
  // Emit from a snapshot, so every profile sees the same FlowDocs even while
  // someone is editing flows/ during the run.
  flowsDir = snapshot(join(ROOT, "flows"), join(work, "flows"));
  seasonalDir = snapshot(join(ROOT, "seasonal"), join(work, "seasonal-src"));
  if (FORCE_FIXTURE || !hasFlowDocs(flowsDir)) {
    flowsDir = join(work, "fixture-flows");
    writeFixtureFlows(flowsDir);
    usingFixture.push("flows");
  }
  if (FORCE_FIXTURE || !hasFlowDocs(seasonalDir)) {
    seasonalDir = join(work, "fixture-seasonal");
    writeFixtureGreetings(seasonalDir);
    usingFixture.push("seasonal");
  }
  if (usingFixture.length > 0) {
    console.warn(`envEmit: no FlowDocs in ${usingFixture.join(", ")}/; using the fixture set`);
  }
  for (const target of Object.keys(TARGETS) as Target[]) {
    for (const profile of PROFILES) {
      const out = join(work, target, profile);
      const r = emit(flowsDir, target, out, join(ROOT, "refs", `${profile}.tfmap.json`));
      if (r.status !== 0) throw new Error(`emit ${target} ${profile} failed:\n${r.output}`);
      trees.set(`${target}/${profile}`, readTree(out));
    }
  }
  const seasonalOut = join(work, "seasonal");
  const r = emit(seasonalDir, "flowascode", seasonalOut);
  if (r.status !== 0) throw new Error(`emit seasonal failed:\n${r.output}`);
  trees.set("flowascode/seasonal", readTree(seasonalOut));
}, 120_000);

afterAll(() => {
  if (work !== undefined) rmSync(work, { recursive: true, force: true });
});

describe("the emitted file layout", () => {
  it("is what the environment roots expect", () => {
    expect([...tree("flowascode", "dev").keys()].sort()).toEqual([
      "flows.tf",
      "variables.tf",
      "versions.tf.example",
    ]);
    const tf = [...tree("tf", "dev").keys()];
    expect(tf).toContain("flow_refs.tf");
    expect(tf).toContain("flows.tf");
  });

  it("names the greeting modules as envs/seasonal-*/greetings.tf does", () => {
    const flows = tree("flowascode", "seasonal").get("flows.tf") ?? "";
    expect(flows).toContain('resource "flowascode_contact_flow_module" "hh_greeting_standard"');
    expect(flows).toContain('resource "flowascode_contact_flow_module" "hh_greeting_halloween"');
    // Nothing in seasonal/ invokes them, so the emitter writes no version or
    // alias of its own for greetings.tf to collide with (VERIFY.md row 7).
    expect(flows).not.toContain("flowascode_contact_flow_module_alias");
    expect(flows).not.toContain("flowascode_contact_flow_module_version");
  });
});

for (const [target, only] of Object.entries(TARGETS) as [Target, string][]) {
  describe(`--target ${target}`, () => {
    it("qa and prod emit byte-identical trees", () => {
      expect(differingFiles(tree(target, "qa"), tree(target, "prod"))).toEqual([]);
    });

    for (const other of ["qa", "prod"]) {
      it(`dev and ${other} differ only in ${only}, and there only in hours:<district> lines`, () => {
        const dev = tree(target, "dev");
        const theirs = tree(target, other);
        const files = differingFiles(dev, theirs);
        expect(files.filter((f) => f !== only)).toEqual([]);
        const lines =
          files.length === 0 ? [] : differingLines(dev.get(only) ?? "", theirs.get(only) ?? "");
        expect(lines.filter((l) => !HOURS_LINE[target].test(l))).toEqual([]);
      });
    }

    it(`prod and prod-october differ only in hours:<district> and module:greeting@live lines of ${only}`, () => {
      const prod = tree(target, "prod");
      const october = tree(target, "prod-october");
      const files = differingFiles(prod, october);
      expect(files.filter((f) => f !== only)).toEqual([]);
      const lines =
        files.length === 0 ? [] : differingLines(prod.get(only) ?? "", october.get(only) ?? "");
      expect(
        lines.filter((l) => !HOURS_LINE[target].test(l) && !GREETING_LINE[target].test(l)),
      ).toEqual([]);
    });

    it("binds the season: prod-october really differs from prod in the greeting", () => {
      // The set must invoke the greeting at all (T1 scope: hh-hotline-main
      // does), or the October profile would be a no-op nobody noticed.
      const prod = tree(target, "prod").get(only) ?? "";
      expect(prod.split("\n").some((l) => GREETING_LINE[target].test(l))).toBe(true);
      expect(differingFiles(tree(target, "prod"), tree(target, "prod-october"))).toEqual([only]);
    });
  });
}

describe("every emitted byte", () => {
  const everything = () =>
    [...trees.entries()].flatMap(([name, t]) =>
      [...t.entries()].map(([file, text]) => ({ where: `${name}/${file}`, text })),
    );

  it("is free of ARNs", () => {
    const arn = new RegExp(["arn", "aws"].join(":"));
    expect(
      everything()
        .filter((f) => arn.test(f.text))
        .map((f) => f.where),
    ).toEqual([]);
  });

  it("has no TODO_MISSING, no TODO and no null binding: every reference is bound", () => {
    const unbound = /TODO|=\s*null\b/;
    expect(
      everything()
        .filter((f) => unbound.test(f.text))
        .map((f) => f.where),
    ).toEqual([]);
  });

  it("would catch an unbound reference, so the check above means something", () => {
    const map = JSON.parse(readFileSync(join(ROOT, "refs", "prod.tfmap.json"), "utf8")) as Record<
      string,
      string
    >;
    const used = [
      ...(tree("flowascode", "prod").get("flows.tf") ?? "").matchAll(/"([a-z]+:[a-z0-9@-]+)"\s*=/g),
    ]
      .map((m) => m[1] ?? "")
      .filter((k) => k in map);
    expect(used.length).toBeGreaterThan(0);
    const dropped = used[0] ?? "";
    delete map[dropped];
    const partial = join(work, "partial.tfmap.json");
    writeFileSync(partial, JSON.stringify(map));
    for (const target of Object.keys(TARGETS) as Target[]) {
      const out = join(work, `partial-${target}`);
      emit(flowsDir, target, out, partial);
      const text = [...readTree(out).values()].join("\n");
      expect(text, `${target} without ${dropped}`).toMatch(/TODO|=\s*null\b/);
    }
  });
});

describe("the references the flows make", () => {
  it("are each bound by every profile's map or by the emitter (in-set)", () => {
    const maps = PROFILES.map(
      (p) =>
        JSON.parse(readFileSync(join(ROOT, "refs", `${p}.tfmap.json`), "utf8")) as Record<
          string,
          string
        >,
    );
    const keys = Object.keys(maps[0] ?? {});
    for (const m of maps) expect(Object.keys(m)).toEqual(keys);

    const docs = readdirSync(flowsDir)
      .filter((f) => f.endsWith(".flowdoc.json"))
      .map(
        (f) =>
          JSON.parse(readFileSync(join(flowsDir, f), "utf8")) as { name: string; kind: string },
      );
    const inSet = new Set(docs.map((d) => `${d.kind}:${d.name}`));
    const text = readdirSync(flowsDir)
      .filter((f) => f.endsWith(".flowdoc.json"))
      .map((f) => readFileSync(join(flowsDir, f), "utf8"))
      .join("\n");
    const refs = new Set(
      [...text.matchAll(/\$\{cdref:([a-z]+:[a-z0-9@-]+)\}/g)].map((m) => m[1] ?? ""),
    );
    const unbound = [...refs].filter((r) => !keys.includes(r) && !inSet.has(r.replace(/@.*/, "")));
    expect(unbound).toEqual([]);
  });
});
