/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// lambda:classify-apparition. Scores the keypad interview's six answers and
// returns the apparition grade, deterministically, so a test can assert every
// boundary. Invoked from hh-hotline-main with ResponseType JSON (VERIFY L1:
// STRING_MAP values may be held to alphanumeric, dash and underscore, and
// advice and gradeName carry spaces and punctuation). The object is still
// flat and every value a string.
// https://docs.aws.amazon.com/connect/latest/adminguide/connect-lambda-functions.html
//
// Input: each answer as a function input parameter (Details.Parameters) or,
// failing that, a contact attribute of the same name. "1", "yes", "y" and
// "true" mean yes (the keypad's 1); anything else, or nothing, means no.
//
//   canSee, movesObjects, coldSpot, sounds, touchedYou, multiple
//                touchedYou is also read as touched, the name hh-hotline-main
//                passes
//   anyoneHurt   the "Is anyone hurt?" answer; also read as injured (what
//                hh-hotline-main passes), injury or hurt
//   district     optional; names the crew for grades 1 to 3

/** Points per yes, in the order the keypad asks. */
export const SIGNALS = /** @type {const} */ ([
  ["canSee", 2],
  ["movesObjects", 1],
  ["coldSpot", 1],
  ["sounds", 1],
  ["touchedYou", 2],
  ["multiple", 3],
]);

/** The grade scale: the lowest score each grade starts at. */
export const GRADES = /** @type {const} */ ([
  {
    grade: 1,
    name: "Faint",
    from: 0,
    advice: "Open a window, put the kettle on, and note when it happens.",
  },
  {
    grade: 2,
    name: "Restless",
    from: 2,
    advice: "Put small breakables away and keep a light on in the room it favors.",
  },
  {
    grade: 3,
    name: "Manifest",
    from: 4,
    advice: "Do not follow it; wait in a bright room with the door open.",
  },
  {
    grade: 4,
    name: "Hostile",
    from: 6,
    advice: "Leave the room it is in and wait somewhere bright, with company if you can.",
  },
  {
    grade: 5,
    name: "Chorus",
    from: 8,
    advice: "Step outside with everyone in the house and wait there for the crew.",
  },
]);

/** Other names an answer arrives under, by the canonical name above. */
export const ALIASES = /** @type {Readonly<Record<string, readonly string[]>>} */ ({
  touchedYou: ["touched"],
});

/** The names the injury answer arrives under. */
export const INJURY_NAMES = ["anyoneHurt", "injured", "injury", "hurt"];

/**
 * The advice for a caller who said someone is hurt. By the time it is spoken,
 * hh-hotline-main has already given the emergency line ("your local emergency
 * number (911 in the US)") and the caller has chosen to stay on, so this does
 * not tell them to hang up again right before the district menu; hh-agent-whisper
 * speaks it to the crew, and safety "911" tells them why.
 */
export const INJURED_ADVICE =
  "A crew is on the way. Keep everyone together and look after whoever is hurt.";

/** Grades at or above this go to Bo's Lantern Crew instead of the district crew. */
export const LANTERN_CREW_FROM = 4;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isYes(value) {
  return (
    typeof value === "string" && ["1", "yes", "y", "true"].includes(value.trim().toLowerCase())
  );
}

/**
 * A named input: the function parameter first, then the contact attribute.
 * @param {any} event
 * @param {string} name
 * @returns {string | undefined}
 */
function input(event, name) {
  const details = event?.Details ?? {};
  const value = details.Parameters?.[name] ?? details.ContactData?.Attributes?.[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * @param {number} score
 */
export function gradeFor(score) {
  /** @type {(typeof GRADES)[number]} */
  let found = GRADES[0];
  for (const g of GRADES) if (score >= g.from) found = g;
  return found;
}

/**
 * @param {any} event
 * @returns {Promise<Record<string, string>>}
 */
export async function handler(event) {
  let score = 0;
  let answered = 0;
  for (const [name, points] of SIGNALS) {
    const answer = [name, ...(ALIASES[name] ?? [])]
      .map((n) => input(event, n))
      .find((v) => v !== undefined);
    if (answer !== undefined && answer !== "") answered += 1;
    if (isYes(answer)) score += points;
  }
  const { grade, name, advice } = gradeFor(score);
  const hurt = INJURY_NAMES.some((n) => isYes(input(event, n)));
  const district = input(event, "district");
  const crewQueue =
    grade >= LANTERN_CREW_FROM
      ? "lantern-crew"
      : district !== undefined && /^[a-z0-9-]+$/.test(district)
        ? `${district}-crew`
        : "district";
  return {
    grade: String(grade),
    gradeName: name,
    score: String(score),
    answered: String(answered),
    // The injury override: whatever the score, safety is 911 and the advice
    // is about the person who is hurt. The grade still stands, so the job
    // still routes.
    safety: hurt ? "911" : "none",
    advice: hurt ? INJURED_ADVICE : advice,
    crewQueue,
  };
}
