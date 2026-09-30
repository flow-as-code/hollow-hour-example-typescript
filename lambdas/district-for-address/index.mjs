/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// lambda:district-for-address. Picks the district for a spoken or typed
// address (Tier 2, from hh-collect-address). To be invoked with ResponseType
// JSON, because districtName carries spaces (VERIFY L1).
// https://docs.aws.amazon.com/connect/latest/adminguide/connect-lambda-functions.html
//
// The districts come from HH_DISTRICTS, a JSON array of {slug, name} that the
// environment root writes from districts.config.json, so a new district needs
// no change here. Street words pick a district when that district exists; a
// numeric postcode falls back to its remainder over the district count.

/** Words in an address that place it, by district slug. */
export const STREET_WORDS = {
  harborside: ["harbor", "harbour", "wharf", "pier", "quay", "dock", "lighthouse"],
  "graveyard-hill": ["cemetery", "chapel", "hill", "yew", "mausoleum"],
  "old-town": ["market", "cobble", "old", "square", "lane"],
};

/**
 * @returns {{ slug: string, name: string }[]}
 */
export function districts() {
  try {
    const parsed = JSON.parse(process.env.HH_DISTRICTS ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((d) => typeof d?.slug === "string" && typeof d?.name === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * @param {any} event
 * @returns {Promise<Record<string, string>>}
 */
export async function handler(event) {
  const params = event?.Details?.Parameters ?? {};
  const known = districts();
  if (known.length === 0)
    return { district: "unknown", districtName: "unknown", matchedBy: "none" };
  /** @param {{ slug: string, name: string }} d @param {string} by */
  const found = (d, by) => ({ district: d.slug, districtName: d.name, matchedBy: by });

  const address = typeof params.address === "string" ? params.address.toLowerCase() : "";
  const words = address.split(/[^a-z]+/).filter(Boolean);
  for (const [slug, cues] of Object.entries(STREET_WORDS)) {
    const d = known.find((k) => k.slug === slug);
    if (d !== undefined && cues.some((c) => words.includes(c))) return found(d, "street");
  }
  const postcode = typeof params.postcode === "string" ? params.postcode.replace(/\D/g, "") : "";
  if (postcode !== "") {
    const d = known[Number(postcode) % known.length];
    if (d !== undefined) return found(d, "postcode");
  }
  const first = known[0];
  return first === undefined
    ? { district: "unknown", districtName: "unknown", matchedBy: "none" }
    : found(first, "default");
}
