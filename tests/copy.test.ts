/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// What callers and crews hear. Every Text and SSML in both sets, plus each
// document's description (what the Connect console shows), is checked against
// the safety line, the fictional phone range, and a banned-terms list derived
// from the draft spec's section 2 guardrails and the owner's renames
// (tasks/README.md, decision 7; synthesis section 2, item 12).

import { readdirSync, readFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../generators/config.js";
import { loadAll, spokenTexts } from "../generators/flowset.js";

const loaded = loadAll();

/** The sentence both greetings carry, word for word. */
const EMERGENCY_LINE =
  "If anyone is hurt or in danger, hang up and call your local emergency number (911 in the US).";

const copy = loaded.flatMap(({ doc }) => [
  ...doc.content.Actions.flatMap((a) =>
    spokenTexts(a).map((text) => ({ where: `${doc.name}#${a.Identifier}`, text })),
  ),
  ...(doc.description === undefined
    ? []
    : [{ where: `${doc.name} (description)`, text: doc.description }]),
]);

// What the stub Lambdas can put in a caller's or crew's ear: every string
// literal in lambdas/*/index.mjs that reads as prose (has a space), comments
// excluded. Flows speak these through $.External and $.Attributes, so they
// are copy too.
const LITERAL = /"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
const lambdaCopy = readdirSync(joinPath(ROOT, "lambdas"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => {
    const source = readFileSync(joinPath(ROOT, "lambdas", d.name, "index.mjs"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    return [...source.matchAll(LITERAL)]
      .map((m) => m[1] ?? m[2] ?? "")
      .filter((text) => text.includes(" "))
      .map((text) => ({ where: `lambdas/${d.name}`, text }));
  });
copy.push(...lambdaCopy);

// Split so the words themselves appear nowhere but here, as tests/hygiene does.
const join = (...parts: string[]) => parts.join("");
const BANNED: { term: RegExp; why: string }[] = [
  // Retired by the owner's rename (tasks/README.md, decision 7).
  { term: new RegExp(join("\\bleg", "ion\\b"), "i"), why: "fifth grade renamed Chorus" },
  { term: new RegExp(join("heavy[- ]?", "containment"), "i"), why: "queue renamed lantern-crew" },
  // The numbered class scale in copy (synthesis section 2, item 12): grades are spoken by name.
  {
    term: /\b(?:class|grade|level|category) (?:[1-5]|one|two|three|four|five|I{1,3}|IV|V)\b/i,
    why: "grades are spoken by name",
  },
  // Pending a name search before anything is public (tasks/T0-scaffold.md).
  { term: new RegExp(join("black", "wood"), "i"), why: "business-account name not yet searched" },
  // Existing ghost-removal fiction (spec section 2: original IP only).
  { term: new RegExp(join("ghost", "\\s*busters?"), "i"), why: "borrowed franchise" },
  { term: new RegExp(join("who you gon", "na call"), "i"), why: "borrowed tagline" },
  { term: new RegExp(join("proton\\s+", "pack"), "i"), why: "borrowed prop" },
  { term: new RegExp(join("ecto", "[- ]?(?:1|plasm)"), "i"), why: "borrowed prop" },
  { term: new RegExp(join("\\bsli", "mer\\b"), "i"), why: "borrowed character" },
  { term: new RegExp(join("stay[- ]?pu", "ft"), "i"), why: "borrowed character" },
  { term: new RegExp(join("\\bgo", "zer\\b|\\bzu", "ul\\b"), "i"), why: "borrowed character" },
  { term: new RegExp(join("\\bpke\\b|\\bghost\\s+", "trap"), "i"), why: "borrowed prop" },
  { term: new RegExp(join("this house is ", "clean"), "i"), why: "borrowed line" },
  // Draft details the synthesis struck (section 2, item 12).
  { term: /ghost[- ]story line/i, why: "no such line exists" },
  { term: /\bJo\b/, why: "not in the cast" },
  { term: /cannot consent/i, why: "consent gag replaced" },
  // Safety: a fictional line is never an emergency line.
  { term: /\b(?:dial|call) 911\b/i, why: "use your local emergency number (911 in the US)" },
  {
    term: /\bthis is an emergency (?:line|service)\b/i,
    why: "the hotline is not an emergency service",
  },
  // The prank path stays polite (spec section 2) and never accuses.
  { term: /\b(?:idiot|stupid|moron|loser|pathetic)\b/i, why: "never insults the caller" },
  {
    term: /\b(?:liar|lying|prank call|wasting our time|time waster)\b/i,
    why: "the prank path never accuses the caller",
  },
];

describe("copy", () => {
  it("reads every document's copy, so an empty scan cannot pass", () => {
    expect(copy.length).toBeGreaterThan(40);
  });

  it("reads the Lambdas' spoken strings too", () => {
    const where = new Set(lambdaCopy.map((c) => c.where));
    expect(where).toContain("lambdas/classify-apparition");
    expect(lambdaCopy.some((c) => c.text.includes("kettle"))).toBe(true);
  });

  it.each(["hh-greeting-standard", "hh-greeting-halloween"])(
    "%s carries the brand, the emergency line word for word, and the recording notice",
    (name) => {
      const text = copy
        .filter((c) => c.where.startsWith(`${name}#`))
        .map((c) => c.text)
        .join(" ");
      expect(text).toContain("Hollow Hour Removal Co.");
      expect(text).toContain(EMERGENCY_LINE);
      expect(text).toMatch(/recorded/);
    },
  );

  it("repeats the emergency line when the greeting module fails", () => {
    const fallback = copy.find((c) => c.where === "hh-hotline-main#fallback-greeting");
    expect(fallback?.text).toContain(EMERGENCY_LINE);
  });

  // T2 criterion 5: the prank path ends with a kind sentence, never an accusation.
  it("ends the prank path kindly: the goodbye thanks the caller and invites them back", () => {
    const goodbye = copy.find((c) => c.where === "hh-hotline-main#dare-goodbye");
    expect(goodbye?.text).toMatch(/^Thanks /);
    expect(goodbye?.text).toMatch(/Call back any time/);
    expect(goodbye?.text).not.toMatch(/\b(?:prank|dare|fake|lie|joke)\b/i);
    const ask = copy.find((c) => c.where === "hh-hotline-main#kind-check");
    expect(ask?.text).toContain("that is all right");
  });

  it("names the local emergency number wherever it mentions 911", () => {
    const bad = copy.filter(
      (c) => /911/.test(c.text) && !c.text.includes("your local emergency number (911 in the US)"),
    );
    expect(bad.map((c) => c.where)).toEqual([]);
  });

  it("uses none of the banned terms", () => {
    const found = copy.flatMap((c) =>
      BANNED.filter((b) => b.term.test(c.text)).map(
        (b) => `${c.where}: ${String(b.term)} (${b.why})`,
      ),
    );
    expect(found).toEqual([]);
  });

  it("speaks no phone number outside 555-0100 to 555-0199", () => {
    const digits = /(?:\+?1[-. ]?)?(?:\(?\d{3}\)?[-. ]?)?\d{3}[-. ]?\d{4}\b/g;
    const found = copy.flatMap((c) =>
      [...c.text.matchAll(digits)]
        .map((m) => m[0])
        .filter((m) => !/555[-. ]?01\d\d$/.test(m))
        .map((m) => `${c.where}: ${m}`),
    );
    expect(found).toEqual([]);
  });
});
