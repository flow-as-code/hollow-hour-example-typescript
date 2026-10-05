/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// The Tier 1 flow set: lint clean as flow-cli runs it, the shape the
// synthesis settled for each flow, and references that agree with the
// manifest and the districts.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  codegen,
  collectRefs,
  lint,
  modeledTypes,
  refKey,
  type FlowAction,
  type FlowDoc,
} from "@flow-as-code/core";
import { describe, expect, it } from "vitest";
import { loadDistricts, ROOT } from "../generators/config.js";
import { loadAll, loadSet, spokenTexts } from "../generators/flowset.js";
import { expandAll, loadManifest } from "../generators/refs.js";

const CLI = join(ROOT, "node_modules", "@flow-as-code", "cli", "dist", "bin.js");
const flows = loadSet("flows");
const seasonal = loadSet("seasonal");
const districts = loadDistricts();
const byName = new Map(loadAll().map((l) => [l.doc.name, l.doc]));

function doc(name: string): FlowDoc {
  const found = byName.get(name);
  if (found === undefined) throw new Error(`no FlowDoc named ${name}`);
  return found;
}
const action = (d: FlowDoc, id: string): FlowAction => {
  const found = d.content.Actions.find((a) => a.Identifier === id);
  if (found === undefined) throw new Error(`${d.name} has no action ${id}`);
  return found;
};
const types = (d: FlowDoc) => new Set(d.content.Actions.map((a) => a.Type));

describe("lint", () => {
  it("has the Tier 1 and Tier 2 documents to lint", () => {
    const names = [...byName.keys()];
    for (const n of [
      "hh-hotline-main",
      "hh-customer-whisper",
      "hh-agent-whisper",
      "hh-customer-hold",
      "hh-agent-hold",
      "hh-greeting-standard",
      "hh-greeting-halloween",
      "hh-district-menu",
      ...districts.flatMap((d) => [`hh-district-${d.slug}`, `hh-queue-experience-${d.slug}`]),
    ]) {
      expect(names).toContain(n);
    }
  });

  it.each([
    ["flows", flows],
    ["seasonal", seasonal],
  ] as const)("%s/ has no findings at all, warnings included (library)", (_set, loaded) => {
    expect(lint(loaded.map((l) => l.doc))).toEqual([]);
  });

  it.each(["flows", "seasonal"])(
    "flow-cli lint %s reports no findings (schema included)",
    (set) => {
      const run = spawnSync(process.execPath, [CLI, "lint", set, "--format", "json"], {
        cwd: ROOT,
        encoding: "utf8",
      });
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual({
        findings: [],
        summary: { errors: 0, total: 0, warnings: 0 },
      });
    },
  );
});

