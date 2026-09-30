/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// The apparition rubric (spec 5.2, grades renamed): six yes/no signals, a
// score, a grade, and the injury override. Every score the six answers can
// make is checked, each boundary is named, and so is every one of the 64
// possible interviews.

import { describe, expect, it } from "vitest";
import {
  GRADES,
  INJURED_ADVICE,
  gradeFor,
  handler,
  SIGNALS,
} from "../lambdas/classify-apparition/index.mjs";

type Answers = Partial<Record<(typeof SIGNALS)[number][0] | string, string>>;

/** A Connect invocation event carrying the answers as function parameters. */
const event = (parameters: Answers, attributes: Answers = {}) => ({
  Name: "ContactFlowEvent",
  Details: {
    ContactData: { Attributes: attributes, Channel: "VOICE" },
    Parameters: parameters,
  },
});

/** Keypad answers ("1" yes, "2" no) for a set of yes signals. */
const keypad = (yes: string[]): Answers =>
  Object.fromEntries(SIGNALS.map(([name]) => [name, yes.includes(name) ? "1" : "2"]));

/** One interview per score from 0 to 10, each the fewest yes answers that make it. */
const INTERVIEW_FOR_SCORE: Record<number, string[]> = {
  0: [],
  1: ["coldSpot"],
  2: ["canSee"],
  3: ["multiple"],
  4: ["multiple", "sounds"],
  5: ["multiple", "canSee"],
  6: ["multiple", "canSee", "sounds"],
  7: ["multiple", "canSee", "touchedYou"],
  8: ["multiple", "canSee", "touchedYou", "sounds"],
  9: ["multiple", "canSee", "touchedYou", "sounds", "coldSpot"],
  10: ["multiple", "canSee", "touchedYou", "sounds", "coldSpot", "movesObjects"],
};

/** The spec's table, written out rather than derived, so the test is independent. */
const EXPECTED: Record<number, [string, string]> = {
  0: ["1", "Faint"],
  1: ["1", "Faint"],
  2: ["2", "Restless"],
  3: ["2", "Restless"],
  4: ["3", "Manifest"],
  5: ["3", "Manifest"],
  6: ["4", "Hostile"],
  7: ["4", "Hostile"],
  8: ["5", "Chorus"],
  9: ["5", "Chorus"],
  10: ["5", "Chorus"],
};

describe("classify-apparition: the signals and the scale", () => {
  it("weighs the six signals as the spec does", () => {
    expect(Object.fromEntries(SIGNALS)).toEqual({
      canSee: 2,
      movesObjects: 1,
      coldSpot: 1,
      sounds: 1,
      touchedYou: 2,
      multiple: 3,
    });
  });

  it("uses the original grade names, the fifth being Chorus", () => {
    expect(GRADES.map((g) => g.name)).toEqual([
      "Faint",
      "Restless",
      "Manifest",
      "Hostile",
      "Chorus",
    ]);
  });
});

describe("classify-apparition: every boundary", () => {
  for (const [score, yes] of Object.entries(INTERVIEW_FOR_SCORE)) {
    const [grade, name] = EXPECTED[Number(score)] ?? [];
    it(`scores ${score}${Number(score) >= 9 ? " (9 or more)" : ""} as grade ${String(grade)} ${String(name)}`, async () => {
      const out = await handler(event(keypad(yes)));
      expect(out.score).toBe(score);
      expect(out.grade).toBe(grade);
      expect(out.gradeName).toBe(name);
      expect(out.safety).toBe("none");
    });
  }

  it("grades all 64 interviews by the table", async () => {
    const names = SIGNALS.map(([n]) => n);
    for (let mask = 0; mask < 64; mask += 1) {
      const yes = names.filter((_, i) => (mask >> i) & 1);
      const score = SIGNALS.reduce((sum, [n, p]) => sum + (yes.includes(n) ? p : 0), 0);
      const out = await handler(event(keypad(yes)));
      expect([out.score, out.grade, out.gradeName], yes.join(",")).toEqual([
        String(score),
        ...(EXPECTED[score] ?? []),
      ]);
    }
  });

  it("agrees with gradeFor at each grade's first score and the score before it", () => {
    for (const g of GRADES) {
      expect(gradeFor(g.from).grade).toBe(g.grade);
      if (g.from > 0) expect(gradeFor(g.from - 1).grade).toBe(g.grade - 1);
    }
  });
});

describe("classify-apparition: the injury override", () => {
  it("returns safety 911 and the injured advice at the lowest score", async () => {
    const out = await handler(event({ ...keypad([]), anyoneHurt: "1" }));
    expect(out).toMatchObject({ grade: "1", safety: "911", advice: INJURED_ADVICE });
  });

  it("returns safety 911 at the highest score too, and keeps the grade so the job routes", async () => {
    const out = await handler(event({ ...keypad(INTERVIEW_FOR_SCORE[10] ?? []), anyoneHurt: "1" }));
    expect(out).toMatchObject({
      grade: "5",
      gradeName: "Chorus",
      safety: "911",
      advice: INJURED_ADVICE,
      crewQueue: "lantern-crew",
    });
  });

  it("reads what hh-hotline-main passes: yes and no, touched and injured", async () => {
    const out = await handler(
      event({
        canSee: "no",
        movesObjects: "yes",
        coldSpot: "no",
        sounds: "yes",
        touched: "no",
        multiple: "no",
        injured: "no",
      }),
    );
    expect(out).toMatchObject({ score: "2", grade: "2", gradeName: "Restless", safety: "none" });
    expect((await handler(event({ touched: "yes", injured: "yes" }))).score).toBe("2");
    expect((await handler(event({ injured: "yes" }))).safety).toBe("911");
  });

  it("reads the override from injury or hurt, and from a contact attribute", async () => {
    expect((await handler(event({ injury: "yes" }))).safety).toBe("911");
    expect((await handler(event({ hurt: "true" }))).safety).toBe("911");
    expect((await handler(event({}, { anyoneHurt: "1" }))).safety).toBe("911");
  });

  it("does not fire on a no", async () => {
    for (const no of ["2", "no", "false", "", "0"]) {
      expect((await handler(event({ anyoneHurt: no }))).safety, no).toBe("none");
    }
  });

  // hh-hotline-main has already given the emergency line and the caller chose
  // to stay on; the advice played next, right before the district menu, must
  // not tell them to hang up.
  it("does not tell a caller who chose to stay on to hang up", () => {
    expect(INJURED_ADVICE).not.toMatch(/hang up|911|emergency/i);
  });
});
