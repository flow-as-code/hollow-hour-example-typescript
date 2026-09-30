/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// scripts/drift.mjs: the normalizer that lets a FlowDoc's tokens and the live
// flow's ARNs be compared, which `flow-cli diff` 0.2.0 cannot do (it names
// the token after the physical resource). No AWS call is made here.

import { describe, expect, it } from "vitest";
import {
  arnType,
  backoffMs,
  compareContent,
  isThrottle,
  normalize,
  pacedSender,
  redact,
} from "../scripts/drift.mjs";

// Made-up ARNs, built from parts, with a short fake account.
const prefix = ["arn", "aws"].join(":");
const inst = `${prefix}:connect:us-west-2:123:instance/i-1`;
const oldTown = `${inst}/queue/q-1`;
const harborside = `${inst}/queue/q-2`;
const alwaysOpen = `${inst}/operating-hours/h-1`;
const lookup = `${prefix}:lambda:us-west-2:123:function:hh-dev-caller-lookup`;
const alias = `${inst}/flow-module/m-1:a-1`;

const map = {
  "queue:old-town-crew": oldTown,
  "queue:harborside-crew": harborside,
  "hours:old-town": alwaysOpen,
  "hours:the-dead": alwaysOpen,
  "lambda:caller-lookup": lookup,
  "module:greeting@live": alias,
};

const flow = (queue: string, extra: Record<string, unknown> = {}) => ({
  Version: "2019-10-30",
  StartAction: "to-queue",
  Actions: [
    {
      Identifier: "to-queue",
      Type: "UpdateContactTargetQueue",
      Parameters: { QueueId: queue },
      Transitions: { NextAction: "done", Errors: [], Conditions: [] },
      ...extra,
    },
    { Identifier: "done", Type: "DisconnectParticipant", Parameters: {}, Transitions: {} },
  ],
});

describe("drift normalizer", () => {
  it("reads the reference type from an ARN", () => {
    expect(arnType(oldTown)).toBe("queue");
    expect(arnType(alwaysOpen)).toBe("hours");
    expect(arnType(`${inst}/contact-flow/f-1`)).toBe("flow");
    expect(arnType(alias)).toBe("module");
    expect(arnType(lookup)).toBe("lambda");
  });

  it("gives a token and the ARN its key binds the same form, through the map", () => {
    expect(normalize("${cdref:queue:old-town-crew}", map)).toBe("${ref:queue:old-town-crew}");
    expect(normalize(oldTown, map)).toBe("${ref:queue:old-town-crew}");
    // Two keys bound to one resource name both, on either side.
    expect(normalize("${cdref:hours:old-town}", map)).toBe(normalize(alwaysOpen, map));
    expect(normalize(alwaysOpen, map)).toBe("${ref:hours:old-town,hours:the-dead}");
    expect(normalize("${cdref:module:greeting@live}", map)).toBe(normalize(alias, map));
  });

  it("falls back to the type alone without a map, and never keeps an ARN", () => {
    expect(normalize("${cdref:queue:old-town-crew}")).toBe("${ref:queue}");
    expect(normalize(harborside)).toBe("${ref:queue}");
    expect(normalize(`Call ${lookup} now`)).toBe("Call ${ref:lambda} now");
    expect(JSON.stringify(normalize(flow(oldTown), map))).not.toContain(prefix);
  });

  it("marks what the map does not bind, and keeps unmapped references apart", () => {
    const unknown = normalize(`${inst}/queue/q-9`, map) as string;
    expect(unknown).toMatch(/^\$\{ref:queue:unmapped:[0-9a-f]{12}\}$/);
    expect(unknown).not.toContain(prefix);
    expect(normalize(`${inst}/queue/q-8`, map)).not.toBe(unknown);
    expect(normalize("${cdref:queue:nowhere}", map)).toBe("${ref:queue:nowhere:unmapped}");
    expect(normalize("${cdref:queue:nowhere}", map)).not.toBe(unknown);
  });

  it("finds a missing map key pointed at a live resource the map does not know", () => {
    const found = compareContent(flow("${cdref:queue:nowhere}"), flow(`${inst}/queue/q-9`), map);
    expect(found.length).toBeGreaterThan(0);
  });

  it("redacts ARNs, ids and account ids from an error message", () => {
    // A made-up twelve-digit account, built from parts like the ARNs above.
    const account = "1111" + "2222" + "3333";
    const role = `${prefix}:sts::${account}:assumed-role/dev/me`;
    const msg = `User: ${role} is not authorized on instance 0f0e0d0c-1111-2222-3333-444455556666 (account ${account})`;
    const out = redact(msg);
    expect(out).not.toContain(prefix);
    expect(out).not.toContain(account);
    expect(out).not.toContain("0f0e0d0c");
    expect(out).toContain("is not authorized");
  });

  it("sorts keys and drops canvas Metadata", () => {
    expect(normalize({ b: 1, Metadata: { x: 1 }, a: [{ Metadata: {}, z: 2, y: 1 }] })).toEqual({
      a: [{ y: 1, z: 2 }],
      b: 1,
    });
  });
});

