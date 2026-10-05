/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// The simulate scenarios under scenarios/, checked offline: each is a valid
// scenario for the pinned flow-cli (its schema and cross-field rules), every
// token resolves against a deployed environment's references, and every
// prompt and keypad press it expects is one the flows actually make. A live
// run is an operator step against a deployed environment, never CI.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compileScenario, resolveScenario, type Scenario } from "@flow-as-code/core";
import { describe, expect, it } from "vitest";
import { scenarioProblems } from "../node_modules/@flow-as-code/cli/dist/simulate.js";
import { handler as callerLookup } from "../lambdas/caller-lookup/index.mjs";
import { handler as classify } from "../lambdas/classify-apparition/index.mjs";
import { loadDistricts } from "../generators/config.js";
import { addressMap, loadManifest } from "../generators/refs.js";
import {
  buildResourceMap,
  resolveAddress,
  scenarioKeys,
  stateResources,
} from "../scenarios/resource-map.mjs";

const ROOT = join(import.meta.dirname, "..");
const SCENARIOS = join(ROOT, "scenarios");

interface Action {
  Identifier: string;
  Type: string;
  Parameters: Record<string, unknown>;
  Transitions?: { Conditions?: { NextAction: string; Condition: { Operands: string[] } }[] };
}
interface Doc {
  name: string;
  kind: string;
  content: { Actions: Action[] };
}

const docsIn = (dir: string): Doc[] =>
  readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith(".flowdoc.json"))
    .map((f) => JSON.parse(readFileSync(join(ROOT, dir, f), "utf8")) as Doc);
const flows = docsIn("flows");
const actions = [...flows, ...docsIn("seasonal")].flatMap((d) => d.content.Actions);

const files = readdirSync(SCENARIOS).filter((f) => f.endsWith(".scenario.json"));
const scenarios = files.map((f) => ({
  file: f,
  scenario: JSON.parse(readFileSync(join(SCENARIOS, f), "utf8")) as Scenario,
}));

/** What a deployed environment's resource map holds: every mapped key and every flow. */
function fakeResourceMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const key of Object.keys(addressMap(loadManifest(), loadDistricts(), "dev"))) {
    map[key] = `resolved-${key}`;
  }
  for (const d of flows) map[`${d.kind}:${d.name}`] = `resolved-${d.name}`;
  return map;
}

describe("scenarios/", () => {
  it("holds S1 and S2", () => {
    expect(files).toContain("s1-safety-path.scenario.json");
    expect(files).toContain("s2-keypad-restless-old-town.scenario.json");
  });

  for (const { file, scenario } of scenarios) {
    describe(file, () => {
      it("is a valid scenario for the pinned flow-cli", () => {
        expect(scenarioProblems(scenario)).toEqual([]);
        expect(file).toBe(`${scenario.name}.scenario.json`);
      });

      it("ends the test, so the simulated contact never reaches an agent", () => {
        expect(scenario.endTest).not.toBe(false);
      });

      it("resolves every token against a deployed environment's references", () => {
        const resolved = JSON.stringify(
          resolveScenario(compileScenario(scenario), fakeResourceMap()),
        );
        expect(resolved).not.toContain("${cdref:");
      });

      it("expects only prompts the flows say, rendered with the attributes it asserts", () => {
        // A prompt such as "Welcome back, $.Attributes.callerName." is heard
        // with the value the scenario asserts for that attribute.
        const asserted = new Map(
          scenario.steps.flatMap((s) =>
            s.kind === "assert" && s.operator === "Equals" ? [[s.path, s.value] as const] : [],
          ),
        );
        const texts = actions
          .map((a) => a.Parameters.Text)
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.replace(/\$\.Attributes\.[A-Za-z0-9_]+/g, (p) => asserted.get(p) ?? p));
        const missing = scenario.steps
          .filter((s) => s.kind === "expect-prompt")
          .map((s) => ("contains" in s ? s.contains : ""))
          .filter((c) => c === undefined || !texts.some((t) => t.includes(c)));
        expect(missing).toEqual([]);
      });

      // The deployed stubs are not substituted, so what they return is what the
      // live run will assert. Replay the keypad answers through the flows'
      // UpdateFlowAttributes blocks into the classifier's inputs, and the
      // source number into caller-lookup, and hold the scenario's asserts to
      // what the stubs return.
      it("asserts what the deployed stub Lambdas return for its keypad answers and number", async () => {
        const asserted = new Map(
          scenario.steps.flatMap((s) =>
            s.kind === "assert" && s.operator === "Equals" ? [[s.path, s.value] as const] : [],
          ),
        );
        const answers: Record<string, string> = {};
        scenario.steps.forEach((step, i) => {
          if (step.kind !== "send-dtmf") return;
          const prompt = scenario.steps[i - 1];
          const contains =
            prompt?.kind === "expect-prompt" && "contains" in prompt ? prompt.contains : undefined;
          const input = actions.find(
            (a) =>
              a.Type === "GetParticipantInput" &&
              contains !== undefined &&
              typeof a.Parameters.Text === "string" &&
              a.Parameters.Text.includes(contains),
          );
          const target = input?.Transitions?.Conditions?.find((c) =>
            c.Condition.Operands.includes(step.value),
          )?.NextAction;
          const next = actions.find((a) => a.Identifier === target);
          if (next?.Type !== "UpdateFlowAttributes") return;
          const attrs = next.Parameters.FlowAttributes as Record<string, { Value: string }>;
          for (const [k, v] of Object.entries(attrs)) answers[k] = v.Value;
        });
        if (
          scenario.steps.some((s) => s.kind === "expect-lambda" && s.lambda.includes("classify"))
        ) {
          expect(Object.keys(answers).length).toBeGreaterThan(0);
          const out = await classify({ Details: { Parameters: answers } });
          if (asserted.has("$.Attributes.grade"))
            expect(out.grade).toBe(asserted.get("$.Attributes.grade"));
          if (asserted.has("$.Attributes.gradeName"))
            expect(out.gradeName).toBe(asserted.get("$.Attributes.gradeName"));
        }
        if (asserted.has("$.Attributes.callerName")) {
          const out = await callerLookup({
            Details: {
              ContactData: { CustomerEndpoint: { Address: scenario.entryPoint.sourcePhoneNumber } },
            },
          });
          expect(out.callerName).toBe(asserted.get("$.Attributes.callerName"));
        }
      });

      it("presses only keys the prompt it answers takes", () => {
        const wrong: string[] = [];
        scenario.steps.forEach((step, i) => {
          if (step.kind !== "send-dtmf") return;
          const prompt = scenario.steps[i - 1];
          const contains =
            prompt?.kind === "expect-prompt" && "contains" in prompt ? prompt.contains : "";
          const input = actions.find(
            (a) =>
              a.Type === "GetParticipantInput" &&
              typeof a.Parameters.Text === "string" &&
              contains !== undefined &&
              a.Parameters.Text.includes(contains),
          );
          const accepted = (input?.Transitions?.Conditions ?? []).flatMap(
            (c) => c.Condition.Operands,
          );
          if (!accepted.includes(step.value))
            wrong.push(`step ${String(i)}: ${step.value} after "${String(contains)}"`);
        });
        expect(wrong).toEqual([]);
      });
    });
  }
});

