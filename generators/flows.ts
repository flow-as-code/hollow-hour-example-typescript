/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
// The two flows every district gets, built with the typed builder from
// @flow-as-code/core and written by generate.ts as a FlowDoc plus its codegen
// companion. Block ids do not carry the slug, so two districts' flows differ
// only in names, references and copy, and a diff between them reads cleanly.
//
// Design notes, each forced by a VERIFY.md row or a lint rule:
// - hh-district-<slug> sets the target queue before anything reads it
//   (VERIFY 16.2, 16.6), passes QueueId explicitly to both metric actions, and
//   rejoins the transfer on a metric error, because dev and qa have no agents
//   and GetMetricData errors with no activity (16.6).
// - Whisper copy reads contact attributes, which hh-hotline-main sets; flow
//   attributes do not reach whispers (16.6). UpdateFlowAttributes here holds
//   one flow-local value, the overflow crew's name, read later in this flow.
// - The hold hooks travel with the whisper hooks (one hook per block, 16.3):
//   wherever a path can reach an agent, CustomerHold and AgentHold are set in
//   the same chain, so no path gets Connect's default hold (decided
//   2026-10-05, tasks/T2-full-moon.md).
// - hh-queue-experience-<slug> is one flow per district because its sibling
//   queue is a static reference (synthesis section 2, item 2). It uses no
//   Wait (chat only, 16.1), no module and no target-queue update (both illegal
//   in CUSTOMER_QUEUE), and plays a Loop prompts block before the dequeue, as
//   the admin guide requires (16.1b).
// - A caller who changes crew changes district with it. hh-district-<slug>
//   rewrites district and districtName and points the CustomerQueue hook at
//   the sibling's queue flow before it overflows; the queue flow cannot point
//   at its sibling's queue flow (the overflowTo ring would make a Terraform
//   dependency cycle), so it rewrites the attributes and sets moved=true,
//   which its first block reads to skip the offer if Connect restarts it
//   after the dequeue (VERIFY Q1). Whispers read those attributes.
// - hh-district-menu is generated too, so adding a district is one config
//   entry: the menu gains its key, and no hand-authored flow changes.

import {
  CheckHoursOfOperation,
  CheckMetricData,
  Compare,
  DequeueContactAndTransferToQueue,
  DisconnectParticipant,
  EndFlowExecution,
  Flow,
  GetMetricData,
  GetParticipantInput,
  InvokeLambdaFunction,
  Loop,
  MessageParticipant,
  MessageParticipantIteratively,
  Refs,
  TransferContactToQueue,
  TransferToFlow,
  UpdateContactAttributes,
  UpdateContactEventHooks,
  UpdateContactTargetQueue,
  UpdateFlowAttributes,
  jsonPath,
} from "@flow-as-code/core";
import type { DtmfBranch } from "@flow-as-code/core";
import type { District } from "./config.js";

export const districtFlowName = (slug: string) => `hh-district-${slug}`;
export const queueExperienceFlowName = (slug: string) => `hh-queue-experience-${slug}`;
export const DISTRICT_MENU = "hh-district-menu";
export const crewQueue = (slug: string) => Refs.queue(`${slug}-crew`);

/** Seconds the "moving you" loop prompt plays before the dequeue (VERIFY I5). */
export const MOVE_INTERRUPT_SECONDS = 5;
/** Seconds the in-queue hold message plays before the loop polls the crews again. */
export const HOLD_INTERRUPT_SECONDS = 30;
/** How many times the queue flow polls before it settles into the long hold. */
export const POLL_ROUNDS = 3;

function sibling(d: District, districts: readonly District[]): District {
  const found = districts.find((x) => x.slug === d.overflowTo);
  if (found === undefined)
    throw new Error(`${d.slug}: overflowTo "${d.overflowTo}" is not a district`);
  return found;
}

/**
 * hh-district-<slug> (CONTACT_FLOW): reached by TransferToFlow from
 * hh-hotline-main once the caller has picked this district.
 */
