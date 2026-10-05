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
      "hh-dead-line",
      "hh-dead-whisper",
      "hh-dead-hold",
      "hh-dead-queue-experience",
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
    "hours:closed": {
      gate: "T2 PR 6, S4 substitutes it for a district's hours",
      since: "2026-10-05",
    },
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
      ["2", "plane-check"],
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

  // The agent whisper and hold speak $.Attributes.gradeName, and the dispatch
  // fallback is the one chain an ungraded caller can reach (the classifier
  // failed, or the grade could not be recorded), so those two paths name a
  // grade on the way. A full Lantern Crew keeps the grade it has.
  it("names the grade Ungraded on the way to dispatch when the classifier failed, and only then", () => {
    for (const id of ["classify", "record-grade"]) {
      expect((action(main, id).Transitions.Errors ?? []).map((e) => e.NextAction)).toEqual([
        "note-ungraded",
      ]);
    }
    const note = action(main, "note-ungraded");
    expect(note.Type).toBe("UpdateContactAttributes");
    expect(note.Parameters.Attributes).toEqual({ gradeName: "Ungraded" });
    expect(note.Transitions.NextAction).toBe("hand-to-dispatch");
    expect(action(main, "transfer-to-lantern").Transitions.Errors).toContainEqual({
      ErrorType: "QueueAtCapacity",
      NextAction: "hand-to-dispatch",
    });
  });

  it("invokes its Lambdas with JSON response validation (VERIFY L1)", () => {
    for (const id of ["look-up-caller", "plane-check", "prank-score", "classify"]) {
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

/** Whether `target` is reachable from `from` on a path that never passes `avoid`. */
function reachesWithout(d: FlowDoc, from: string, target: string, avoid: string): boolean {
  const byId = new Map(d.content.Actions.map((a) => [a.Identifier, a]));
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const id = queue.shift() ?? "";
    if (id === target) return true;
    if (seen.has(id) || id === avoid) continue;
    seen.add(id);
    const t = byId.get(id)?.Transitions;
    if (t === undefined) continue;
    queue.push(
      ...[
        t.NextAction,
        ...(t.Conditions ?? []).map((c) => c.NextAction),
        ...(t.Errors ?? []).map((e) => e.NextAction),
      ].filter((x): x is string => x !== undefined),
    );
  }
  return false;
}

describe("the plane check in hh-hotline-main", () => {
  const main = doc("hh-hotline-main");

  it("runs after the safety question says nobody is hurt, and sends beyond to the dead line", () => {
    const hurt = action(main, "ask-anyone-hurt");
    expect(
      hurt.Transitions.Conditions?.find((c) => c.Condition.Operands[0] === "2")?.NextAction,
    ).toBe("plane-check");
    const check = action(main, "plane-check");
    expect(check.Parameters.LambdaFunctionARN).toBe("${cdref:lambda:plane-check}");
    expect(check.Transitions.NextAction).toBe("check-plane");
    const compare = action(main, "check-plane");
    expect(compare.Parameters.ComparisonValue).toBe("$.External.plane");
    expect(compare.Transitions.Conditions).toEqual([
      { NextAction: "to-dead-line", Condition: { Operator: "Equals", Operands: ["beyond"] } },
    ]);
    expect(compare.Transitions.NextAction).toBe("start-interview");
    expect(action(main, "to-dead-line").Parameters.ContactFlowId).toBe(
      "${cdref:flow:hh-dead-line}",
    );
  });

  it("would notice a path to the dead line that skips the safety question", () => {
    const skipped = structuredClone(main);
    action(skipped, "welcome-back").Transitions.NextAction = "plane-check";
    expect(
      reachesWithout(skipped, skipped.content.StartAction, "to-dead-line", "ask-anyone-hurt"),
    ).toBe(true);
  });

  it("never skips the safety question: no path reaches the dead line without it", () => {
    expect(reachesWithout(main, main.content.StartAction, "to-dead-line", "ask-anyone-hurt")).toBe(
      false,
    );
    // And the dead line is reachable at all.
    expect(reachesWithout(main, main.content.StartAction, "to-dead-line", "")).toBe(true);
  });
});

/**
 * Whether `target` is reachable from `from` when the flow attributes are
 * tracked: UpdateFlowAttributes sets them, and a Compare on
 * `$.FlowAttributes.<name>` whose value is known follows only the branch that
 * matches (else its no-match path). Anything else follows every transition.
 */
function reachesTracking(
  d: FlowDoc,
  from: string,
  target: string,
  attrs: Record<string, string> = {},
): boolean {
  const byId = new Map(d.content.Actions.map((a) => [a.Identifier, a]));
  const seen = new Set<string>();
  const queue: [string, Record<string, string>][] = [[from, attrs]];
  while (queue.length > 0) {
    const [id, state] = queue.shift() ?? ["", {}];
    if (id === target) return true;
    const key = `${id}|${JSON.stringify(state)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = byId.get(id);
    if (a === undefined) continue;
    const t = a.Transitions;
    let next = state;
    if (a.Type === "UpdateFlowAttributes") {
      const set = a.Parameters.FlowAttributes as Record<string, { Value: string }>;
      next = { ...state, ...Object.fromEntries(Object.entries(set).map(([k, v]) => [k, v.Value])) };
    }
    const compared = /^\$\.FlowAttributes\.([A-Za-z]+)$/.exec(
      String(a.Parameters.ComparisonValue),
    )?.[1];
    if (a.Type === "Compare" && compared !== undefined && compared in state) {
      const hit = (t.Conditions ?? []).find(
        (c) => c.Condition.Operator === "Equals" && c.Condition.Operands[0] === state[compared],
      );
      queue.push([hit?.NextAction ?? t.NextAction ?? "", next]);
      continue;
    }
    for (const to of [
      t.NextAction,
      ...(t.Conditions ?? []).map((c) => c.NextAction),
      ...(t.Errors ?? []).map((e) => e.NextAction),
    ]) {
      if (to !== undefined) queue.push([to, next]);
    }
  }
  return false;
}

/**
 * From a TagContact that sets `tagKey`, every path must reach an UntagContact
 * of that key or a DisconnectParticipant before it leaves the flow (a
 * transfer, a module, an end), so the tag never travels on a wrong guess.
 *
 * The walk stops at the UntagContact. Its own error branch is the one
 * accepted way the tag can survive: a failed untag continues to classify
 * and the transfers with the tag still set, because the alternative is to
 * hang up on a caller who has just said it is really happening. With
 * `throughFailedUntag` the walk follows that branch too and names each leave
 * as reached after the failed untag, which is how the exception is held
 * explicitly rather than hidden.
 */
function tagPathProblems(
  d: FlowDoc,
  tagKey: string,
  options: { throughFailedUntag?: boolean } = {},
): string[] {
  const byId = new Map(d.content.Actions.map((a) => [a.Identifier, a]));
  const leaves = new Set([
    "TransferToFlow",
    "TransferContactToQueue",
    "InvokeFlowModule",
    "EndFlowExecution",
    "DequeueContactAndTransferToQueue",
  ]);
  const out: string[] = [];
  const tags = d.content.Actions.filter(
    (a) => a.Type === "TagContact" && tagKey in (a.Parameters.Tags as Record<string, string>),
  );
  for (const tag of tags) {
    const seen = new Set<string>();
    // Each entry is a block id and, once past a failed untag, that untag's id.
    const queue: [string | undefined, string | undefined][] = [
      [tag.Transitions.NextAction, undefined],
      ...(tag.Transitions.Errors ?? []).map((e): [string, undefined] => [e.NextAction, undefined]),
    ];
    while (queue.length > 0) {
      const [id, via] = queue.shift() ?? [];
      if (id === undefined || seen.has(`${via ?? ""}>${id}`)) continue;
      seen.add(`${via ?? ""}>${id}`);
      const a = byId.get(id);
      if (a === undefined) continue;
      if (a.Type === "UntagContact" && (a.Parameters.TagKeys as string[]).includes(tagKey)) {
        if (options.throughFailedUntag === true) {
          for (const e of a.Transitions.Errors ?? []) queue.push([e.NextAction, a.Identifier]);
        }
        continue;
      }
      if (a.Type === "DisconnectParticipant") continue;
      if (leaves.has(a.Type)) {
        const after = via === undefined ? "" : ` after a failed ${via}`;
        out.push(
          `${d.name}#${tag.Identifier}: ${tagKey} reaches ${a.Identifier} (${a.Type}) still set${after}`,
        );
        continue;
      }
      const t = a.Transitions;
      for (const to of [
        t.NextAction,
        ...(t.Conditions ?? []).map((c) => c.NextAction),
        ...(t.Errors ?? []).map((e) => e.NextAction),
      ]) {
        queue.push([to, via]);
      }
    }
  }
  return out;
}