// A modeled action written as a GenericBlock in a companion is a shape the
// typed builder cannot express (0.2.0's Compare without NextAction, VERIFY C1;
// 0.2.1's GetParticipantInput with StoreInput "True", the gate on task T2's
// hh-collect-address). It deploys, but the studio and codegen lose the typed
// view of it, and the showcase exists to show the typed path. The coverage
// test's ALLOWED_GENERIC governs unmodeled types only and would pass such a
// block, so this holds it: every GenericBlock in flows/ and seasonal/ is of a
// type the catalog does not model.
describe("generic blocks", () => {
  const modeled = modeledTypes();
  const genericTypes = (companion: string) =>
    [...companion.matchAll(/new GenericBlock\(\{[\s\S]*?\btype: "([A-Za-z]+)"/g)].map(
      (m) => m[1] ?? "",
    );

  it("catches a modeled type codegen can only write generically, so the policy means something", () => {
    const main = structuredClone(doc("hh-hotline-main"));
    action(main, "ask-can-see").Parameters.StoreInput = "True";
    expect(genericTypes(codegen(main))).toEqual(["GetParticipantInput"]);
    expect(genericTypes(codegen(doc("hh-hotline-main")))).toEqual([]);
  });

  it.each(loadAll().map((l) => [l.companionPath, l] as const))(
    "%s writes no GenericBlock for a type the catalog models",
    (_path, l) => {
      const companion = readFileSync(join(ROOT, l.companionPath), "utf8");
      expect(genericTypes(companion).filter((t) => modeled.includes(t))).toEqual([]);
    },
  );
});

describe("names and references", () => {
  it("prefixes every flow and module name with hh- and sets no displayName", () => {
    for (const d of byName.values()) {
      expect(d.name).toMatch(/^hh-/);
      expect(d.displayName).toBeUndefined();
    }
  });

  it("keeps the greetings out of the emitted set and the flows out of seasonal/", () => {
    expect(seasonal.every((l) => l.doc.kind === "module")).toBe(true);
    expect(flows.every((l) => l.doc.kind === "flow")).toBe(true);
  });

  const flowRefs = flows.flatMap((l) =>
    collectRefs(l.doc.content).map((r) => ({ doc: l.doc.name, r })),
  );

  it("resolves every in-set flow reference to a document in flows/", () => {
    const names = new Set(flows.map((l) => l.doc.name));
    const dangling = flowRefs
      .filter(({ r }) => r.type === "flow" && !names.has(r.name))
      .map(({ doc: d, r }) => `${d}: ${r.token}`);
    expect(dangling).toEqual([]);
  });

  it("reaches out of the set only through module:greeting@live", () => {
    const modules = [
      ...new Set(flowRefs.filter(({ r }) => r.type === "module").map(({ r }) => refKey(r))),
    ];
    expect(modules).toEqual(["module:greeting@live"]);
  });

  // The key-use rule (tasks/T2-full-moon.md): every key a flow uses is a
  // tier 1 or 2 key, and every tier 1 or 2 key is used by a flow or named by
  // a scenario as a substitute, except the keys in UNUSED_UNTIL, each dated
  // and naming the gate that will use it. A listed key a flow does use fails
  // too, so the list cannot go stale.
  const UNUSED_UNTIL: Record<string, { gate: string; since: string }> = {
    "queue:the-dead": { gate: "T2 PR 3, hh-dead-line", since: "2026-10-05" },
    "lambda:plane-check": { gate: "T2 PR 3, plane-check in hh-hotline-main", since: "2026-10-05" },
    "flow:hh-dead-line": { gate: "T2 PR 3, hh-hotline-main", since: "2026-10-05" },
    "flow:hh-dead-whisper": { gate: "T2 PR 3, hh-dead-line", since: "2026-10-05" },
    "flow:hh-dead-hold": { gate: "T2 PR 3, hh-dead-line", since: "2026-10-05" },
    "flow:hh-dead-queue-experience": { gate: "T2 PR 3, hh-dead-line", since: "2026-10-05" },
    "lambda:prank-score": { gate: "T2 PR 4, the prank screen", since: "2026-10-05" },
    "module:hh-offer-callback": { gate: "T2 PR 6, callbacks", since: "2026-10-05" },
    "prompt:salt-line-tips": {
      gate: "T2 PR 7, the prompt and the A/B split",
      since: "2026-10-05",
    },
    "module:hh-collect-address": {
      gate: "T2 PR 8, once flow-as-code C11 is on npm",
      since: "2026-10-05",
    },
    "lambda:district-for-address": {
      gate: "T2 PR 8, hh-collect-address; the Lambda stays deployed, since tests/envSupporting.test.ts deploys exactly the manifest's lambda: keys",
      since: "2026-10-05",
    },
  };

  function keyUseProblems(
    used: Set<string>,
    tier12: Set<string>,
    substitutes: Set<string>,
    unusedUntil: Set<string>,
  ): string[] {
    const out: string[] = [];
    for (const k of [...used].sort()) {
      if (!tier12.has(k)) out.push(`${k}: used by a flow but not a tier 1 or 2 key`);
    }
    for (const k of [...tier12].sort()) {
      if (!used.has(k) && !substitutes.has(k) && !unusedUntil.has(k)) {
        out.push(`${k}: a tier 1 or 2 key no flow uses and no scenario substitutes`);
      }
    }
    for (const k of [...unusedUntil].sort()) {
      if (!tier12.has(k)) out.push(`${k}: in UNUSED_UNTIL but not a tier 1 or 2 key`);
      if (used.has(k) || substitutes.has(k)) out.push(`${k}: in UNUSED_UNTIL but used`);
    }
    return out;
  }

  const tier12 = new Set(
    expandAll(loadManifest(), districts)
      .filter((e) => e.tier === 1 || e.tier === 2)
      .map((e) => e.key),
  );
  const used = new Set(flowRefs.map(({ r }) => refKey(r)));
  const substitutes = new Set(
    readdirSync(join(ROOT, "scenarios"))
      .filter((f) => f.endsWith(".scenario.json"))
      .flatMap((f) => {
        const scenario = JSON.parse(readFileSync(join(ROOT, "scenarios", f), "utf8")) as {
          substitutions?: { substitute: string }[];
        };
        return (scenario.substitutions ?? []).map(
          (sub) => /^\$\{cdref:(.+)\}$/.exec(sub.substitute)?.[1] ?? sub.substitute,
        );
      }),
  );

  it("catches a key outside tiers 1 and 2, an unused key, and a stale UNUSED_UNTIL entry", () => {
    expect(
      keyUseProblems(new Set(["queue:a", "lex:b"]), new Set(["queue:a"]), new Set(), new Set()),
    ).toEqual(["lex:b: used by a flow but not a tier 1 or 2 key"]);
    expect(
      keyUseProblems(new Set(["queue:a"]), new Set(["queue:a", "queue:c"]), new Set(), new Set()),
    ).toEqual(["queue:c: a tier 1 or 2 key no flow uses and no scenario substitutes"]);
    expect(
      keyUseProblems(
        new Set(["queue:a"]),
        new Set(["queue:a", "queue:c"]),
        new Set(["queue:c"]),
        new Set(),
      ),
    ).toEqual([]);
    expect(
      keyUseProblems(new Set(["queue:a"]), new Set(["queue:a"]), new Set(), new Set(["queue:a"])),
    ).toEqual(["queue:a: in UNUSED_UNTIL but used"]);
  });

  it("uses tier 1 and 2 keys only, and every such key, except the dated UNUSED_UNTIL list", () => {
    expect(keyUseProblems(used, tier12, substitutes, new Set(Object.keys(UNUSED_UNTIL)))).toEqual(
      [],
    );
  });

  it("dates every UNUSED_UNTIL entry and names its gate", () => {
    for (const [key, entry] of Object.entries(UNUSED_UNTIL)) {
      expect(entry.since, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.gate, key).toMatch(/^T\d PR \d/);
    }
  });
});

describe("hh-hotline-main", () => {
  const main = doc("hh-hotline-main");

  it("plays the recording notice before it records, and records before the greeting", () => {
    const notice = action(main, "recording-notice");
    expect(notice.Type).toBe("MessageParticipant");
    expect(notice.Parameters.Text).toMatch(/recorded/);
    expect(notice.Transitions.NextAction).toBe("start-recording");
    const rec = action(main, "start-recording");
    expect(rec.Type).toBe("UpdateContactRecordingAndAnalyticsBehavior");
    expect(rec.Transitions.NextAction).toBe("play-greeting");
  });

  it("tags the season the greeting module set, after the module runs", () => {
    expect(action(main, "play-greeting").Transitions.NextAction).toBe("tag-season");
    expect(action(main, "tag-season").Parameters).toEqual({
      Tags: { season: "$.Attributes.season" },
    });
  });

  it("asks about injury before the interview, and offers only end or continue after the advice", () => {
    const hurt = action(main, "ask-anyone-hurt");
    const conditions = hurt.Transitions.Conditions ?? [];
    expect(conditions.map((c) => [c.Condition.Operands[0], c.NextAction])).toEqual([
      ["1", "emergency-advice"],
      ["2", "start-interview"],
    ]);
    const offer = action(main, "offer-end-or-continue");
    const targets = new Set([
      ...(offer.Transitions.Conditions ?? []).map((c) => c.NextAction),
      ...(offer.Transitions.Errors ?? []).map((e) => e.NextAction),
    ]);
    expect([...targets].sort()).toEqual(["note-injury", "say-goodbye"]);
  });

  it("asks six keypad questions with stored input off and keys 1 and 2", () => {
    const questions = main.content.Actions.filter(
      (a) =>
        a.Type === "GetParticipantInput" &&
        a.Identifier.startsWith("ask-") &&
        !["ask-anyone-hurt", "ask-district"].includes(a.Identifier),
    );
    expect(questions).toHaveLength(6);
    for (const q of questions) {
      expect(q.Parameters.StoreInput).toBe("False");
      expect((q.Transitions.Conditions ?? []).map((c) => c.Condition.Operands[0])).toEqual([
        "1",
        "2",
      ]);
    }
  });

  it("sends the grades a district crew takes to the generated district menu", () => {
    const grade = action(main, "check-grade");
    const toMenu = (grade.Transitions.Conditions ?? [])
      .filter((c) => c.NextAction === "to-district-menu")
      .map((c) => c.Condition.Operands[0]);
    expect(toMenu).toEqual(["1", "2", "3"]);
    expect(action(main, "to-district-menu").Parameters.ContactFlowId).toBe(
      "${cdref:flow:hh-district-menu}",
    );
    expect(main.content.Actions.some((a) => a.Identifier === "ask-district")).toBe(false);
  });

  it("sends the two worst grades to the Lantern Crew queue", () => {
    const grade = action(main, "check-grade");
    const lantern = (grade.Transitions.Conditions ?? [])
      .filter((c) => c.NextAction === "send-to-lantern-crew")
      .map((c) => c.Condition.Operands[0]);
    expect(lantern).toEqual(["4", "5"]);
    expect(action(main, "set-lantern-queue").Parameters.QueueId).toBe(
      "${cdref:queue:lantern-crew}",
    );
  });

  it("names the crew and sets both whispers and both holds before the Lantern Crew and dispatch transfers", () => {
    const chain = (start: string, stop: string) => {
      const ids: string[] = [];
      for (let id = start; id !== stop;) {
        ids.push(id);
        id = action(main, id).Transitions.NextAction ?? stop;
      }
      return ids.map((id) => action(main, id));
    };
    for (const [start, stop, name] of [
      ["send-to-lantern-crew", "set-lantern-queue", "Lantern"],
      ["hand-to-dispatch", "set-dispatch-queue", "Dispatch"],
    ] as const) {
      const blocks = chain(start, stop);
      expect(
        blocks.find((a) => a.Type === "UpdateContactAttributes")?.Parameters.Attributes,
      ).toMatchObject({ districtName: name });
      expect(
        blocks
          .filter((a) => a.Type === "UpdateContactEventHooks")
          .map((a) => a.Parameters.EventHooks),
      ).toEqual([
        { CustomerWhisper: "${cdref:flow:hh-customer-whisper}" },
        { AgentWhisper: "${cdref:flow:hh-agent-whisper}" },
        { CustomerHold: "${cdref:flow:hh-customer-hold}" },
        { AgentHold: "${cdref:flow:hh-agent-hold}" },
      ]);
    }
  });

  it("invokes its Lambdas with JSON response validation (VERIFY L1)", () => {
    for (const id of ["look-up-caller", "classify"]) {
      expect(action(main, id).Parameters.ResponseValidation).toEqual({ ResponseType: "JSON" });
    }
  });

  // Response validation covers the whole response, and every Tier 1 stub
  // returns at least one spoken value with spaces, so none may use STRING_MAP.
  it("invokes no Lambda anywhere in flows/ with STRING_MAP validation", () => {
    const stringMap = flows.flatMap((l) =>
      l.doc.content.Actions.filter(
        (a) =>
          a.Type === "InvokeLambdaFunction" &&
          (a.Parameters.ResponseValidation as { ResponseType?: string } | undefined)
            ?.ResponseType !== "JSON",
      ).map((a) => `${l.doc.name}#${a.Identifier}`),
    );
    expect(stringMap).toEqual([]);
  });
});

describe("hh-district-menu (generated)", () => {
  const menu = doc("hh-district-menu");

  it("offers one menu key per district, in config order, each routed to its generated flow", () => {
    const ask = action(menu, "ask-district");
    expect(menu.content.StartAction).toBe("ask-district");
    const routes = (ask.Transitions.Conditions ?? []).map((c) => {
      const route = action(menu, c.NextAction);
      const transfer = action(menu, route.Transitions.NextAction ?? "");
      return {
        key: c.Condition.Operands[0],
        attributes: route.Parameters.Attributes,
        flow: transfer.Parameters.ContactFlowId,
      };
    });
    expect(routes).toEqual(
      districts.map((d, i) => ({
        key: String(i + 1),
        attributes: { district: d.slug, districtName: d.name },
        flow: `\${cdref:flow:hh-district-${d.slug}}`,
      })),
    );
    for (const d of districts) expect(ask.Parameters.Text).toContain(d.name);
  });

  it("hands a caller who presses nothing, or a wrong key, to dispatch", () => {
    const ask = action(menu, "ask-district");
    expect(new Set((ask.Transitions.Errors ?? []).map((e) => e.NextAction))).toEqual(
      new Set(["hand-to-dispatch"]),
    );
  });
});

describe("generated district flows", () => {
  for (const d of districts) {
    const flow = doc(`hh-district-${d.slug}`);
    const over = districts.find((x) => x.slug === d.overflowTo);

    it(`${d.slug}: sets the target queue first, then the five hooks, one per block`, () => {
      const [first, ...rest] = flow.content.Actions;
      expect(flow.content.StartAction).toBe(first?.Identifier);
      expect(first?.Type).toBe("UpdateContactTargetQueue");
      expect(first?.Parameters.QueueId).toBe(`\${cdref:queue:${d.slug}-crew}`);
      const hooks = rest.slice(0, 5).map((a) => a.Parameters.EventHooks);
      expect(hooks).toEqual([
        { CustomerWhisper: "${cdref:flow:hh-customer-whisper}" },
        { AgentWhisper: "${cdref:flow:hh-agent-whisper}" },
        { CustomerHold: "${cdref:flow:hh-customer-hold}" },
        { AgentHold: "${cdref:flow:hh-agent-hold}" },
        { CustomerQueue: `\${cdref:flow:hh-queue-experience-${d.slug}}` },
      ]);
    });

    it(`${d.slug}: reads metrics with an explicit queue and rejoins the transfer on error`, () => {
      for (const id of ["check-staffing", "read-queue"]) {
        const a = action(flow, id);
        expect(a.Parameters.QueueId).toBe(`\${cdref:queue:${d.slug}-crew}`);
        expect(
          (a.Transitions.Errors ?? []).find((e) => e.ErrorType === "NoMatchingError")?.NextAction,
        ).toBe("transfer-to-crew");
      }
    });

    it(`${d.slug}: overflows to ${d.overflowTo} when full, and apologizes then hangs up on error`, () => {
      const t = action(flow, "transfer-to-crew");
      const err = (type: string) =>
        (t.Transitions.Errors ?? []).find((e) => e.ErrorType === type)?.NextAction;
      expect(err("QueueAtCapacity")).toBe("crew-full");
      expect(err("NoMatchingError")).toBe("apologize");
      expect(action(flow, "set-overflow-queue").Parameters.QueueId).toBe(
        `\${cdref:queue:${d.overflowTo}-crew}`,
      );
      expect(action(flow, "apologize").Transitions.NextAction).toBe("hang-up");
      expect(action(flow, "note-overflow-crew").Parameters).toEqual({
        FlowAttributes: { overflowCrew: { Value: over?.name } },
      });
    });

    it(`${d.slug}: changes district and queue flow before it overflows`, () => {
      expect(action(flow, "crew-full").Transitions.NextAction).toBe("note-overflow-district");
      expect(action(flow, "note-overflow-district").Parameters.Attributes).toEqual({
        district: over?.slug,
        districtName: over?.name,
      });
      expect(action(flow, "note-overflow-district").Transitions.NextAction).toBe(
        "set-overflow-queue-experience",
      );
      const hook = action(flow, "set-overflow-queue-experience");
      expect(hook.Parameters.EventHooks).toEqual({
        CustomerQueue: `\${cdref:flow:hh-queue-experience-${d.overflowTo}}`,
      });
      expect(hook.Transitions.NextAction).toBe("set-overflow-queue");
    });

    it(`${d.slug}: closes after hours with a message and a disconnect`, () => {
      expect(action(flow, "check-hours").Parameters.HoursOfOperationId).toBe(
        `\${cdref:hours:${d.slug}}`,
      );
      expect(action(flow, "after-hours").Transitions.NextAction).toBe("hang-up");
      // An hours-check error rejoins the staffing check: a caller is never
      // turned away because the hours could not be read.
      const hours = action(flow, "check-hours");
      expect(
        (hours.Transitions.Errors ?? []).find((e) => e.ErrorType === "NoMatchingError")?.NextAction,
      ).toBe("check-staffing");
      expect(action(flow, "hang-up").Type).toBe("DisconnectParticipant");
    });

    const queue = doc(`hh-queue-experience-${d.slug}`);

    it(`hh-queue-experience-${d.slug}: no Wait, no module, no target-queue update`, () => {
      expect(queue.connectType).toBe("CUSTOMER_QUEUE");
      const t = types(queue);
      for (const banned of [
        "Wait",
        "InvokeFlowModule",
        "UpdateContactTargetQueue",
        "TransferContactToQueue",
      ]) {
        expect(t.has(banned)).toBe(false);
      }
    });

    it(`hh-queue-experience-${d.slug}: plays a loop prompt before dequeuing to its sibling, both errors wired`, () => {
      expect(action(queue, "offer-move").Transitions.Conditions?.[0]?.NextAction).toBe("note-move");
      expect(action(queue, "note-move").Parameters.Attributes).toEqual({
        district: over?.slug,
        districtName: over?.name,
        moved: "true",
      });
      expect(action(queue, "note-move").Transitions.NextAction).toBe("moving");
      const moving = action(queue, "moving");
      expect(moving.Type).toBe("MessageParticipantIteratively");
      expect(moving.Transitions.Conditions?.[0]?.NextAction).toBe("move-to-sibling");
      const dq = action(queue, "move-to-sibling");
      expect(dq.Parameters.QueueId).toBe(`\${cdref:queue:${d.overflowTo}-crew}`);
      expect((dq.Transitions.Errors ?? []).map((e) => e.ErrorType).sort()).toEqual([
        "NoMatchingError",
        "QueueAtCapacity",
      ]);
      expect(action(queue, "check-sibling").Parameters.QueueId).toBe(
        `\${cdref:queue:${d.overflowTo}-crew}`,
      );
    });

    it(`hh-queue-experience-${d.slug}: skips the offer once moved, and restores the district when a move fails`, () => {
      expect(queue.content.StartAction).toBe("check-moved");
      const moved = action(queue, "check-moved");
      expect(moved.Parameters.ComparisonValue).toBe("$.Attributes.moved");
      expect(moved.Transitions.Conditions?.[0]?.NextAction).toBe("settle-in");
      expect(moved.Transitions.Conditions?.[0]?.Condition.Operands).toEqual(["true"]);
      const dq = action(queue, "move-to-sibling");
      for (const e of dq.Transitions.Errors ?? []) {
        expect(["stay-here", "sibling-full"]).toContain(e.NextAction);
      }
      expect(action(queue, "sibling-full").Transitions.NextAction).toBe("stay-here");
      expect(action(queue, "stay-here").Parameters.Attributes).toEqual({
        district: d.slug,
        districtName: d.name,
        moved: "false",
      });
    });

    it(`hh-queue-experience-${d.slug}: holds with an interruptible loop that returns to the poll`, () => {
      const hold = action(queue, "hold");
      expect(hold.Parameters.InterruptFrequencySeconds).toBe("30");
      expect(hold.Transitions.Conditions).toEqual([
        {
          NextAction: "poll-crews",
          Condition: { Operator: "Equals", Operands: ["MessagesInterrupted"] },
        },
      ]);
      expect(action(queue, "poll-crews").Parameters.LoopCount).toBe("3");
    });
  }
});

// A hold flow is one MessageParticipantIteratively and nothing else:
// MessageParticipant and every terminal type are illegal in hold flows
// (FLOW_TYPE_RESTRICTIONS; actions.md rule 38), and a holding action with no
// next ends the flow (terminal-blocks). No interrupt either: there is nothing
// to interrupt to.
function holdFlowProblems(d: FlowDoc): string[] {
  const out: string[] = [];
  if (d.connectType !== "CUSTOMER_HOLD" && d.connectType !== "AGENT_HOLD") {
    out.push(`${d.name}: ${d.connectType} is not a hold flow type`);
  }
  const [only, ...rest] = d.content.Actions;
  if (only === undefined || rest.length > 0) {
    out.push(`${d.name}: ${String(d.content.Actions.length)} actions, expected exactly one`);
  }
  if (only === undefined) return out;
  if (d.content.StartAction !== only.Identifier)
    out.push(`${d.name}: does not start at ${only.Identifier}`);
  if (only.Type !== "MessageParticipantIteratively") {
    out.push(`${d.name}#${only.Identifier}: ${only.Type}, expected MessageParticipantIteratively`);
  }
  if (only.Transitions.NextAction !== undefined)
    out.push(`${d.name}#${only.Identifier}: has a NextAction`);
  if (
    (only.Transitions.Conditions ?? []).length > 0 ||
    (only.Transitions.Errors ?? []).length > 0
  ) {
    out.push(`${d.name}#${only.Identifier}: has a condition or error branch`);
  }
  if (only.Parameters.InterruptFrequencySeconds !== undefined) {
    out.push(`${d.name}#${only.Identifier}: has an interrupt`);
  }
  return out;
}

describe("hold flows", () => {
  const holds = flows.map((l) => l.doc).filter((d) => /_HOLD$/.test(d.connectType));

  it("has the customer and agent hold flows", () => {
    expect(holds.map((d) => d.name).sort()).toEqual(["hh-agent-hold", "hh-customer-hold"]);
  });

  it("catches a second action, a next and an interrupt, so the shape check means something", () => {
    const base = holds[0];
    if (base === undefined) throw new Error("no hold flow");
    const extra = structuredClone(base);
    extra.content.Actions.push({
      Identifier: "done",
      Type: "EndFlowExecution",
      Parameters: {},
      Transitions: {},
    });
    expect(holdFlowProblems(extra)).toEqual([`${base.name}: 2 actions, expected exactly one`]);
    const next = structuredClone(base);
    const first = next.content.Actions[0];
    if (first) {
      first.Transitions.NextAction = "on-hold";
      first.Parameters.InterruptFrequencySeconds = "30";
    }
    expect(holdFlowProblems(next)).toEqual([
      `${base.name}#on-hold: has a NextAction`,
      `${base.name}#on-hold: has an interrupt`,
    ]);
  });

  it.each(holds.map((d) => d.name))(
    "%s is one MessageParticipantIteratively and nothing else",
    (name) => {
      expect(holdFlowProblems(doc(name))).toEqual([]);
    },
  );

  it("hh-customer-hold names the crew the caller is with; hh-agent-hold names the grade", () => {
    expect(spokenTexts(action(doc("hh-customer-hold"), "on-hold")).join(" ")).toContain(
      "$.Attributes.districtName",
    );
    expect(spokenTexts(action(doc("hh-agent-hold"), "on-hold")).join(" ")).toContain(
      "$.Attributes.gradeName",
    );
  });
});

/** Every run of consecutive UpdateContactEventHooks blocks, as the hook names each sets, in order. */
function hookChains(d: FlowDoc): { start: string; hooks: string[] }[] {
  const byId = new Map(d.content.Actions.map((a) => [a.Identifier, a]));
  const isHook = (a: FlowAction | undefined): a is FlowAction =>
    a?.Type === "UpdateContactEventHooks";
  const pointedTo = new Set(d.content.Actions.filter(isHook).map((a) => a.Transitions.NextAction));
  return d.content.Actions.filter((a) => isHook(a) && !pointedTo.has(a.Identifier)).map((a) => {
    const hooks: string[] = [];
    for (
      let cur: FlowAction | undefined = a;
      isHook(cur);
      cur = byId.get(cur.Transitions.NextAction ?? "")
    ) {
      hooks.push(...Object.keys(cur.Parameters.EventHooks as Record<string, string>));
    }
    return { start: a.Identifier, hooks };
  });
}

// Wherever a CustomerWhisper hook is set, CustomerHold and AgentHold are set
// in the same chain of hook blocks, so no path that can reach an agent gets
// Connect's default hold (decided 2026-10-05).
function hookChainProblems(d: FlowDoc): string[] {
  return hookChains(d)
    .filter((c) => c.hooks.includes("CustomerWhisper"))
    .flatMap((c) =>
      ["AgentWhisper", "CustomerHold", "AgentHold"]
        .filter((h) => !c.hooks.includes(h))
        .map((h) => `${d.name}#${c.start}: sets CustomerWhisper without ${h}`),
    );
}

describe("the whisper and hold hooks travel together", () => {
  it("catches a chain missing a hold hook, so the check means something", () => {
    const d = structuredClone(doc(`hh-district-${districts[0]?.slug ?? ""}`));
    action(d, "set-agent-whisper").Transitions.NextAction = "set-agent-hold";
    expect(hookChainProblems(d)).toEqual([
      `${d.name}#set-customer-whisper: sets CustomerWhisper without CustomerHold`,
    ]);
    expect(hookChains(d).map((c) => c.hooks)).toContainEqual([
      "CustomerWhisper",
      "AgentWhisper",
      "AgentHold",
      "CustomerQueue",
    ]);
  });

  it.each(flows.map((l) => l.doc.name))("%s", (name) => {
    expect(hookChainProblems(doc(name))).toEqual([]);
  });

  it("sets each hook in a block of its own (VERIFY 16.3)", () => {
    for (const l of flows) {
      for (const a of l.doc.content.Actions.filter((x) => x.Type === "UpdateContactEventHooks")) {
        expect(
          Object.keys(a.Parameters.EventHooks as object),
          `${l.doc.name}#${a.Identifier}`,
        ).toHaveLength(1);
      }
    }
  });
});

describe("no Wait", () => {
  const waits = (d: FlowDoc) => d.content.Actions.filter((a) => a.Type === "Wait");

  it("would see one, so the check means something", () => {
    const d = structuredClone(doc("hh-hotline-main"));
    d.content.Actions.push({
      Identifier: "pause",
      Type: "Wait",
      Parameters: { TimeLimitSeconds: "5" },
      Transitions: {},
    });
    expect(waits(d)).toHaveLength(1);
  });

  it("appears in no flow: Wait is chat only (VERIFY 16.1), and every flow here is voice", () => {
    for (const d of byName.values()) expect(waits(d), d.name).toEqual([]);
  });
});

describe("whispers and greetings", () => {
  const attributeOnly = (d: FlowDoc) =>
    d.content.Actions.flatMap(spokenTexts).flatMap((t) =>
      [...t.matchAll(/\$\.[A-Za-z]+(?:\.[A-Za-z]+)?/g)].map((m) => m[0]),
    );

  it("customer whisper reads the district name and nothing else", () => {
    expect(attributeOnly(doc("hh-customer-whisper"))).toEqual(["$.Attributes.districtName"]);
  });

  it("agent whisper reads the district, grade name and advice, and nothing else", () => {
    expect(attributeOnly(doc("hh-agent-whisper")).sort()).toEqual([
      "$.Attributes.advice",
      "$.Attributes.districtName",
      "$.Attributes.gradeName",
    ]);
  });

  it.each(["hh-greeting-standard", "hh-greeting-halloween"])(
    "%s greets, sets the season contact attribute and ends the module",
    (name) => {
      const g = doc(name);
      expect(g.connectType).toBe("MODULE");
      expect(g.content.Actions.map((a) => a.Type)).toEqual([
        "MessageParticipant",
        "UpdateContactAttributes",
        "EndFlowModuleExecution",
      ]);
      expect(Object.keys(action(g, "set-season").Parameters.Attributes as object)).toEqual([
        "season",
      ]);
    },
  );
});

// Every queue a contact is put in, and every queue flow hooked for it, must
// agree with the districtName the whispers and queue copy read at that point.
// Walks every path of every flow in flows/ with the name the flow starts with
// (the one its caller set), applying each UpdateContactAttributes on all of
// its outgoing edges, and fails on the first target queue, dequeue or
// CustomerQueue hook reached with a name that belongs to another crew.
describe("the district name follows the contact", () => {
  const crewName = new Map<string, string>([
    ...districts.map((d) => [`\${cdref:queue:${d.slug}-crew}`, d.name] as const),
    ["${cdref:queue:lantern-crew}", "Lantern"],
    ["${cdref:queue:dispatch-overflow}", "Dispatch"],
  ]);
  const queueFlowName = new Map<string, string>(
    districts.map((d) => [`\${cdref:flow:hh-queue-experience-${d.slug}}`, d.name]),
  );
  const startName = (name: string): string | undefined => {
    const m = /^hh-(?:district|queue-experience)-(.+)$/.exec(name);
    return districts.find((d) => d.slug === m?.[1])?.name;
  };

  function mismatches(d: FlowDoc): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const walk = (id: string, name: string | undefined) => {
      const key = `${id}|${String(name)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const a = d.content.Actions.find((x) => x.Identifier === id);
      if (a === undefined) return;
      const p = a.Parameters as Record<string, unknown>;
      if (a.Type === "UpdateContactTargetQueue" || a.Type === "DequeueContactAndTransferToQueue") {
        const want = crewName.get(String(p.QueueId));
        if (want !== name)
          out.push(`${d.name}#${id}: ${String(p.QueueId)} with districtName ${String(name)}`);
      }
      const hook = (p.EventHooks as Record<string, string> | undefined)?.CustomerQueue;
      if (hook !== undefined && queueFlowName.get(hook) !== name) {
        out.push(`${d.name}#${id}: ${hook} with districtName ${String(name)}`);
      }
      let next = name;
      const attrs = p.Attributes as Record<string, string> | undefined;
      if (a.Type === "UpdateContactAttributes" && attrs?.districtName !== undefined) {
        next = attrs.districtName;
      }
      const t = a.Transitions;
      for (const target of [
        t.NextAction,
        ...(t.Conditions ?? []).map((c) => c.NextAction),
        ...(t.Errors ?? []).map((e) => e.NextAction),
      ]) {
        if (target !== undefined) walk(target, next);
      }
    };
    walk(d.content.StartAction, startName(d.name));
    return out;
  }

  it("catches a mismatch, so the walk means something", () => {
    const q = doc(`hh-queue-experience-${districts[0]?.slug ?? ""}`);
    const broken = structuredClone(q);
    const offer = broken.content.Actions.find((a) => a.Identifier === "offer-move");
    const firstCondition = offer?.Transitions.Conditions?.[0];
    if (firstCondition) firstCondition.NextAction = "moving";
    expect(mismatches(broken).length).toBeGreaterThan(0);
  });

  it.each(flows.map((l) => l.doc.name))("%s", (name) => {
    expect(mismatches(doc(name))).toEqual([]);
  });
});
