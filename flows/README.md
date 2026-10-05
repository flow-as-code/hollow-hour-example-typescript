# flows/

The emitted flow set: every in-set FlowDoc (`<name>.flowdoc.json`) and its
`.flow.ts` companion, flat, every name prefixed `hh-`. Emitted per profile by
`npm run emit:<profile>`, linted by `npm run lint:flows`. One module lives
here beside the flows, `hh-offer-callback`, because the flows in this set
invoke it; the emitter writes its version and `live` alias into the same
`flows.tf` and binds the alias ARN itself, so it needs no entry in any
address map and no hand-written release (unlike the greetings in
`seasonal/`, which nothing in the set invokes).

| Flow                         | Type             | Source                             |
| ---------------------------- | ---------------- | ---------------------------------- |
| `hh-hotline-main`            | CONTACT_FLOW     | hand-authored                      |
| `hh-customer-whisper`        | CUSTOMER_WHISPER | hand-authored                      |
| `hh-agent-whisper`           | AGENT_WHISPER    | hand-authored                      |
| `hh-customer-hold`           | CUSTOMER_HOLD    | hand-authored                      |
| `hh-agent-hold`              | AGENT_HOLD       | hand-authored                      |
| `hh-dead-line`               | CONTACT_FLOW     | hand-authored                      |
| `hh-dead-whisper`            | AGENT_WHISPER    | hand-authored                      |
| `hh-dead-hold`               | CUSTOMER_HOLD    | hand-authored                      |
| `hh-dead-queue-experience`   | CUSTOMER_QUEUE   | hand-authored                      |
| `hh-offer-callback`          | MODULE           | hand-authored                      |
| `hh-district-menu`           | CONTACT_FLOW     | `npm run generate` (`generators/`) |
| `hh-district-<slug>`         | CONTACT_FLOW     | `npm run generate` (`generators/`) |
| `hh-queue-experience-<slug>` | CUSTOMER_QUEUE   | `npm run generate` (`generators/`) |

## Editing

- Generated flows: edit `districts.config.json` or `generators/flows.ts`, then
  `npm run generate`. A hand edit to a generated file fails
  `npm run generate:check` and `tests/generator.test.ts`.
- Hand-authored flows: edit the `.flow.ts`, then
  `npx flow-cli synth flows/<name>.flow.ts`, or edit on the canvas with
  `npx flow-cli studio flows`. Either way the pair stays in sync, and
  `tests/roundtrip.test.ts` holds that the companion is exactly codegen of the
  document.
- Adding a district is one config entry and `npm run generate`. The generator
  adds the district's two flows and one key to the generated
  `hh-district-menu`, and changes no other flow; no hand-authored flow or
  test needs an edit (`tests/generator.test.ts` holds that).

The two hold flows are each one MessageParticipantIteratively and nothing
else: MessageParticipant and every terminal type are illegal in hold flows,
and a loop of prompts with no next ends the flow. They are hooked wherever
the whisper hooks are set (the generated district flows, the dispatch
fallback, the Lantern Crew chain in `hh-hotline-main`), one hook per block
(VERIFY.md, row 16.3), so no path an agent can hold on gets Connect's default
hold. They never run under the simulate harness, which ends every test
before an agent; their evidence is the create and `tests/flows.test.ts`.

`hh-dead-line` is the Queue of the Dead, reached from `hh-hotline-main` when
`lambda:plane-check` answers `beyond` (the numbers 555-0190 to 555-0199, or a
caller who says so), always after the safety question. It plays its welcome
before `record-agent-only`, which records the living liaison only
(`["Agent"]`, no error branch, VERIFY.md 16.4), sets its four hooks one per
block (16.3), sets the dead's patience (`QueueTimeAdjustmentSeconds "-300"`,
static, before the transfer: the living go first tonight, 16.5), sets the
callback number from the caller's own with both errors wired (6.2), checks
`hours:the-dead` (both branches continue) and transfers to `queue:the-dead`
with QueueAtCapacity wired.

The prank screen sits between the last interview question and the
classifier: `check-injured-first` sends a caller who said someone is hurt
straight to `classify` (safety first, whatever the score), everyone else to
`lambda:prank-score` with the six answers and the caller's number. A `high`
verdict tags the contact `screen=prank-suspected` and asks, kindly, whether
this is really happening; 1 clears the tag (`untag-screen`) and the call
continues as any other, so a wrong guess leaves no mark; 2, a timeout or an
error plays "Thanks for keeping us on our toes. Call back any time something
goes bump." and hangs up. `tests/flows.test.ts` holds both: no path from a
yes to "Is anyone hurt?" reaches `prank-score`, and every path through the
tag untags it or ends the call, with one held exception: a failed
`untag-screen` goes on with the tag set, because hanging up on a caller who
pressed 1 is the worse outcome.