describe("the prank screen in hh-hotline-main", () => {
  const main = doc("hh-hotline-main");

  it("runs after the last question, scores with the answers and the number, and tags a high verdict", () => {
    const last = action(main, "ask-multiple");
    expect(
      last.Transitions.Conditions?.find((c) => c.Condition.Operands[0] === "2")?.NextAction,
    ).toBe("check-injured-first");
    expect(action(main, "note-multiple").Transitions.NextAction).toBe("check-injured-first");
    const injured = action(main, "check-injured-first");
    expect(injured.Parameters.ComparisonValue).toBe("$.FlowAttributes.injured");
    expect(injured.Transitions.Conditions).toEqual([
      { NextAction: "classify", Condition: { Operator: "Equals", Operands: ["yes"] } },
    ]);
    expect(injured.Transitions.NextAction).toBe("prank-score");
    const score = action(main, "prank-score");
    expect(score.Parameters.LambdaFunctionARN).toBe("${cdref:lambda:prank-score}");
    expect(Object.keys(score.Parameters.LambdaInvocationAttributes as object).sort()).toEqual([
      "callerNumber",
      "canSee",
      "coldSpot",
      "movesObjects",
      "multiple",
      "sounds",
      "touchedYou",
    ]);
    const verdict = action(main, "check-verdict");
    expect(verdict.Transitions.Conditions).toEqual([
      { NextAction: "tag-screen", Condition: { Operator: "Equals", Operands: ["high"] } },
    ]);
    expect(verdict.Transitions.NextAction).toBe("classify");
    expect(action(main, "tag-screen").Parameters.Tags).toEqual({ screen: "prank-suspected" });
    expect(action(main, "tag-screen").Transitions.NextAction).toBe("kind-check");
  });

  it("clears the tag on 1 and classifies; says goodnight kindly on 2, a timeout or an error", () => {
    const ask = action(main, "kind-check");
    expect(
      (ask.Transitions.Conditions ?? []).map((c) => [c.Condition.Operands[0], c.NextAction]),
    ).toEqual([
      ["1", "untag-screen"],
      ["2", "dare-goodbye"],
    ]);
    expect(ask.Transitions.NextAction).toBe("dare-goodbye");
    for (const e of ask.Transitions.Errors ?? []) expect(e.NextAction).toBe("dare-goodbye");
    const untag = action(main, "untag-screen");
    expect(untag.Type).toBe("UntagContact");
    expect(untag.Parameters.TagKeys).toEqual(["screen"]);
    expect(untag.Transitions.NextAction).toBe("classify");
    expect(action(main, "dare-goodbye").Transitions.NextAction).toBe("hang-up");
    expect(action(main, "hang-up").Type).toBe("DisconnectParticipant");
  });

  it("would notice an injured caller reaching the screen, so the walk means something", () => {
    const broken = structuredClone(main);
    const injured = action(broken, "check-injured-first");
    if (injured.Transitions.Conditions?.[0])
      injured.Transitions.Conditions[0].NextAction = "prank-score";
    expect(reachesTracking(broken, "emergency-advice", "prank-score")).toBe(true);
    // Untracked, the walk would reach it through the no-match branch and prove nothing.
    expect(reachesWithout(main, "emergency-advice", "prank-score", "")).toBe(true);
  });

  it("never screens a caller who said someone is hurt: no path from the yes reaches prank-score", () => {
    expect(reachesTracking(main, "emergency-advice", "prank-score")).toBe(false);
    expect(reachesTracking(main, "start-interview", "prank-score")).toBe(true);
  });

  it("would notice the tag leaving the flow, so the tag walk means something", () => {
    const broken = structuredClone(main);
    const ask = action(broken, "kind-check");
    if (ask.Transitions.Conditions?.[0]) ask.Transitions.Conditions[0].NextAction = "classify";
    expect(tagPathProblems(broken, "screen").sort()).toEqual([
      "hh-hotline-main#tag-screen: screen reaches to-district-menu (TransferToFlow) still set",
      "hh-hotline-main#tag-screen: screen reaches transfer-to-dispatch (TransferContactToQueue) still set",
      "hh-hotline-main#tag-screen: screen reaches transfer-to-lantern (TransferContactToQueue) still set",
    ]);
  });

  it.each(flows.map((l) => l.doc.name))(
    "%s: every path through a screen tag untags it or ends the call, a failed untag excepted",
    (name) => {
      expect(tagPathProblems(doc(name), "screen")).toEqual([]);
    },
  );

  // The accepted exception, held explicitly: if untag-screen itself fails,
  // the caller who pressed 1 goes on to classify and the transfers with the
  // tag still set, rather than being hung up on. Nothing else leaks it.
  it("a failed untag-screen is the only way the tag leaves the flow, and it leaves set", () => {
    expect(
      (action(main, "untag-screen").Transitions.Errors ?? []).map((e) => e.NextAction),
    ).toEqual(["classify"]);
    expect(tagPathProblems(main, "screen", { throughFailedUntag: true }).sort()).toEqual([
      "hh-hotline-main#tag-screen: screen reaches to-district-menu (TransferToFlow) still set after a failed untag-screen",
      "hh-hotline-main#tag-screen: screen reaches transfer-to-dispatch (TransferContactToQueue) still set after a failed untag-screen",
      "hh-hotline-main#tag-screen: screen reaches transfer-to-lantern (TransferContactToQueue) still set after a failed untag-screen",
    ]);
    for (const name of flows.map((l) => l.doc.name).filter((n) => n !== "hh-hotline-main")) {
      expect(tagPathProblems(doc(name), "screen", { throughFailedUntag: true })).toEqual([]);
    }
  });
});

