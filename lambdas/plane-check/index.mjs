/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// lambda:plane-check. Decides which side of the veil a caller is on. Invoked
// from hh-hotline-main (Tier 2) with ResponseType STRING_MAP.
// https://docs.aws.amazon.com/connect/latest/adminguide/connect-lambda-functions.html
//
// The rule is a fixture, not a carrier lookup: numbers ending 555-0190 to
// 555-0199 are reserved for the departed. A caller can also say so, as the
// claimsBeyond parameter (the keypad's "press 9").

export const BEYOND_FROM = 190;
export const BEYOND_TO = 199;

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
  if (isYes(details.Parameters?.claimsBeyond)) {
    return { plane: "beyond", reason: "caller-said-so" };
  }
  const address =
    details.Parameters?.callerNumber ?? details.ContactData?.CustomerEndpoint?.Address;
  const digits = typeof address === "string" ? address.replace(/\D/g, "") : "";
  if (digits.length < 7) return { plane: "living", reason: "no-number" };
  const exchange = digits.slice(-7, -4);
  const line = Number(digits.slice(-4));
  if (exchange === "555" && line >= BEYOND_FROM && line <= BEYOND_TO) {
    return { plane: "beyond", reason: "reserved-range" };
  }
  return { plane: "living", reason: "ordinary-number" };
}