describe("drift comparison", () => {
  it("finds no drift between a FlowDoc and the live flow it deployed as", () => {
    expect(compareContent(flow("${cdref:queue:old-town-crew}"), flow(oldTown), map)).toEqual([]);
    expect(compareContent(flow("${cdref:queue:old-town-crew}"), flow(oldTown))).toEqual([]);
  });

  it("finds a reference moved to another resource when the map is there", () => {
    const found = compareContent(flow("${cdref:queue:old-town-crew}"), flow(harborside), map);
    expect(found).toEqual([
      'action to-queue: Parameters.QueueId: local "${ref:queue:old-town-crew}", live "${ref:queue:harborside-crew}"',
    ]);
  });

  it("finds an edited parameter, a removed action and another start", () => {
    const live = flow(oldTown, { Parameters: { QueueId: oldTown, Extra: "1" } });
    expect(compareContent(flow("${cdref:queue:old-town-crew}"), live, map)).toEqual([
      'action to-queue: Parameters.Extra: local undefined, live "1"',
    ]);
    const shorter = { ...flow(oldTown), Actions: flow(oldTown).Actions.slice(0, 1) };
    expect(compareContent(flow("${cdref:queue:old-town-crew}"), shorter, map)).toEqual([
      "actions not live: done",
    ]);
    const moved = { ...flow(oldTown), StartAction: "done" };
    expect(compareContent(flow("${cdref:queue:old-town-crew}"), moved, map)).toEqual([
      "StartAction: local to-queue, live done",
    ]);
  });
});

// A fake clock: sleep advances it, so pacing and backoff are observable
// without waiting.
function clock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

const throttle = (name = "TooManyRequestsException") =>
  Object.assign(new Error("Too Many Requests"), { name, $metadata: { httpStatusCode: 429 } });

/** A client that fails with each error in `failures`, then answers `ok`. */
function stub(failures: Error[]) {
  const calls: { at: number; command: unknown }[] = [];
  const c = clock();
  const client = {
    send: async (command: unknown) => {
      calls.push({ at: c.now(), command });
      const next = failures.shift();
      if (next !== undefined) throw next;
      return { ok: command };
    },
  };
  return { client, calls, c };
}

describe("drift pacing and throttling retries", () => {
  it("recognizes Connect's throttling refusals and nothing else", () => {
    expect(isThrottle(throttle())).toBe(true);
    expect(isThrottle(Object.assign(new Error("x"), { name: "ThrottlingException" }))).toBe(true);
    expect(isThrottle(Object.assign(new Error("x"), { $metadata: { httpStatusCode: 429 } }))).toBe(
      true,
    );
    expect(isThrottle(new Error("Too Many Requests"))).toBe(true);
    expect(isThrottle(Object.assign(new Error("no"), { name: "AccessDeniedException" }))).toBe(
      false,
    );
    expect(isThrottle(undefined)).toBe(false);
  });

  it("backs off exponentially under a cap, with full jitter", () => {
    const top = () => 0.999999;
    expect([0, 1, 2, 3, 4, 5, 6].map((a) => backoffMs(a, { random: top }))).toEqual([
      999, 1999, 3999, 7999, 15999, 19999, 19999,
    ]);
    expect(backoffMs(3, { random: () => 0 })).toBe(0);
    expect(backoffMs(1, { base: 100, max: 150, random: () => 0.5 })).toBe(75);
  });

  it("retries a throttled call until it succeeds", async () => {
    const { client, calls, c } = stub([throttle(), throttle("ThrottlingException")]);
    const retries: number[] = [];
    const paced = pacedSender({
      ...c,
      random: () => 0.5,
      onRetry: (n) => retries.push(n),
    });
    await expect(paced(() => client.send("describe"))).resolves.toEqual({ ok: "describe" });
    expect(calls).toHaveLength(3);
    expect(retries).toEqual([1, 2]);
    // Backoffs 500 then 1000 (half of 1 s, then of 2 s); no pacing wait is
    // needed once a backoff has already spaced the calls.
    expect(c.sleeps).toEqual([500, 1000]);
  });

  it("gives up after the bounded retries and throws the last refusal", async () => {
    const { client, calls, c } = stub(Array.from({ length: 10 }, () => throttle()));
    const paced = pacedSender({ ...c, retries: 3, random: () => 0 });
    await expect(paced(() => client.send("list"))).rejects.toThrow("Too Many Requests");
    expect(calls).toHaveLength(4);
  });

  it("does not retry any other error", async () => {
    const denied = Object.assign(new Error("denied"), { name: "AccessDeniedException" });
    const { client, calls, c } = stub([denied]);
    const paced = pacedSender(c);
    await expect(paced(() => client.send("list"))).rejects.toBe(denied);
    expect(calls).toHaveLength(1);
    expect(c.sleeps).toEqual([]);
  });

  it("spaces calls at least the pace apart", async () => {
    const { client, calls, c } = stub([]);
    const paced = pacedSender({ ...c, paceMs: 500 });
    for (const cmd of ["a", "b", "c"]) await paced(() => client.send(cmd));
    expect(calls.map((x) => x.at)).toEqual([0, 500, 1000]);
  });
});