/** The dead line's shape, as a list of what is wrong with it (VERIFY 16.4, 16.5, 16.3). */
function deadLineProblems(d: FlowDoc): string[] {
  const out: string[] = [];
  const find = (id: string) => d.content.Actions.find((a) => a.Identifier === id);
  const welcome = find("dead-welcome");
  const rec = find("record-agent-only");
  if (d.content.StartAction !== "dead-welcome") out.push("does not start with the welcome");
  if (welcome?.Type !== "MessageParticipant" || !/recorded/.test(String(welcome.Parameters.Text))) {
    out.push("the welcome does not say the call is recorded");
  }
  if (welcome?.Transitions.NextAction !== "record-agent-only") {
    out.push("the welcome does not lead to the recording block");
  }
  if (rec?.Type !== "UpdateContactRecordingBehavior") out.push("no UpdateContactRecordingBehavior");
  const recorded = (
    rec?.Parameters.RecordingBehavior as { RecordedParticipants?: string[] } | undefined
  )?.RecordedParticipants;
  if (JSON.stringify(recorded) !== JSON.stringify(["Agent"])) {
    out.push("the recording block does not record exactly the Agent");
  }
  if ((rec?.Transitions.Errors ?? []).length > 0)
    out.push("the recording block has an error branch");
  if (reachesWithout(d, d.content.StartAction, "record-agent-only", "dead-welcome")) {
    out.push("recording is reachable without the welcome");
  }
  const patience = find("set-patience");
  const adjust = String(patience?.Parameters.QueueTimeAdjustmentSeconds);
  if (patience?.Type !== "UpdateContactRoutingBehavior")
    out.push("no UpdateContactRoutingBehavior");
  if (!/^-\d+$/.test(adjust))
    out.push(`the routing adjustment is ${adjust}, not a static negative`);
  if (patience?.Parameters.QueuePriority !== undefined)
    out.push("the routing adjustment also sets a priority");
  if (reachesWithout(d, d.content.StartAction, "transfer-to-dead", "set-patience")) {
    out.push("the transfer is reachable without the routing adjustment");
  }
  if (reachesWithout(d, d.content.StartAction, "set-dead-queue", "set-patience")) {
    out.push("the target queue is set before the routing adjustment");
  }
  // Only hook blocks on a path from the start count: one that exists but is
  // wired past sets nothing for the Queue of the Dead.
  const hooks = d.content.Actions.filter(
    (a) =>
      a.Type === "UpdateContactEventHooks" &&
      reachesWithout(d, d.content.StartAction, a.Identifier, ""),
  );
  const set = Object.assign({}, ...hooks.map((a) => a.Parameters.EventHooks)) as Record<
    string,
    string
  >;
  for (const a of hooks) {
    if (Object.keys(a.Parameters.EventHooks as object).length !== 1)
      out.push(`${a.Identifier} sets more than one hook`);
  }
  const expected: Record<string, string> = {
    AgentWhisper: "${cdref:flow:hh-dead-whisper}",
    CustomerHold: "${cdref:flow:hh-dead-hold}",
    CustomerQueue: "${cdref:flow:hh-dead-queue-experience}",
    AgentHold: "${cdref:flow:hh-agent-hold}",
  };
  for (const [hook, flow] of Object.entries(expected)) {
    if (set[hook] !== flow) out.push(`${hook} is ${String(set[hook])}, expected ${flow}`);
  }
  if (!reachesWithout(d, d.content.StartAction, "transfer-to-dead", ""))
    out.push("the transfer is unreachable");
  return out;
}

