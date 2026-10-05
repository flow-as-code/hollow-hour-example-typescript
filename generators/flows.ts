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
// - Callbacks (tasks/README.md, tier decision 6): every CreateCallbackContact
//   names queue:dispatch-overflow explicitly, never a crew queue, with static
//   delays and attempts (VERIFY 16.2). hh-district-<slug> offers one after
//   hours and at overflow-full (the sibling crew is full too; dispatch-overflow
//   is not known to be) through module:hh-offer-callback@live, an in-set
//   module: the typed Refs.module needs an alias, so the emitter writes the
//   module's version and live alias into the same flows.tf, applied with the
//   flows that invoke it. It never offers one at lines-busy, which is
//   reached exactly when dispatch-overflow is full, where the create would
//   take its error branch. A caller who declines the offer, says nothing or
//   presses a wrong key hears sign-off before the hang-up, never a silent
//   disconnect. The module's copy is shift-neutral, because it is invoked
//   mid-shift at overflow-full as well as after hours. The queue flow cannot
//   invoke a module, so it inlines the same two blocks when crew-eta says the
//   wait is long, and ends that path with DisconnectParticipant, never
//   EndFlowExecution, so no caller is both queued and holding a callback.
// - The hold A/B split: pick-hold-variant (DistributeByPercentage, 50/50) runs
//   once on entry to the queue flow, and each side records holdVariant as a
//   contact attribute and tags the contact with it, so a run is readable in
//   contact search by tag (VERIFY DP1). hold is then a Compare on the
//   attribute: recorded plays prompt:salt-line-tips, the one recorded audio
//   in the set, and falls back to the spoken tips if the prompt fails;
//   anything else plays the spoken tips. tests/flows.test.ts holds every
//   DistributeByPercentage to the shape that routes every value from 1 to
//   100 (ascending NumberLessThan thresholds at most 100, a mirrored
//   remainder) and this one to an even split.

import {
  CheckHoursOfOperation,
  CheckMetricData,
  Compare,
  CreateCallbackContact,
  DequeueContactAndTransferToQueue,
  DisconnectParticipant,
  DistributeByPercentage,
  EndFlowExecution,
  Flow,
  GetMetricData,
  GetParticipantInput,
  InvokeFlowModule,
  InvokeLambdaFunction,
  Loop,
  MessageParticipant,
  MessageParticipantIteratively,
  Refs,
  TagContact,
  TransferContactToQueue,
  TransferToFlow,
  UpdateContactAttributes,
  UpdateContactCallbackNumber,
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

/** Each side of the hold A/B split, as the contact attribute and tag value it sets. */
export const HOLD_VARIANTS = ["spoken", "recorded"] as const;
/** The share of callers who hear the spoken tips; the rest hear the recorded prompt. */
export const SPOKEN_SHARE_PERCENT = 50;

/** The callback's static schedule (VERIFY 16.2): first attempt, retries, and the gap between them. */
export const CALLBACK_SCHEDULE = {
  initialCallDelaySeconds: 60,
  maximumConnectionAttempts: 2,
  retryDelaySeconds: 600,
} as const;

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
      onQueueAtCapacity: "overflow-full",
      onError: "apologize",
    }),
    new MessageParticipant({
      id: "overflow-full",
      text: `The $.FlowAttributes.overflowCrew crew is full as well, so every crew near you is out tonight.`,
      next: "offer-callback",
      onError: "offer-callback",
    }),
    new MessageParticipant({
      id: "after-hours",
      text: `The ${d.name} crew is off shift right now. Night crews start at 4 in the afternoon. If anyone is hurt or in danger, call your local emergency number (911 in the US).`,
      next: "offer-callback",
      onError: "offer-callback",
    }),
    new GetParticipantInput({
      id: "offer-callback",
      text: "We can call you back instead. For a callback, press 1. To end the call, press 2.",
      timeoutSeconds: 8,
      branches: [
        { digit: "1", target: "take-callback" },
        { digit: "2", target: "sign-off" },
      ],
      onTimeout: "sign-off",
      onNoMatch: "sign-off",
      onError: "sign-off",
    }),
    new InvokeFlowModule({
      id: "take-callback",
      module: Refs.module("hh-offer-callback", "live"),
      next: "hang-up",
      onError: "apologize",
    }),
    new MessageParticipant({
      id: "sign-off",
      text: "All right. Keep the lights on, and call us again any time.",
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
      onNoMatch: "pick-hold-variant",
    }),
    new DistributeByPercentage({
      id: "pick-hold-variant",
      branches: [{ percent: SPOKEN_SHARE_PERCENT, target: "note-spoken-variant" }],
      onRemainder: "note-recorded-variant",
    }),
    ...HOLD_VARIANTS.flatMap((variant) => [
      new UpdateContactAttributes({
        id: `note-${variant}-variant`,
        attributes: { holdVariant: variant },
        next: `tag-${variant}-variant`,
        onError: "poll-crews",
      }),
      new TagContact({
        id: `tag-${variant}-variant`,
        tags: { holdVariant: variant },
        next: "poll-crews",
        onError: "poll-crews",
      }),
    ]),
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
      next: "check-eta-band",
      onError: "check-sibling",
    }),
    new Compare({
      id: "check-eta-band",
      value: jsonPath("$.External.etaBand"),
      branches: [{ operator: "Equals", operands: ["later"], target: "offer-callback" }],
      onNoMatch: "check-sibling",
    }),
    new GetParticipantInput({
      id: "offer-callback",
      text: "That is a long wait. For a callback from the next crew that comes free, press 1. To keep your place in line, press 2.",
      timeoutSeconds: 6,
      branches: [
        { digit: "1", target: "set-callback-number" },
        { digit: "2", target: "check-sibling" },
      ],
      onTimeout: "check-sibling",
      onNoMatch: "check-sibling",
      onError: "check-sibling",
    }),
    new UpdateContactCallbackNumber({
      id: "set-callback-number",
      callbackNumber: jsonPath("$.CustomerEndpoint.Address"),
      next: "create-callback",
      onInvalidNumber: "cannot-ring-back",
      onNotDialable: "cannot-ring-back",
    }),
    new MessageParticipant({
      id: "cannot-ring-back",
      text: "We cannot ring you back at the number you are calling from, so we will keep your place in line.",
      next: "hold",
      onError: "hold",
    }),
    new CreateCallbackContact({
      id: "create-callback",
      queue: Refs.queue("dispatch-overflow"),
      ...CALLBACK_SCHEDULE,
      next: "callback-taken",
      onError: "callback-refused",
    }),
    new MessageParticipant({
      id: "callback-refused",
      text: "We cannot take a callback right now, so we will keep your place in line.",
      next: "hold",
      onError: "hold",
    }),
    new MessageParticipant({
      id: "callback-taken",
      text: "You are on the list. A crew will call you back as soon as one comes free. Keep the lights on until then.",
      next: "let-go",
      onError: "let-go",
    }),
    new DisconnectParticipant({ id: "let-go" }),
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
    new Compare({
      id: "hold",
      value: jsonPath("$.Attributes.holdVariant"),
      branches: [{ operator: "Equals", operands: ["recorded"], target: "hold-recorded" }],
      onNoMatch: "hold-spoken",
    }),
    new MessageParticipantIteratively({
      id: "hold-spoken",
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
      id: "hold-recorded",
      messages: [{ prompt: Refs.prompt("salt-line-tips") }],
      interruptFrequencySeconds: HOLD_INTERRUPT_SECONDS,
      onInterrupt: "poll-crews",
      onError: "hold-spoken",
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
