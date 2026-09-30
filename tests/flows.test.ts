/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// The Tier 1 flow set: lint clean as flow-cli runs it, the shape the
// synthesis settled for each flow, and references that agree with the
// manifest and the districts.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { collectRefs, lint, refKey, type FlowAction, type FlowDoc } from "@flow-as-code/core";
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
  it("has the Tier 1 documents to lint", () => {
    const names = [...byName.keys()];
    for (const n of [
      "hh-hotline-main",
      "hh-customer-whisper",
      "hh-agent-whisper",
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

  it("uses exactly the manifest's Tier 1 keys", () => {
    const tier1 = expandAll(loadManifest(), districts)
      .filter((e) => e.tier === 1)
      .map((e) => e.key)
      .sort();
    const used = [...new Set(flowRefs.map(({ r }) => refKey(r)))].sort();
    expect(used).toEqual(tier1);
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

  it("names the crew and sets both whispers before the Lantern Crew and dispatch transfers", () => {
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

    it(`${d.slug}: sets the target queue first, then the three hooks`, () => {
      const [first, ...rest] = flow.content.Actions;
      expect(flow.content.StartAction).toBe(first?.Identifier);
      expect(first?.Type).toBe("UpdateContactTargetQueue");
      expect(first?.Parameters.QueueId).toBe(`\${cdref:queue:${d.slug}-crew}`);
      const hooks = rest.slice(0, 3).map((a) => a.Parameters.EventHooks);
      expect(hooks).toEqual([
        { CustomerWhisper: "${cdref:flow:hh-customer-whisper}" },
        { AgentWhisper: "${cdref:flow:hh-agent-whisper}" },
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
