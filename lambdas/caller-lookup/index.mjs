/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// lambda:caller-lookup. Recognizes a caller by the number they call from,
// against a fixed list of fictional callers. Invoked from hh-hotline-main with
// ResponseType JSON, because callerName carries spaces and punctuation
// (VERIFY L1); the object is still flat and every value a string.
// https://docs.aws.amazon.com/connect/latest/adminguide/connect-lambda-functions.html
//
// Every number is in the fictional 555-0100 to 555-0199 range. A real
// deployment would look callers up in a CRM; this one never leaves the file.

/**
 * @typedef {{ callerName: string, status: "known" | "account", tier: string,
 *   homeDistrict: string, accountName: string }} Caller
 */

/** @type {Readonly<Record<string, Caller>>} keyed by the last ten digits */
export const CALLERS = {
  // Kitchen cupboards that open themselves at 2 am.
  4135550142: {
    callerName: "Mrs. Alder",
    status: "known",
    tier: "resident",
    homeDistrict: "old-town",
    accountName: "none",
  },
  // A business account: three properties and a very old east wing.
  4135550107: {
    callerName: "the front desk",
    status: "account",
    tier: "account",
    homeDistrict: "harborside",
    accountName: "The Wexmoor Grand",
  },
  // Calls on a dare, usually around Halloween.
  4135550166: {
    callerName: "Theo",
    status: "known",
    tier: "resident",
    homeDistrict: "graveyard-hill",
    accountName: "none",
  },
};

/** What a caller the list does not know gets back. */
export const NEW_CALLER = {
  callerName: "friend",
  status: "new",
  tier: "new",
  homeDistrict: "unknown",
  accountName: "none",
};

/**
 * The last ten digits of an E.164 or formatted number, or "" when there are
 * fewer than ten.
 * @param {unknown} address
 */
export function tenDigits(address) {
  if (typeof address !== "string") return "";
  const digits = address.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

/**
 * @param {any} event
 * @returns {Promise<Record<string, string>>}
 */
export async function handler(event) {
  const details = event?.Details ?? {};
  const address =
    details.Parameters?.callerNumber ?? details.ContactData?.CustomerEndpoint?.Address;
  const key = tenDigits(address);
  const caller = CALLERS[/** @type {keyof typeof CALLERS} */ (key)] ?? NEW_CALLER;
  return { ...caller, found: caller === NEW_CALLER ? "false" : "true" };
}