describe("hh-dead-line", () => {
  const dead = doc("hh-dead-line");

  it("has the shape the design settled: welcome, agent-only recording, hooks, patience, transfer", () => {
    expect(deadLineProblems(dead)).toEqual([]);
    expect(action(dead, "set-dead-queue").Parameters.QueueId).toBe("${cdref:queue:the-dead}");
    const transfer = action(dead, "transfer-to-dead");
    expect((transfer.Transitions.Errors ?? []).map((e) => e.ErrorType).sort()).toEqual([
      "NoMatchingError",
      "QueueAtCapacity",
    ]);
    expect(action(dead, "check-dead-hours").Parameters.HoursOfOperationId).toBe(
      "${cdref:hours:the-dead}",
    );
  });

  it("the dead never close: both hours branches continue to the queue", () => {
    const hours = action(dead, "check-dead-hours");
    expect(new Set((hours.Transitions.Conditions ?? []).map((c) => c.NextAction))).toEqual(
      new Set(["set-dead-queue"]),
    );
  });

  it("catches the welcome after the recording, a customer in the recording, and an error branch", () => {
    const swapped = structuredClone(dead);
    swapped.content.StartAction = "record-agent-only";
    action(swapped, "record-agent-only").Transitions.NextAction = "dead-welcome";
    action(swapped, "dead-welcome").Transitions.NextAction = "set-dead-whisper";
    expect(deadLineProblems(swapped)).toContain("does not start with the welcome");
    expect(deadLineProblems(swapped)).toContain("recording is reachable without the welcome");
    const both = structuredClone(dead);
    action(both, "record-agent-only").Parameters.RecordingBehavior = {
      RecordedParticipants: ["Agent", "Customer"],
    };
    action(both, "record-agent-only").Transitions.Errors = [
      { ErrorType: "NoMatchingError", NextAction: "set-dead-whisper" },
    ];
    expect(deadLineProblems(both)).toEqual([
      "the recording block does not record exactly the Agent",
      "the recording block has an error branch",
    ]);
  });

  it("catches a positive, dynamic or late routing adjustment", () => {
    const positive = structuredClone(dead);
    action(positive, "set-patience").Parameters.QueueTimeAdjustmentSeconds = "300";
    expect(deadLineProblems(positive)).toEqual([
      "the routing adjustment is 300, not a static negative",
    ]);
    const dynamic = structuredClone(dead);
    action(dynamic, "set-patience").Parameters.QueueTimeAdjustmentSeconds = "$.Attributes.patience";
    expect(deadLineProblems(dynamic)).toHaveLength(1);
    const late = structuredClone(dead);
    action(late, "note-beyond").Transitions.NextAction = "set-callback-number";
    expect(deadLineProblems(late)).toEqual([
      "the transfer is reachable without the routing adjustment",
      "the target queue is set before the routing adjustment",
    ]);
  });

  it("catches a hook wired past, missing or doubled", () => {
    const missing = structuredClone(dead);
    const whisper = action(missing, "set-dead-whisper");
    whisper.Transitions.NextAction = "set-dead-queue-experience";
    whisper.Transitions.Errors = [
      { ErrorType: "NoMatchingError", NextAction: "set-dead-queue-experience" },
    ];
    // The block is still there, and still sets nothing.
    expect(deadLineProblems(missing)).toEqual([
      "CustomerHold is undefined, expected ${cdref:flow:hh-dead-hold}",
    ]);
    missing.content.Actions = missing.content.Actions.filter(
      (a) => a.Identifier !== "set-dead-hold",
    );
    expect(deadLineProblems(missing)).toEqual([
      "CustomerHold is undefined, expected ${cdref:flow:hh-dead-hold}",
    ]);
    const doubled = structuredClone(dead);
    (action(doubled, "set-dead-hold").Parameters.EventHooks as Record<string, string>).AgentHold =
      "${cdref:flow:hh-agent-hold}";
    expect(deadLineProblems(doubled)).toEqual(["set-dead-hold sets more than one hook"]);
  });
});

