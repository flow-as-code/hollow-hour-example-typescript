/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// Which modeled action types and reference types the flows use so far. The
// showcase aims to use all of them by Tier 3; until then this reports what is
// missing and does not fail on it. It fails on what should never happen: an
// action type the catalog does not model (a GenericBlock) without an entry in
// ALLOWED_GENERIC saying why, or a type a landed tier used that a later
// change dropped (TIER_FLOOR).

import { collectRefs, modeledTypes, type FlowDoc } from "@flow-as-code/core";
import { describe, expect, it } from "vitest";
import { loadAll } from "../generators/flowset.js";
import { REF_TYPES } from "../generators/refs.js";

/** Unmodeled types a flow may carry as a GenericBlock, each with its reason. Tier 1 has none. */
const ALLOWED_GENERIC: Record<string, string> = {};

interface Floor {
  actionTypes: string[];
  flowTypes: string[];
  refTypes: string[];
}

/**
 * What the flows must use once a tier has landed, so a later change cannot
 * quietly drop a type the showcase exists to show. Tier 2's floor fills in
 * PR by PR (tasks/T2-full-moon.md, criterion 3) until it names
 * CreateCallbackContact, DistributeByPercentage, UntagContact,
 * UpdateContactCallbackNumber, UpdateContactData,
 * UpdateContactRecordingBehavior and UpdateContactRoutingBehavior, the two
 * hold flow types and the prompt reference type.
 */
const TIER_FLOOR: Record<string, Floor> = {
  "1": {
    actionTypes: [
      "CheckHoursOfOperation",
      "CheckMetricData",
      "Compare",
      "DequeueContactAndTransferToQueue",
      "DisconnectParticipant",
      "EndFlowExecution",
      "EndFlowModuleExecution",
      "GetMetricData",
      "GetParticipantInput",
      "InvokeFlowModule",
      "InvokeLambdaFunction",
      "Loop",
      "MessageParticipant",
      "MessageParticipantIteratively",
      "TagContact",
      "TransferContactToQueue",
      "TransferToFlow",
      "UpdateContactAttributes",
      "UpdateContactEventHooks",
      "UpdateContactRecordingAndAnalyticsBehavior",
      "UpdateContactTargetQueue",
      "UpdateContactTextToSpeechVoice",
      "UpdateFlowAttributes",
      "UpdateFlowLoggingBehavior",
    ],
    flowTypes: ["AGENT_WHISPER", "CONTACT_FLOW", "CUSTOMER_QUEUE", "CUSTOMER_WHISPER", "MODULE"],
    refTypes: ["flow", "hours", "lambda", "module", "queue"],
  },
  // T2 PR 2: the hold flows. PR 3: the dead line's three action types.
  // PR 4: the prank screen's UntagContact. PR 5: the work order's
  // UpdateContactData. PR 6: the callbacks' CreateCallbackContact. PR 7: the
  // hold A/B split's DistributeByPercentage and the prompt reference type.
  "2": {
    actionTypes: [
      "CreateCallbackContact",
      "DistributeByPercentage",
      "UntagContact",
      "UpdateContactCallbackNumber",
      "UpdateContactData",
      "UpdateContactRecordingBehavior",
      "UpdateContactRoutingBehavior",
    ],
    flowTypes: ["AGENT_HOLD", "CUSTOMER_HOLD"],
    refTypes: ["prompt"],
  },
};

type Doc = Pick<FlowDoc, "name" | "connectType" | "content">;

function usage(docs: Doc[]) {
  const actionTypes = new Map<string, Set<string>>();
  for (const d of docs) {
    for (const a of d.content.Actions) {
      actionTypes.set(a.Type, (actionTypes.get(a.Type) ?? new Set()).add(d.name));
    }
  }
  return {
    actionTypes,
    flowTypes: new Set<string>(docs.map((d) => d.connectType)),
    refTypes: new Set<string>(docs.flatMap((d) => collectRefs(d.content).map((r) => r.type))),
  };
}