Every graded call becomes a work order: `open-work-order` (UpdateContactData)
runs after `record-grade` and before the advice is spoken, naming the contact
"Hollow Hour work order" statically and taking its Description from
`$.Attributes.advice`, so a crew finds the call in contact search by that name
and reads the advice the caller was given (VERIFY.md, row D1). Its catch-all
continues to `share-advice`: a refused update never costs the caller the
advice. The dispatch fallback from a failed classification opens none, since
there is no advice to record.

Callbacks (tasks/README.md, tier decision 6; VERIFY.md 16.2, 16.12, CB1):
every CreateCallbackContact names `queue:dispatch-overflow` explicitly,
never a crew queue, with static delays and attempts, and `tests/flows.test.ts`
holds that for every flow. `hh-district-<slug>` offers one in two places,
after hours and at `overflow-full` (the sibling crew is full as well;
dispatch-overflow is not known to be), through `module:hh-offer-callback@live`:
the caller's own number (`$.CustomerEndpoint.Address`, both errors wired),
then the create, then "A crew will call when the night shift starts, or
sooner if one comes free"; a refused create has its own copy and ends the
module. The offer is never made at `lines-busy`, the QueueAtCapacity branch
of the dispatch transfer, because that branch is reached exactly when
dispatch-overflow is full and a callback into a full queue takes the error
branch. A customer queue flow cannot invoke a module, so
`hh-queue-experience-<slug>` inlines the same two blocks when `crew-eta`
says the wait is `later`, errors back to the hold, and ends the taken
callback with DisconnectParticipant rather than EndFlowExecution, so no
caller is both queued and holding a callback.

## What the flows read and write

Lambda responses, read as `$.External.<key>`. Every invocation uses `JSON`
response validation, because each of these stubs also returns spoken values
with spaces and punctuation and validation covers the whole response
(VERIFY.md, row L1):

| Lambda                       | Receives                                                                                              | Returns                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `lambda:caller-lookup`       | the contact (no parameters)                                                                           | `status` (`known`, `account`, anything else is new), `callerName` |
| `lambda:classify-apparition` | `canSee`, `movesObjects`, `coldSpot`, `sounds`, `touched`, `multiple`, `injured`, each `yes` or `no` | `grade` (`1` to `5`), `gradeName`, `advice`, `safety`, `crewQueue` |
| `lambda:crew-eta`            | `district` (the slug)                                                                                 | `etaMinutes`                                                    |
| `lambda:plane-check`         | the contact (no parameters; it reads the caller's number)                                             | `plane` (`living`, `beyond`), `reason`                          |
| `lambda:prank-score`         | `callerNumber`, and the six answers (`canSee`, `movesObjects`, `coldSpot`, `sounds`, `touchedYou`, `multiple`) | `score`, `verdict` (`high`, `low`), `reason`               |

Contact attributes, which reach whispers and later flows (flow attributes do
not):

| Attribute                      | Set by                                  | Read by                              |
| ------------------------------ | --------------------------------------- | ------------------------------------ |
| `season`                       | the greeting module                     | `hh-hotline-main` (the `season` tag) |
| `callerName`, `callerStatus`   | `hh-hotline-main`                       | `hh-hotline-main` (welcome back)     |
| `grade`, `gradeName`, `advice` | `hh-hotline-main` (from the classifier; `gradeName` is `Ungraded` on the dispatch fallback from a failed classification); `gradeName` is `Departed` from `hh-dead-line` | `hh-hotline-main` (the advice and the work order), `hh-agent-whisper`, `hh-agent-hold` |
| `district`, `districtName`     | `hh-district-menu`; rewritten by `hh-district-<slug>` before an overflow, by `hh-queue-experience-<slug>` before a move, by `hh-hotline-main` for the Lantern Crew and dispatch, and by `hh-dead-line` (`beyond`, `Beyond`) | both whispers, `hh-customer-hold`, the queue flows' copy |
| `moved`                        | `hh-queue-experience-<slug>` (`true` before a move, `false` if it fails) | `hh-queue-experience-<slug>` (skips the offer) |

The interview answers are flow attributes of `hh-hotline-main`, passed to the
classifier and nowhere else. `overflowCrew` is a flow attribute of each
`hh-district-<slug>`, read by its own at-capacity message.

## Coverage

`npx vitest run tests/coverage.test.ts --reporter=verbose` prints which of the
35 modeled action types and 8 reference types the flows use and which are
still missing. Missing ones do not fail; an unmodeled action type does.