describe("hooked flows never point back", () => {
  const hookTargets = (d: FlowDoc) =>
    d.content.Actions.filter((a) => a.Type === "UpdateContactEventHooks").flatMap((a) =>
      Object.values(a.Parameters.EventHooks as Record<string, string>).map((flow) => ({
        block: a.Identifier,
        flow: /^\$\{cdref:flow:(.+)\}$/.exec(flow)?.[1] ?? flow,
      })),
    );
  const problems = (d: FlowDoc, set: ReadonlyMap<string, FlowDoc> = byName) =>
    hookTargets(d).flatMap(({ block, flow }) => {
      if (flow === d.name) return [`${d.name}#${block}: hooks itself`];
      const target = set.get(flow);
      if (target === undefined)
        return [`${d.name}#${block}: hooks ${flow}, which is not in the set`];
      const back = collectRefs(target.content).some((r) => r.type === "flow" && r.name === d.name);
      return back ? [`${d.name}#${block}: hooks ${flow}, which references ${d.name} back`] : [];
    });

  it("would notice a hook that points back, so the check means something", () => {
    const d = structuredClone(doc("hh-dead-line"));
    (action(d, "set-dead-whisper").Parameters.EventHooks as Record<string, string>).AgentWhisper =
      "${cdref:flow:hh-dead-line}";
    expect(problems(d)).toEqual(["hh-dead-line#set-dead-whisper: hooks itself"]);
  });

  // The branch VERIFY 16.3 is about: a hooked flow that references its
  // caller cycles the resource graph.
  it("would notice a hooked flow that references its caller back", () => {
    const whisper = structuredClone(doc("hh-dead-whisper"));
    whisper.content.Actions.push({
      Identifier: "back-to-the-line",
      Type: "TransferToFlow",
      Parameters: { ContactFlowId: "${cdref:flow:hh-dead-line}" },
      Transitions: {},
    });
    const set = new Map(byName);
    set.set("hh-dead-whisper", whisper);
    expect(problems(doc("hh-dead-line"), set)).toEqual([
      "hh-dead-line#set-dead-whisper: hooks hh-dead-whisper, which references hh-dead-line back",
    ]);
  });

  it.each(flows.map((l) => l.doc.name))("%s", (name) => {
    expect(problems(doc(name))).toEqual([]);
  });
});