export function districtFlow(d: District, districts: readonly District[]): Flow {
  const over = sibling(d, districts);
  return new Flow({
    name: districtFlowName(d.slug),
    description: `Dispatch for ${d.name}. Generated from districts.config.json by generators/districts.ts; edit the config, not this flow.`,
    connectType: "CONTACT_FLOW",
  }).add(
    new UpdateContactTargetQueue({
      id: "set-crew-queue",
      queue: crewQueue(d.slug),
      next: "set-customer-whisper",
      onError: "hand-to-dispatch",
    }),
    new UpdateContactEventHooks({
      id: "set-customer-whisper",
      hook: "CustomerWhisper",
      flow: Refs.flow("hh-customer-whisper"),
      next: "set-agent-whisper",
      onError: "set-agent-whisper",
    }),
    new UpdateContactEventHooks({
      id: "set-agent-whisper",
      hook: "AgentWhisper",
      flow: Refs.flow("hh-agent-whisper"),
      next: "set-customer-hold",
      onError: "set-customer-hold",
    }),
    new UpdateContactEventHooks({
      id: "set-customer-hold",
      hook: "CustomerHold",
      flow: Refs.flow("hh-customer-hold"),
      next: "set-agent-hold",
      onError: "set-agent-hold",
    }),
    new UpdateContactEventHooks({
      id: "set-agent-hold",
      hook: "AgentHold",
      flow: Refs.flow("hh-agent-hold"),
      next: "set-queue-experience",
      onError: "set-queue-experience",
    }),
    new UpdateContactEventHooks({
      id: "set-queue-experience",
      hook: "CustomerQueue",
      flow: Refs.flow(queueExperienceFlowName(d.slug)),
      next: "note-overflow-crew",
      onError: "note-overflow-crew",
    }),
    new UpdateFlowAttributes({
      id: "note-overflow-crew",
      attributes: { overflowCrew: over.name },
      next: "check-hours",
      onError: "check-hours",
    }),
    new CheckHoursOfOperation({
      id: "check-hours",
      hours: Refs.hours(d.slug),
      onInHours: "check-staffing",
      onOutOfHours: "after-hours",
      onError: "check-staffing",
    }),
    new CheckMetricData({
      id: "check-staffing",
      queue: crewQueue(d.slug),
      metric: "NumberOfAgentsAvailable",
      branches: [{ operator: "NumberGreaterThan", operand: 0, target: "crew-ready" }],
      onNoMatch: "read-queue",
      onError: "transfer-to-crew",
    }),
    new MessageParticipant({
      id: "crew-ready",
      text: `The ${d.name} crew has someone free. Connecting you now.`,
      next: "transfer-to-crew",
      onError: "transfer-to-crew",
    }),
    new GetMetricData({
      id: "read-queue",
      queue: crewQueue(d.slug),
      next: "announce-line",
      onError: "transfer-to-crew",
    }),
    new MessageParticipant({
      id: "announce-line",
      text: `The ${d.name} crew is out on calls. Callers ahead of you: $.Metrics.Queue.Size. Stay on the line and we will keep your place.`,
      next: "transfer-to-crew",
      onError: "transfer-to-crew",
    }),
    new TransferContactToQueue({
      id: "transfer-to-crew",
      next: "hang-up",
      onQueueAtCapacity: "crew-full",
      onError: "apologize",
    }),
    new MessageParticipant({
      id: "crew-full",
      text: `The ${d.name} crew is full tonight. Moving you to the $.FlowAttributes.overflowCrew crew.`,
      next: "note-overflow-district",
      onError: "note-overflow-district",
    }),
    new UpdateContactAttributes({
      id: "note-overflow-district",
      attributes: { district: over.slug, districtName: over.name },
      next: "set-overflow-queue-experience",
      onError: "set-overflow-queue-experience",
    }),
    new UpdateContactEventHooks({
      id: "set-overflow-queue-experience",
      hook: "CustomerQueue",
      flow: Refs.flow(queueExperienceFlowName(over.slug)),
      next: "set-overflow-queue",
      onError: "set-overflow-queue",
    }),
    new UpdateContactTargetQueue({
      id: "set-overflow-queue",
      queue: crewQueue(over.slug),
      next: "transfer-to-overflow",
      onError: "apologize",
    }),
    new TransferContactToQueue({
      id: "transfer-to-overflow",
      next: "hang-up",
      onQueueAtCapacity: "lines-busy",
      onError: "apologize",
    }),
    new MessageParticipant({
      id: "after-hours",
      text: `The ${d.name} crew is off shift right now. Night crews start at 4 in the afternoon. If anyone is hurt or in danger, call your local emergency number (911 in the US).`,
      next: "hang-up",
      onError: "hang-up",
    }),
    ...dispatchBlocks(),
  );
}