describe("scenarios/resource-map.mjs", () => {
  // Stand-in values: the real ones are ARNs, which never enter the tree.
  const state = {
    values: {
      root_module: {
        resources: [
          {
            mode: "managed",
            type: "aws_connect_queue",
            name: "crew",
            index: "old-town",
            values: { arn: "q-old-town" },
          },
          {
            mode: "managed",
            type: "aws_connect_hours_of_operation",
            name: "always_open",
            values: { arn: "h-always" },
          },
          {
            mode: "data",
            type: "terraform_remote_state",
            name: "seasonal",
            values: { outputs: { greeting_standard_live_arn: "m-standard" } },
          },
          {
            mode: "managed",
            type: "flowascode_contact_flow",
            name: "hh_hotline_main",
            values: { name: "hh-hotline-main", arn: "f-main" },
          },
        ],
        child_modules: [
          {
            resources: [
              {
                mode: "managed",
                type: "aws_connect_queue",
                name: "nested",
                values: { arn: "q-nested" },
              },
            ],
          },
        ],
      },
    },
  };
  const resources = stateResources(state);

  it("reads every resource, child modules included", () => {
    expect(resources).toHaveLength(5);
  });

  it("resolves indexed, plain and remote-state addresses, and nothing else", () => {
    expect(resolveAddress(resources, 'aws_connect_queue.crew["old-town"].arn')).toBe("q-old-town");
    expect(resolveAddress(resources, "aws_connect_hours_of_operation.always_open.arn")).toBe(
      "h-always",
    );
    expect(
      resolveAddress(
        resources,
        "data.terraform_remote_state.seasonal.outputs.greeting_standard_live_arn",
      ),
    ).toBe("m-standard");
    expect(resolveAddress(resources, 'aws_connect_queue.crew["harborside"].arn')).toBeUndefined();
    expect(resolveAddress(resources, "aws_connect_queue.crew.arn")).toBeUndefined();
    expect(resolveAddress(resources, "not an address")).toBeUndefined();
  });

  it("maps flows by name and reports what the state lacks", () => {
    const { map, missing } = buildResourceMap(
      {
        "queue:old-town-crew": 'aws_connect_queue.crew["old-town"].arn',
        "prompt:salt-line-tips": "awscc_connect_prompt.salt_line_tips.prompt_arn",
      },
      resources,
    );
    expect(map).toEqual({ "flow:hh-hotline-main": "f-main", "queue:old-town-crew": "q-old-town" });
    expect(missing).toEqual([
      "prompt:salt-line-tips (awscc_connect_prompt.salt_line_tips.prompt_arn)",
    ]);
  });

  it("knows which keys the scenarios need", () => {
    const keys = scenarioKeys(SCENARIOS);
    expect(keys).toContain("flow:hh-hotline-main");
    expect(keys).toContain("lambda:classify-apparition");
    expect(keys).toContain("hours:the-dead");
  });
});
