# T1: first night

Tier 1. The smallest complete hotline: a caller is greeted, told the
safety line, interviewed on the keypad, graded, and routed to the right
district crew, in all three environments.

## Scope

- **hh-hotline-main** (CONTACT_FLOW):
  - setup: UpdateFlowLoggingBehavior, UpdateContactTextToSpeechVoice,
    TagContact;
  - a short MessageParticipant recording notice ("Hollow Hour Removal. Calls
    are recorded."), then UpdateContactRecordingAndAnalyticsBehavior, then
    InvokeFlowModule `module:greeting@live` (out of set, bound per profile);
    the notice must come first, because the recording-consent lint rule does
    not count a module as an announcement;
  - InvokeLambdaFunction `lambda:caller-lookup`, then Compare on its status;
  - keypad "Is anyone hurt?"; yes plays the emergency advice ("call your local
    emergency number, 911 in the US") and offers to end the call or continue,
    never a transfer to a ghost queue;
  - the keypad six-question interview, then `lambda:classify-apparition`, then
    Compare on the grade;
  - keypad district menu, then UpdateContactAttributes (district, grade,
    advice), never UpdateFlowAttributes for anything a whisper reads;
  - TransferToFlow to `flow:hh-district-<slug>`; Hostile and Chorus grades set
    the target queue to `queue:lantern-crew` and transfer.
  - (As built, see Deviations: the district menu is the generated
    `hh-district-menu`, and grade attributes are written at classification.)
- **Generated hh-district-<slug>** (one per `districts.config.json` entry):
  - UpdateContactTargetQueue to the district crew first, then
    UpdateContactEventHooks, one block each for CustomerWhisper, AgentWhisper
    and CustomerQueue (`flow:hh-queue-experience-<slug>`);
  - CheckHoursOfOperation `hours:<slug>`;
  - CheckMetricData and GetMetricData with an explicit QueueId; the error
    branch rejoins the main path (dev and qa have no agents);
  - TransferContactToQueue; QueueAtCapacity goes to the `overflowTo` crew;
  - after hours: a message, then DisconnectParticipant.
- **Generated hh-queue-experience-<slug>** (CUSTOMER_QUEUE): Loop,
  InvokeLambdaFunction `lambda:crew-eta`, CheckMetricData on the sibling crew,
  MessageParticipantIteratively with `InterruptFrequencySeconds "30"` and
  `MessagesInterrupted`, then DequeueContactAndTransferToQueue with an explicit
  QueueId and both errors wired. No Wait, no module, no callback yet.
- **hh-customer-whisper** and **hh-agent-whisper**, reading contact attributes
  only (the district name is an attribute, not a literal).
- **seasonal/**: hh-greeting-standard and hh-greeting-halloween (brand line,
  the emergency advice, UpdateContactAttributes `season`), and the seasonal
  roots' hand-written versions, `live` aliases and the two outputs.
- **Supporting resources** in `envs/{dev,qa,prod}`: the stub Lambdas
  (`lambdas/<name>/`, deterministic, unit-tested) with IAM roles named
  `hh-<env>-*` and an `aws_connect_lambda_function_association` each.
- `generators/districts.ts` writes each generated FlowDoc and its companion
  (via codegen) into `flows/` with a generated banner.

## Acceptance criteria

1. `flow-cli lint flows/` and `flow-cli lint seasonal/` each report no
   findings (`npm run lint:flows`).
2. codegen then synth reproduces each FlowDoc modulo layout, and a second pass
   is byte-stable.
3. Environments, from `refs/manifest.json`:
   - qa and prod emit byte-identical trees, for both `--target flowascode` and
     `--target tf`;
   - dev differs from qa and prod only in `flows.tf` (flowascode) and
     `flow_refs.tf` (tf), and only in the `hours:<district>` bindings;
   - no emitted byte is an ARN (the hygiene test's pattern), and none contains `TODO_MISSING` or a
     `null` binding under the emitter's TODO comment.
4. prod and prod-october differ only in the `hours:<district>` and
   `module:greeting@live` bindings.
5. Adding one entry to `districts.config.json` and running `npm run generate`
   yields exactly two new generated flows, one more key (a `route-<slug>` and
   a `to-<slug>` block) in the generated `hh-district-menu`, and no other flow
   diff; its queue and map entries follow by `for_each` and derivation, and
   `npm test` stays green, with no hand edit to a flow or a test
   (amended 2026-09-30; see Deviations).
6. `npm run generate` leaves no diff (`npm run generate:check` in CI).
7. The rubric tests cover every grade boundary and the injury override.
8. The copy check passes: no banned terms, the emergency line present in both
   greetings, phone numbers only from 555-0100 to 555-0199.
9. `npm run validate` passes for all three environment roots and all three
   seasonal roots with their emitted `flows.tf` in place.
10. dev, qa and prod are each applied live to their own instance through
    `deploy.yml`; `flow-cli diff flows/ --instance <that instance's ARN, from
the environment, never committed>` exits 0 for each; and scenario S2
    (keypad interview, Restless grade, routed to Old Town) passes as an
    operator run against dev with the stub Lambdas. The sandbox checklist
    below is part of this criterion.
11. The README shows the keypad scene and the dev, qa, prod comparison.

## Assumptions

- Flows are authored as FlowDocs with `.flow.ts` companions; the typed builder
  covers everything in Tier 1 (stored-input GetParticipantInput, which it does
  not type, is Tier 2).
- The out-of-set `module:greeting@live` lints clean and resolves from the map
  on the flowascode path (checked by the synthesis on 2026-09-30; re-checked
  here by criterion 1).
- The instance quota for three live environments is resolved by the owner
  before criterion 10 (VERIFY H3).

## Sandbox checklist (criterion 10)

Not done: nothing has been deployed. Each item is recorded, dated, in
`VERIFY.md` (status `sandbox-checked <date>, <message>`) and here.

- Owner setup first: a third Connect instance (VERIFY H3), one OIDC deploy
  role per environment with the actions in `envs/README.md`, the state
  bucket, and the GitHub environments' variables with a reviewer on prod.
- Dispatch `deploy.yml` with `apply` for dev, then qa, then prod. Record H1
  and H2 (the hours), 7b (the hand-written module version and alias), L2 and
  L3 (the Lambda association), I5 (the 5 second interrupt on `moving`; fall
  back to 10 or 30 if refused) and Q2 (the queue cap) from the dev apply.
- `flow-cli diff flows/ --instance <ARN from the environment>` exits 0 for
  each environment.
- Run S2 against dev (`node scenarios/resource-map.mjs dev`, then
  `flow-cli simulate`). It is the gate for L1: its `callerName` and
  `gradeName` asserts read back the spoken values the JSON-validated
  Lambdas return, and a refused response shows as the classify error path.
  Record S2 and L1.
- Fill a dev crew queue with two test contacts and place a third call to hear
  the overflow to the sibling crew, and a move from the queue flow; record
  Q1 (which queue flow plays after the dequeue).

## Deviations (2026-09-30)

Where the build departs from the scope above, and why.

- **TagContact comes after the greeting**, not in setup. It tags the
  `season` contact attribute, which the greeting module sets, so it can only
  run once the module has.
- **grade, gradeName and advice are written at classification**
  (`record-grade`, straight after `classify`), not at the district step. The
  advice is spoken to the caller right away (`share-advice`), and the Lantern
  Crew and dispatch paths, which skip the district menu, need them for the
  agent whisper too.
- **The district menu is generated.** It is `hh-district-menu`, written by
  `npm run generate` from `districts.config.json` and reached from
  `hh-hotline-main` by one TransferToFlow. A hand-authored menu in
  `hh-hotline-main` made criterion 5 false: a new district also needed a menu
  key, two blocks and two test edits before `npm test` was green again.
  Criterion 5 is amended to name the one generated flow that changes.
- **The Lantern Crew and dispatch paths set districtName and both
  whispers** (`Lantern`, `Dispatch`), so the grade 4 and 5 calls, the most
  serious, reach an agent with the same context as the rest. They keep the
  default customer queue flow; a generic queue flow is Tier 2.
- **The district follows the contact.** Before an overflow, `hh-district-<slug>`
  rewrites district and districtName and hooks the sibling's queue flow;
  before a move, `hh-queue-experience-<slug>` rewrites them and sets
  `moved=true`, which its first block reads to skip the offer (VERIFY Q1).
  `tests/flows.test.ts` walks every path and fails when a queue is targeted or
  a queue flow hooked under another crew's name.
- **The move's loop prompt interrupts after 5 seconds**, not 30: the caller
  who pressed 1 should not wait half a minute to move. The value is unchecked
  (VERIFY I5), and the hold loop keeps 30.
- **Lambda contracts.** caller-lookup, classify-apparition and crew-eta are
  invoked with `JSON` response validation, because each returns spoken values
  with spaces and punctuation and validation covers the whole response
  (VERIFY L1). For a caller who said someone is hurt, the
  classifier's advice no longer repeats the emergency line: the flow has
  already given it and the caller chose to stay on, so it says to keep
  everyone together instead; `safety` is still `911`.
- **Queues are capped** (`max_contacts`, 2 in dev and qa, 25 in prod), so
  QueueAtCapacity, the overflow and the lines-busy copy can fire live
  (VERIFY Q2).