/**
 * hh-queue-experience-<slug> (CUSTOMER_QUEUE): what a caller in this crew's
 * queue hears, set as the CustomerQueue hook by hh-district-<slug>.
 */
export function queueExperienceFlow(d: District, districts: readonly District[]): Flow {
  const over = sibling(d, districts);
  return new Flow({
    name: queueExperienceFlowName(d.slug),
    description: `Queue for the ${d.name} crew, offering a move to ${over.name} when that crew is free. Generated from districts.config.json by generators/districts.ts; edit the config, not this flow.`,
    connectType: "CUSTOMER_QUEUE",
  }).add(
    // Compare writes NextAction as its onNoMatch target, which Connect
    // requires (VERIFY C1).
    new Compare({
      id: "check-moved",
      value: jsonPath("$.Attributes.moved"),
      branches: [{ operator: "Equals", operands: ["true"], target: "settle-in" }],
      onNoMatch: "poll-crews",
    }),
    new Loop({
      id: "poll-crews",
      count: POLL_ROUNDS,
      onContinue: "check-eta",
      onDone: "settle-in",
    }),
    new InvokeLambdaFunction({
      id: "check-eta",
      lambda: Refs.lambda("crew-eta"),
      timeoutSeconds: 3,
      // JSON, not STRING_MAP: crew-eta also returns crewName and message,
      // which carry spaces, and validation covers the whole response (VERIFY L1).
      responseType: "JSON",
      attributes: { district: d.slug },
      next: "share-eta",
      onError: "check-sibling",
    }),
    new MessageParticipant({
      id: "share-eta",
      text: `The ${d.name} crew expects to be free in about $.External.etaMinutes minutes.`,
      next: "check-sibling",
      onError: "check-sibling",
    }),
    new CheckMetricData({
      id: "check-sibling",
      queue: crewQueue(over.slug),
      metric: "NumberOfAgentsAvailable",
      branches: [{ operator: "NumberGreaterThan", operand: 0, target: "offer-move" }],
      onNoMatch: "hold",
      onError: "hold",
    }),
    new GetParticipantInput({
      id: "offer-move",
      text: `The ${over.name} crew has someone free right now. To move to them, press 1. To keep your place here, press 2.`,
      timeoutSeconds: 6,
      branches: [
        { digit: "1", target: "note-move" },
        { digit: "2", target: "hold" },
      ],
      onTimeout: "hold",
      onNoMatch: "hold",
      onError: "hold",
    }),
    new UpdateContactAttributes({
      id: "note-move",
      attributes: { district: over.slug, districtName: over.name, moved: "true" },
      next: "moving",
      onError: "hold",
    }),
    new MessageParticipantIteratively({
      id: "moving",
      messages: [{ text: `Moving you to the ${over.name} crew now.` }],
      interruptFrequencySeconds: MOVE_INTERRUPT_SECONDS,
      onInterrupt: "move-to-sibling",
      onError: "stay-here",
    }),
    new DequeueContactAndTransferToQueue({
      id: "move-to-sibling",
      queue: crewQueue(over.slug),
      next: "done",
      onQueueAtCapacity: "sibling-full",
      onError: "stay-here",
    }),
    new MessageParticipant({
      id: "sibling-full",
      text: `The ${over.name} crew just filled up. You still have your place with ${d.name}.`,
      next: "stay-here",
      onError: "stay-here",
    }),
    new UpdateContactAttributes({
      id: "stay-here",
      attributes: { district: d.slug, districtName: d.name, moved: "false" },
      next: "hold",
      onError: "hold",
    }),
    new MessageParticipantIteratively({
      id: "hold",
      messages: [
        {
          text: "While you wait: keep the lights on, keep pets close, and stay in a room with a door you can open.",
        },
        { text: "A line of salt across the doorway never hurts. Nor does a cup of tea." },
      ],
      interruptFrequencySeconds: HOLD_INTERRUPT_SECONDS,
      onInterrupt: "poll-crews",
      onError: "settle-in",
    }),
    new MessageParticipantIteratively({
      id: "settle-in",
      messages: [
        {
          text: "You are still in line for the $.Attributes.districtName crew, and they know you are waiting.",
        },
        { text: "Keep the lights on and stay with others. A crew member will be with you soon." },
      ],
    }),
    new EndFlowExecution({ id: "done" }),
  );
}

