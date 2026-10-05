/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// lambda:prank-score. A deterministic screen for October's dares, run for
// every caller after triage (Tier 2). Invoked with ResponseType JSON, like
// every stub here (VERIFY.md, row L1).
// https://docs.aws.amazon.com/connect/latest/adminguide/connect-lambda-functions.html
//
// It never screens out a caller who said someone is hurt: safety first,
// whatever the score.

/** Fictional numbers that have called on a dare before, last ten digits. */
export const KNOWN_DARES = new Set(["4135550166"]);

/** The six interview answers; all six "yes" at once is the classic dare. */
export const ANSWERS = ["canSee", "movesObjects", "coldSpot", "sounds", "touchedYou", "multiple"];

/** A score at or above this is a prank. */
export const HIGH_FROM = 50;

/**
 * @param {unknown} value
 */
function isYes(value) {
  return (
    typeof value === "string" && ["1", "yes", "y", "true"].includes(value.trim().toLowerCase())
  );
}

/**
 * @param {any} event
 * @returns {Promise<Record<string, string>>}
 */
export async function handler(event) {
  const details = event?.Details ?? {};
  /** @param {string} name */
  const input = (name) => details.Parameters?.[name] ?? details.ContactData?.Attributes?.[name];

  if (isYes(input("anyoneHurt"))) {
    return { score: "0", verdict: "low", reason: "safety-first" };
  }
  const address = input("callerNumber") ?? details.ContactData?.CustomerEndpoint?.Address;
  const digits = typeof address === "string" ? address.replace(/\D/g, "").slice(-10) : "";

  let score = 0;
  const reasons = [];
  if (KNOWN_DARES.has(digits)) {
    score += 50;
    reasons.push("known-number");
  }
  if (ANSWERS.every((a) => isYes(input(a)))) {
    score += 30;
    reasons.push("everything-at-once");
  }
  const resets = Number(input("menuResets") ?? "0");
  if (Number.isFinite(resets) && resets >= 3) {
    score += 20;
    reasons.push("menu-loops");
  }
  return {
    score: String(score),
    verdict: score >= HIGH_FROM ? "high" : "low",
    reason: reasons.length === 0 ? "none" : reasons.join("-and-"),
  };
}
