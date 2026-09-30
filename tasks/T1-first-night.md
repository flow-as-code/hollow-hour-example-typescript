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

## Where the criteria stand (2026-09-30)

- [x] 1 to 9 and 11: offline, held by `npm run check` (lint, types,
      `generate:check`, `lint:flows`, and `npm test`, which runs
      `tests/validate.test.ts` when OpenTofu is on PATH), green on
      2026-09-30 with the Compare workaround in place (VERIFY.md, C1).
- [ ] 10, in part:
  - [x] `envs/bootstrap` applied: dev (us-west-2), qa and prod (us-east-1)
        instances and the state bucket. qa was refused on the first apply with
        `ServiceQuotaExceededException` and created by a re-apply
        (envs/README.md, Bootstrap).
  - [x] dev and qa applied, each to its own instance: 6 resources in each
        seasonal root and 55 in each flow root. By hand with the operator's
        credentials, as a saved plan then apply, not through `deploy.yml`,
        which has never run; so the deploy role's action list is still not
        exercised.
  - [x] prod applied to its own instance on 2026-09-30, at about 20:15 to
        20:20 UTC, as a saved plan then apply, after the owner authorized it
        for this demonstration: 6 resources added in the seasonal root and 55
        in the flow root. By hand, like dev and qa, not through `deploy.yml`.
  - [ ] `flow-cli diff flows/ --instance <ARN>` exits 0: it does not. On dev
        it reported 8 of the 10 flows as changed only because 0.2.0 names a
        live reference after the physical resource (envs/README.md, Checking
        drift). `flow-cli diff seasonal/` exited 0. In its place,
        `npm run drift -- dev` and `npm run drift -- qa` each reported all 12
        FlowDocs unchanged at 19:57 UTC. Later on 2026-09-30 a dev run
        failed with "Too Many Requests" (Connect throttling; its time was not
        recorded), so the check now paces its calls and retries throttling.
        The paced check reported "No drift." on dev at 20:29 UTC in 7 s, on
        prod from 20:46:44 to 20:46:51 UTC and on qa from 20:46:51 to
        20:46:58 UTC (envs/README.md, Checking drift). Runs made between the
        prod apply and 20:29 were not timed and are not counted. The criterion
        stays open until the CLI can map references, or is amended to name
        the drift check.
  - [x] S2 passed as an operator run against dev with the stub Lambdas:
        19:48:20 to 19:50:00 UTC, exit 0, JUnit tests=1 failures=0 (VERIFY.md,
        S2). On qa it could not start ("Failed to start execution of test
        case due to limit reached."); the likely cause is the qa instance's
        "Concurrent active calls per instance" quota of 0.
  - [x] S2 passed on prod, with the resource map from
        `node scenarios/resource-map.mjs prod` (27 references), at
        2026-09-30T20:24:33Z: JUnit tests=1 failures=0 errors=0, 101.218 s.
        The map script also printed that the prod state lacks
        `prompt:salt-line-tips (awscc_connect_prompt.salt_line_tips.prompt_arn)`.
        That is its report of a map key with no resource yet: the prompt is
        a Tier 2 resource (refs/manifest.json), no scenario uses it, and the
        map was written.
  - [ ] S2 on qa: the instance quota reads 0.0 (dev and prod read 10.0,
        rechecked at 20:30 UTC and again at 20:46:59 to 20:47:02 UTC). An
        increase to 10 was requested at 2026-09-30T20:12:35Z. At 20:46 UTC
        Service Quotas listed it as `CASE_OPENED`, an open AWS Support case,
        last updated at 20:15:43 UTC (envs/README.md, Bootstrap).
  - [x] dev moved from us-west-2 to us-east-1 later on 2026-09-30, at the
        owner's request that the TypeScript-first repository use us-east-1
        and the Terraform-first one us-west-2: envs/dev (55) and
        envs/seasonal-dev (6) destroyed, the bootstrap default changed, the
        dev instance replaced (refused once with "Invalid Input. Instance
        alias is already used.", created by a re-apply minutes later), the
        old flow log group deleted, seasonal-dev (6) and dev (55) applied
        again. `npm run drift` then reported "No drift." on dev, qa and
        prod (dev after its resource map was rebuilt), and S2 passed on the
        new dev in about 103 s (VERIFY.md, R1; envs/README.md, "Moving an
        environment to another Region").

## Assumptions

- Flows are authored as FlowDocs with `.flow.ts` companions; the typed builder
  covers everything in Tier 1 (stored-input GetParticipantInput, which it does
  not type, is Tier 2).
- The out-of-set `module:greeting@live` lints clean and resolves from the map
  on the flowascode path (checked by the synthesis on 2026-09-30; re-checked
  here by criterion 1).
- The instance quota for three live environments is resolved by the owner
  before criterion 10 (VERIFY H3). Resolved 2026-09-30 by Region: dev in
  us-west-2, qa and prod in us-east-1, each within the default quota of two.
  Changed later on 2026-09-30: all three in us-east-1, on a quota raised
  above two there, so that this repository and the Terraform-first one
  (all three in us-west-2) never share a Region (VERIFY R1).

## Sandbox checklist (criterion 10)

Each item is recorded, dated, in `VERIFY.md` (status
`sandbox-checked <date>, <region>: <result>`) and here. As of 2026-09-30:

- [ ] Owner setup: `envs/bootstrap` is applied (done); the OIDC deploy role
      per environment and the GitHub environments' variables, with a
      reviewer on prod, are not yet in place.
- [ ] Dispatch `deploy.yml` with `apply` for dev, then qa, then prod. All
      three were applied by hand instead, prod on 2026-09-30. From the dev
      apply and the probes on dev: H1, H2, 7b, L2, L3 and I5 are recorded
      (I5: 5 accepted, so `moving` keeps it); the apply also found C1 (the
      Compare NextAction). Q2 (the queue cap) is not recorded.
- [ ] `flow-cli diff flows/ --instance <ARN from the environment>` exits 0
      for each environment: not while 0.2.0 names references after the
      physical resource; `npm run drift` is clean on dev, qa and prod.
- [x] Run S2 against dev: passed; S2 and L1 are recorded. prod: passed
      2026-09-30. qa: not started by the service (the call quota above).
- [ ] Fill a dev crew queue with two test contacts and place a third call to
      hear the overflow to the sibling crew, and a move from the queue flow;
      record Q1 (which queue flow plays after the dequeue).

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
  who pressed 1 should not wait half a minute to move. The service accepted
  "5" on dev on 2026-09-30 (VERIFY I5), and the hold loop keeps 30.
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
- **The repository is `hollow-hour-example`** (owner decision, 2026-09-30),
  so the package name, the deploy concurrency group, the state key prefix,
  the Lambda permission statement id and the resource tag
  (`hollow-hour-example=true`) follow it. In-story names keep their form:
  Hollow Hour Removal Co. and the `hh-` prefix. Nothing had been applied, so
  no state moved.
- **The repository became `hollow-hour-example-typescript`** later on
  2026-09-30, after all three environments were live. Only repo-facing text
  followed (package name, clone URL, README). The state key prefix, the tag,
  the bucket and instance-alias patterns, the Lambda permission statement id
  and the generator stamp keep `hollow-hour-example`, because changing them
  would move live state or replace deployed resources.
- **The Lambda association is `aws_connect_lambda_function_association.connect`**,
  not `.stub`: it associates the real deployed function with the instance,
  and the old address read as a placeholder. It pairs with
  `aws_lambda_permission.connect`; the address maps bind `lambda:<name>` to it.
- **The instances and the state bucket are code** (`envs/bootstrap`), not
  owner setup by hand, so a clone can reproduce them. One bucket, in
  `us-east-1`, holds every root's state, so the state Region is no longer the
  instance's: `deploy.yml` takes a `TF_STATE_REGION` variable and passes it,
  with `use_lockfile=true`, to every `-backend-config` and to
  `TF_VAR_seasonal_state`. The bootstrap root's own state starts local and is
  migrated into the bucket it creates.
- **The Compares are generic blocks for now.** Connect refused every typed
  Compare the first dev apply sent, because flow-as-code 0.2.0 writes no
  `Transitions.NextAction` for it (VERIFY C1). `check-moved` in
  `generators/flows.ts` and `check-caller` and `check-grade` in
  `hh-hotline-main` are GenericBlock Compares whose `next` is their
  NoMatchingCondition target. The fix belongs upstream in flow-as-code and is
  not yet released; remove the workaround after upgrading to the release
  whose changelog records that Compare writes NextAction.