describe("the callback number", () => {
  const setters = flows.flatMap((l) =>
    l.doc.content.Actions.filter((a) => a.Type === "UpdateContactCallbackNumber").map((a) => ({
      where: `${l.doc.name}#${a.Identifier}`,
      a,
    })),
  );
  const problems = (where: string, a: FlowAction) => {
    const out: string[] = [];
    if (a.Parameters.CallbackNumber !== "$.CustomerEndpoint.Address") {
      out.push(`${where}: number is ${String(a.Parameters.CallbackNumber)}, not the caller's`);
    }
    const errors = (a.Transitions.Errors ?? []).map((e) => e.ErrorType);
    for (const e of ["CallbackNumberNotDialable", "InvalidCallbackNumber"]) {
      if (!errors.includes(e)) out.push(`${where}: ${e} is not wired`);
    }
    return out;
  };

  it("is set somewhere, and the check catches a static number or a missing error", () => {
    expect(setters.map((s) => s.where)).toContain("hh-dead-line#set-callback-number");
    const first = setters[0];
    if (first === undefined) throw new Error("no UpdateContactCallbackNumber");
    const broken = structuredClone(first.a);
    broken.Parameters.CallbackNumber = "+14135550100";
    broken.Transitions.Errors = (broken.Transitions.Errors ?? []).slice(0, 1);
    expect(problems(first.where, broken)).toHaveLength(2);
  });

  it.each(setters.map((s) => [s.where, s.a] as const))(
    "%s reads the caller's number and wires both errors (VERIFY 6.2)",
    (where, a) => {
      expect(problems(where, a)).toEqual([]);
    },
  );

  it("in the dead line, both errors say so and rejoin the hours check", () => {
    const d = doc("hh-dead-line");
    const a = action(d, "set-callback-number");
    for (const e of a.Transitions.Errors ?? []) expect(e.NextAction).toBe("cannot-ring-back");
    expect(action(d, "cannot-ring-back").Parameters.Text).toContain("stay on the line");
    expect(action(d, "cannot-ring-back").Transitions.NextAction).toBe(a.Transitions.NextAction);
  });
});

