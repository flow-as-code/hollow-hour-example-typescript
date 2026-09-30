/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// A stand-in FlowDoc set for the environment tests, used only while flows/ or
// seasonal/ holds no FlowDocs. It references every key the address maps bind
// (read from refs/manifest.json, so a new key is covered without an edit here)
// plus one in-set flow, which is the most any real set can ask of the maps.
// Once the real flows exist the tests run against them instead, and this file
// matters only for the add-a-district and missing-binding checks.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDistricts } from "../generators/config.js";
import { addressMap, loadManifest } from "../generators/refs.js";

type Action = Record<string, unknown>;

const next = (to: string, errors = [{ ErrorType: "NoMatchingError", NextAction: "hang-up" }]) => ({
  NextAction: to,
  Errors: errors,
  Conditions: [],
});

/** One action that makes the given reference, in the shape Connect takes it. */
function actionFor(key: string, id: string, to: string): Action {
  const token = `\${cdref:${key}}`;
  const type = key.split(":")[0];
  switch (type) {
    case "queue":
      return {
        Identifier: id,
        Type: "UpdateContactTargetQueue",
        Parameters: { QueueId: token },
        Transitions: next(to),
      };
    case "hours":
      return {
        Identifier: id,
        Type: "CheckHoursOfOperation",
        Parameters: { HoursOfOperationId: token },
        Transitions: {
          NextAction: to,
          Errors: [{ ErrorType: "NoMatchingError", NextAction: "hang-up" }],
          Conditions: [
            { NextAction: to, Condition: { Operator: "Equals", Operands: ["True"] } },
            { NextAction: to, Condition: { Operator: "Equals", Operands: ["False"] } },
          ],
        },
      };
    case "lambda":
      return {
        Identifier: id,
        Type: "InvokeLambdaFunction",
        Parameters: {
          LambdaFunctionARN: token,
          InvocationTimeLimitSeconds: 3,
          InvocationType: "SYNCHRONOUS",
          ResponseValidation: { ResponseType: "STRING_MAP" },
        },
        Transitions: next(to),
      };
    case "module":
      return {
        Identifier: id,
        Type: "InvokeFlowModule",
        Parameters: { FlowModuleId: token },
        Transitions: next(to),
      };
    case "prompt":
      return {
        Identifier: id,
        Type: "MessageParticipant",
        Parameters: { PromptId: token },
        Transitions: next(to),
      };
    default:
      throw new Error(`fixture has no action for ${key}`);
  }
}

function flowDoc(name: string, kind: "flow" | "module", actions: Action[]) {
  return {
    flowdoc: "0.2",
    kind,
    name,
    connectType: kind === "module" ? "MODULE" : "CONTACT_FLOW",
    content: { Version: "2019-10-30", StartAction: actions[0]?.Identifier, Actions: actions },
  };
}

const hangUp = {
  Identifier: "hang-up",
  Type: "DisconnectParticipant",
  Parameters: {},
  Transitions: {},
};

/** Writes the fixture flow set into `dir` and returns the keys it references. */
export function writeFixtureFlows(dir: string, keys?: string[]): string[] {
  const refKeys = keys ?? Object.keys(addressMap(loadManifest(), loadDistricts(), "dev")).sort();
  const ids = refKeys.map((_, i) => `ref-${String(i)}`);
  const actions = refKeys.map((key, i) =>
    actionFor(key, ids[i] ?? "", ids[i + 1] ?? "to-district"),
  );
  actions.push({
    Identifier: "to-district",
    Type: "TransferToFlow",
    Parameters: { ContactFlowId: "${cdref:flow:hh-fixture-district}" },
    Transitions: next("hang-up"),
  });
  actions.push(hangUp);
  mkdirSync(dir, { recursive: true });
  const docs = [
    flowDoc("hh-fixture-main", "flow", actions),
    flowDoc("hh-fixture-district", "flow", [hangUp]),
  ];
  for (const doc of docs) {
    writeFileSync(join(dir, `${doc.name}.flowdoc.json`), `${JSON.stringify(doc, null, 2)}\n`);
  }
  return refKeys;
}

/** The two seasonal greeting modules, named as the seasonal roots expect. */
export function writeFixtureGreetings(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const season of ["standard", "halloween"]) {
    const doc = flowDoc(`hh-greeting-${season}`, "module", [
      {
        Identifier: "greet",
        Type: "MessageParticipant",
        Parameters: { Text: `Hollow Hour Removal, ${season} line.` },
        Transitions: {
          NextAction: "done",
          Errors: [{ ErrorType: "NoMatchingError", NextAction: "done" }],
          Conditions: [],
        },
      },
      { Identifier: "done", Type: "EndFlowModuleExecution", Parameters: {}, Transitions: {} },
    ]);
    writeFileSync(join(dir, `${doc.name}.flowdoc.json`), `${JSON.stringify(doc, null, 2)}\n`);
  }
}
