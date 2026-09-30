/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// The two FlowDoc sets on disk, read the way flow-cli reads a directory: every
// `*.flowdoc.json`, sorted by name. flows/ is the emitted set; seasonal/ holds
// the greeting modules, emitted and applied on their own.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FlowAction, FlowDoc } from "@flow-as-code/core";
import { ROOT } from "./config.js";

export const SETS = ["flows", "seasonal"] as const;
export type SetName = (typeof SETS)[number];

export interface LoadedDoc {
  set: SetName;
  /** Path under the root, e.g. flows/hh-hotline-main.flowdoc.json. */
  path: string;
  /** The companion beside it. */
  companionPath: string;
  doc: FlowDoc;
}

export function loadSet(set: SetName, root = ROOT): LoadedDoc[] {
  return readdirSync(join(root, set))
    .filter((f) => f.endsWith(".flowdoc.json"))
    .sort()
    .map((f) => ({
      set,
      path: `${set}/${f}`,
      companionPath: `${set}/${f.replace(/\.flowdoc\.json$/, ".flow.ts")}`,
      doc: JSON.parse(readFileSync(join(root, set, f), "utf8")) as FlowDoc,
    }));
}

export function loadAll(root = ROOT): LoadedDoc[] {
  return SETS.flatMap((s) => loadSet(s, root));
}

/** Every string a participant can hear: Text and SSML, on every action that plays one. */
export function spokenTexts(action: FlowAction): string[] {
  const p = action.Parameters as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ["Text", "SSML"]) {
    if (typeof p[key] === "string") out.push(p[key]);
  }
  if (Array.isArray(p.Messages)) {
    for (const m of p.Messages as Record<string, unknown>[]) {
      for (const key of ["Text", "SSML"]) {
        if (typeof m[key] === "string") out.push(m[key]);
      }
    }
  }
  return out;
}