describe("hh-dead-queue-experience", () => {
  const q = doc("hh-dead-queue-experience");

  it("is a customer queue flow with a Loop and a loop of prompts, and no dequeue", () => {
    expect(q.connectType).toBe("CUSTOMER_QUEUE");
    const t = types(q);
    expect(t.has("Loop")).toBe(true);
    expect(t.has("MessageParticipantIteratively")).toBe(true);
    for (const banned of [
      "DequeueContactAndTransferToQueue",
      "Wait",
      "InvokeFlowModule",
      "UpdateContactTargetQueue",
      "TransferContactToQueue",
    ]) {
      expect(t.has(banned), banned).toBe(false);
    }
  });

  // A queue flow that ends leaves the caller in queue with nothing further
  // from it, so an error in the interruptible loop falls to the loop that
  // keeps speaking, never to an end. The generated queue flows do the same.
  it("keeps speaking when the interruptible loop errors, and never ends", () => {
    expect((action(q, "reassure").Transitions.Errors ?? []).map((e) => e.NextAction)).toEqual([
      "settle-in",
    ]);
    expect(action(q, "keep-vigil").Transitions.Conditions?.map((c) => c.NextAction)).toContain(
      "settle-in",
    );
    expect(types(q).has("EndFlowExecution")).toBe(false);
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
      // An error in the loop falls to the loop that keeps speaking, never to
      // the end: a queue flow that ends leaves the caller with nothing more.
      expect((hold.Transitions.Errors ?? []).map((e) => e.NextAction)).toEqual(["settle-in"]);
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
    expect(holds.map((d) => d.name).sort()).toEqual([
      "hh-agent-hold",
      "hh-customer-hold",
      "hh-dead-hold",
    ]);
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
    ["${cdref:queue:the-dead}", "Beyond"],
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

  it("walks the dead line: queue:the-dead needs the Beyond name set first", () => {
    const dead = structuredClone(doc("hh-dead-line"));
    action(dead, "set-dead-agent-hold").Transitions.NextAction = "set-patience";
    expect(mismatches(dead)).toEqual([
      "hh-dead-line#set-dead-queue: ${cdref:queue:the-dead} with districtName undefined",
    ]);
  });

  it.each(flows.map((l) => l.doc.name))("%s", (name) => {
    expect(mismatches(doc(name))).toEqual([]);
  });
});