/** What a floor asks for that these documents do not use. */
function floorProblems(docs: Doc[], floor: Floor): string[] {
  const used = usage(docs);
  return [
    ...floor.actionTypes.filter((t) => !used.actionTypes.has(t)).map((t) => `action type ${t}`),
    ...floor.flowTypes.filter((t) => !used.flowTypes.has(t)).map((t) => `flow type ${t}`),
    ...floor.refTypes.filter((t) => !used.refTypes.has(t)).map((t) => `reference type ${t}`),
  ];
}

const docs = loadAll().map((l) => l.doc);
const { actionTypes: usedTypes, refTypes: usedRefTypes } = usage(docs);
const modeled = modeledTypes().sort();

describe("coverage", () => {
  it("reports the modeled action types used and missing", () => {
    const used = modeled.filter((t) => usedTypes.has(t));
    const missing = modeled.filter((t) => !usedTypes.has(t));
    const lines = [
      `Modeled action types used: ${String(used.length)} of ${String(modeled.length)}`,
      ...used.map((t) => `  used     ${t} (${[...(usedTypes.get(t) ?? [])].sort().join(", ")})`),
      ...missing.map((t) => `  missing  ${t}`),
      `Reference types used: ${String(usedRefTypes.size)} of ${String(REF_TYPES.length)}`,
      ...REF_TYPES.map((r) => `  ${usedRefTypes.has(r) ? "used   " : "missing"}  ${r}`),
    ];
    console.log(lines.join("\n"));
    expect(used.length + missing.length).toBe(modeled.length);
  });

  it("uses no unmodeled action type without a recorded reason", () => {
    const generic = [...usedTypes.keys()].filter(
      (t) => !modeled.includes(t) && !(t in ALLOWED_GENERIC),
    );
    expect(generic).toEqual([]);
  });

  it("catches a dropped flow type or action type, so the floors mean something", () => {
    const withoutHolds = docs.filter((d) => !/_HOLD$/.test(d.connectType));
    expect(
      floorProblems(
        withoutHolds,
        TIER_FLOOR["2"] ?? { actionTypes: [], flowTypes: [], refTypes: [] },
      ),
    ).toEqual(["flow type AGENT_HOLD", "flow type CUSTOMER_HOLD"]);
    const withoutLoops = docs.map((d) => ({
      ...d,
      content: { ...d.content, Actions: d.content.Actions.filter((a) => a.Type !== "Loop") },
    }));
    expect(
      floorProblems(
        withoutLoops,
        TIER_FLOOR["1"] ?? { actionTypes: [], flowTypes: [], refTypes: [] },
      ),
    ).toEqual(["action type Loop"]);
    const withoutPrompt = docs.map((d) => ({
      ...d,
      content: {
        ...d.content,
        Actions: d.content.Actions.map((a) =>
          a.Type === "MessageParticipantIteratively"
            ? {
                ...a,
                Parameters: {
                  ...a.Parameters,
                  Messages: (a.Parameters.Messages as { PromptId?: string }[]).map((m) =>
                    "PromptId" in m ? { Text: "spoken instead" } : m,
                  ),
                },
              }
            : a,
        ),
      },
    }));
    expect(
      floorProblems(
        withoutPrompt,
        TIER_FLOOR["2"] ?? { actionTypes: [], flowTypes: [], refTypes: [] },
      ),
    ).toEqual(["reference type prompt"]);
  });

  it.each(Object.entries(TIER_FLOOR))("meets the tier %s floor", (_tier, floor) => {
    expect(floorProblems(docs, floor)).toEqual([]);
  });

  it("names only modeled action types in the floors", () => {
    for (const floor of Object.values(TIER_FLOOR)) {
      expect(floor.actionTypes.filter((t) => !modeled.includes(t))).toEqual([]);
    }
  });

  it("uses only the eight reference types the catalog defines", () => {
    expect([...usedRefTypes].filter((r) => !(REF_TYPES as readonly string[]).includes(r))).toEqual(
      [],
    );
  });
});