/** The dispatch fallback both generated contact flows end on, with its whispers and holds set. */
function dispatchBlocks() {
  return [
    new MessageParticipant({
      id: "hand-to-dispatch",
      text: "Let me put you through to a dispatcher.",
      next: "note-dispatch",
      onError: "note-dispatch",
    }),
    new UpdateContactAttributes({
      id: "note-dispatch",
      attributes: { districtName: "Dispatch" },
      next: "set-dispatch-customer-whisper",
      onError: "set-dispatch-customer-whisper",
    }),
    new UpdateContactEventHooks({
      id: "set-dispatch-customer-whisper",
      hook: "CustomerWhisper",
      flow: Refs.flow("hh-customer-whisper"),
      next: "set-dispatch-agent-whisper",
      onError: "set-dispatch-agent-whisper",
    }),
    new UpdateContactEventHooks({
      id: "set-dispatch-agent-whisper",
      hook: "AgentWhisper",
      flow: Refs.flow("hh-agent-whisper"),
      next: "set-dispatch-customer-hold",
      onError: "set-dispatch-customer-hold",
    }),
    new UpdateContactEventHooks({
      id: "set-dispatch-customer-hold",
      hook: "CustomerHold",
      flow: Refs.flow("hh-customer-hold"),
      next: "set-dispatch-agent-hold",
      onError: "set-dispatch-agent-hold",
    }),
    new UpdateContactEventHooks({
      id: "set-dispatch-agent-hold",
      hook: "AgentHold",
      flow: Refs.flow("hh-agent-hold"),
      next: "set-dispatch-queue",
      onError: "set-dispatch-queue",
    }),
    new UpdateContactTargetQueue({
      id: "set-dispatch-queue",
      queue: Refs.queue("dispatch-overflow"),
      next: "transfer-to-dispatch",
      onError: "apologize",
    }),
    new TransferContactToQueue({
      id: "transfer-to-dispatch",
      next: "hang-up",
      onQueueAtCapacity: "lines-busy",
      onError: "apologize",
    }),
    new MessageParticipant({
      id: "lines-busy",
      text: "Every crew is out on a call. Please call back in a few minutes.",
      next: "hang-up",
      onError: "hang-up",
    }),
    new MessageParticipant({
      id: "apologize",
      text: "Something went wrong on our side. Please call back in a few minutes.",
      next: "hang-up",
      onError: "hang-up",
    }),
    new DisconnectParticipant({ id: "hang-up" }),
  ];
}

/**
 * hh-district-menu (CONTACT_FLOW): the keypad district menu, one key per
 * district in config order, reached by TransferToFlow from hh-hotline-main for
 * the grades a district crew takes. Each key records the district as contact
 * attributes, which the whispers and queue flows read, and transfers to
 * hh-district-<slug>.
 */
export function districtMenuFlow(districts: readonly District[]): Flow {
  const offer = districts.map((d, i) => `For ${d.name}, press ${String(i + 1)}.`).join(" ");
  return new Flow({
    name: DISTRICT_MENU,
    description:
      "The keypad district menu, one key per district. Generated from districts.config.json by generators/districts.ts; edit the config, not this flow.",
    connectType: "CONTACT_FLOW",
  }).add(
    new GetParticipantInput({
      id: "ask-district",
      text: `Where are you calling from? ${offer}`,
      timeoutSeconds: 8,
      // configProblems caps the districts at 9, so every key is one digit.
      branches: districts.map((d, i) => ({
        digit: String(i + 1) as DtmfBranch["digit"],
        target: `route-${d.slug}`,
      })),
      onTimeout: "hand-to-dispatch",
      onNoMatch: "hand-to-dispatch",
      onError: "hand-to-dispatch",
    }),
    ...districts.flatMap((d) => [
      new UpdateContactAttributes({
        id: `route-${d.slug}`,
        attributes: { district: d.slug, districtName: d.name },
        next: `to-${d.slug}`,
        onError: "hand-to-dispatch",
      }),
      new TransferToFlow({
        id: `to-${d.slug}`,
        flow: Refs.flow(districtFlowName(d.slug)),
        next: "hang-up",
        onError: "hand-to-dispatch",
      }),
    ]),
    ...dispatchBlocks(),
  );
}
