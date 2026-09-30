/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// lambda:crew-eta. Estimates when a district's crew can reach the caller,
// deterministically: a base per district plus five minutes per caller ahead,
// capped. Invoked from hh-queue-experience-<slug> with ResponseType JSON,
// because crewName and message carry spaces (VERIFY L1).
// https://docs.aws.amazon.com/connect/latest/adminguide/connect-lambda-functions.html
//
// Input parameters: district (a slug), queueSize (for example
// $.Metrics.Queue.Size, which the flow reads after GetMetricData; absent or
// not a number counts as zero). District names come from HH_DISTRICTS, as for
// district-for-address.

export const BASE_MINUTES = 20;
export const STEP_PER_DISTRICT = 5;
export const PER_CALLER = 5;
export const CAP_MINUTES = 90;

/**
 * @returns {{ slug: string, name: string }[]}
 */
function districts() {
  try {
    const parsed = JSON.parse(process.env.HH_DISTRICTS ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {number} minutes
 */
export function bandFor(minutes) {
  if (minutes <= 30) return "soon";
  if (minutes <= 60) return "within-the-hour";
  return "later";
}

/**
 * @param {any} event
 * @returns {Promise<Record<string, string>>}
 */
export async function handler(event) {
  const params = event?.Details?.Parameters ?? {};
  const known = districts();
  const index = known.findIndex((d) => d.slug === params.district);
  const ahead = Math.max(0, Math.floor(Number(params.queueSize ?? "0")) || 0);
  const base = BASE_MINUTES + Math.max(0, index) * STEP_PER_DISTRICT;
  const minutes = Math.min(CAP_MINUTES, base + ahead * PER_CALLER);
  const crew = index >= 0 ? `The ${known[index]?.name ?? ""} crew` : "A crew";
  return {
    etaMinutes: String(minutes),
    etaBand: bandFor(minutes),
    crewName: crew,
    message: `${crew} can be with you in about ${String(minutes)} minutes.`,
  };
}
