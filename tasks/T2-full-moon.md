# T2: full moon

Tier 2. The hotline grows the parts a real dispatch line has: holds, a
polite prank screen, work orders, callbacks, an A/B test on the hold
experience, and the Queue of the Dead. It brings the showcase from 24 to 31
of the 35 action types flow-as-code 0.2.1 models, adds the CUSTOMER_HOLD and
AGENT_HOLD flow types and the `prompt` reference type, and lands in all three
environments in both repositories.

Planned 2026-10-04. Nothing below is built yet; the plan is the design in
the 2026-10-04 research (Tier 2 placement, resources, ordering), checked
against the code at `db7f02a`.

## Scope

The seven modeled action types this tier adds, each with its one home:

| Action type                    | Flow                                                                     | Block and story                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UpdateContactRecordingBehavior | `hh-dead-line`                                                           | `dead-welcome` (MessageParticipant) first, then `record-agent-only` with RecordedParticipants `["Agent"]` and no error branch (rule 37). The Queue of the Dead records only the living liaison. `["Agent"]` still enables recording, so recording-consent applies and the welcome must come first (VERIFY 16.4). |
| UpdateContactRoutingBehavior   | `hh-dead-line`                                                           | `set-patience`, QueueTimeAdjustmentSeconds `"-300"`, static, never with QueuePriority, before `set-dead-queue` and `transfer-to-dead`. "You have waited this long; the living go first tonight." (VERIFY 16.5)                                                                                                   |
| UpdateContactCallbackNumber    | `hh-dead-line`, `module:hh-offer-callback`, `hh-queue-experience-<slug>` | The number is `$.CustomerEndpoint.Address`, never static. CallbackNumberNotDialable and InvalidCallbackNumber are both wired. In the dead line both say "We cannot ring you back where you are, so stay on the line" and rejoin (VERIFY 6.2).                                                                    |
| CreateCallbackContact          | `module:hh-offer-callback`, inline in `hh-queue-experience-<slug>`       | Always `queue:dispatch-overflow` (tier decision 6 in [README.md](README.md)), static delays and attempts. Copy: "a crew will call when the night shift starts" (VERIFY 16.2, 16.12, Q2).                                                                                                                         |
| UntagContact                   | `hh-hotline-main`, the prank screen                                      | `untag-screen` clears `screen` when a flagged caller presses 1 to say it is really happening. A wrong guess leaves no mark.                                                                                                                                                                                      |
| UpdateContactData              | `hh-hotline-main`                                                        | `open-work-order` after `record-grade`, before `share-advice`. Name static ("Hollow Hour work order"), Description `$.Attributes.advice`, catch-all wired. Every call becomes a work order the crew can find in contact search (VERIFY D1).                                                                      |
| DistributeByPercentage         | `hh-queue-experience-<slug>` (generated)                                 | `pick-hold-variant` after `check-moved` NoMatch, 50/50. Each side sets `holdVariant` and tags it; `hold` then plays the spoken tips or `prompt:salt-line-tips`. A real A/B test, readable in contact search by tag (VERIFY DP1).                                                                                 |

New flows, all in the emitted set:

- **hh-dead-line** (CONTACT_FLOW): reached from `hh-hotline-main` when
  `lambda:plane-check` says `plane` is `beyond`. Welcome, record-agent-only,
  the four event hooks (AgentWhisper, CustomerHold, CustomerQueue, AgentHold,
  one block each, VERIFY 16.3), set-patience, the callback-number check,
  then TransferContactToQueue to `queue:the-dead` with QueueAtCapacity wired.
- **hh-dead-whisper** (AGENT_WHISPER): "Spectral liaison call. Be patient;
  they have waited a long time."
- **hh-dead-hold** (CUSTOMER_HOLD): "Hold music is wasted on you, we know.
  Back shortly."
- **hh-dead-queue-experience** (CUSTOMER_QUEUE): a Loop and
  MessageParticipantIteratively; no dequeue.
- **hh-customer-hold** (CUSTOMER_HOLD): MessageParticipantIteratively, "You
  are on hold with the $.Attributes.districtName crew. Keep the lights on."
- **hh-agent-hold** (AGENT_HOLD): "Caller on hold. Grade
  $.Attributes.gradeName." Hooked by every district flow and by the dead
  line.
- **hh-offer-callback** (MODULE): `set-callback-number`, `create-callback`
  on `queue:dispatch-overflow`, EndFlowModuleExecution. Invoked from the
  generated `hh-district-<slug>` at `after-hours` ("press 1 for a callback
  when the night shift starts, 2 to end") and at `lines-busy`.
- **hh-collect-address** (MODULE), gated: GetParticipantInput with
  `StoreInput "True"` and CustomValidation MaximumLength 5, then
  `lambda:district-for-address`, then UpdateContactAttributes `district` and
  `districtName`. The generated `hh-district-menu` gains a leading Compare
  on `$.Attributes.district`, one branch per slug to `route-<slug>`, NoMatch
  to `ask-district`. **Waits on flow-as-code C04 being released**: the
  typed builder cannot write `StoreInput "True"` in 0.2.1, and a generic
  block here would need an `ALLOWED_GENERIC` reason for a modeled type. If
  C04 is not on npm when PR 8 is reached, the module moves to T3 and this
  file records the move under Deviations.

Changes to existing flows:

- **hh-hotline-main**:
  - after `ask-anyone-hurt` and before `start-interview`: `plane-check`
    (InvokeLambdaFunction, JSON validation) and a Compare on `plane`; `beyond`
    goes to TransferToFlow `flow:hh-dead-line`. The safety question is never
    skipped. Numbers 555-0190 to 555-0199 are the departed
    (`lambdas/README.md`).
  - the prank screen, after `ask-multiple` and before `classify`:
    `check-injured-first` (an injured caller skips the screen; safety first),
    `prank-score` (InvokeLambdaFunction, JSON, with the answers and
    `callerNumber`), a Compare on `verdict` == `high`, `tag-screen` (TagContact
    `screen=prank-suspected`), then `kind-check`: "Some calls are dares, and
    that is all right. If this is really happening, press 1." Pressing 1 runs
    `untag-screen`, then `classify`. A timeout or 2 plays "Thanks for keeping
    us on our toes. Call back any time something goes bump" and hangs up.
    Theo (555-0166) is the known dare.
  - `open-work-order` as in the table.
- **generators/flows.ts**:
  - `districtFlow`: `set-customer-hold` and `set-agent-hold`
    (UpdateContactEventHooks, one hook per block, VERIFY 16.3) beside the T1
    hooks; the callback offer at `after-hours` and `lines-busy`.
  - `queueExperienceFlow`: `pick-hold-variant` and the variant Compare in
    `hold`; after `share-eta`, a Compare on `$.External.etaBand` == `later`
    goes to `offer-callback-inline` (GetParticipantInput), then
    `set-callback-number`, `create-callback` on `queue:dispatch-overflow`, a
    confirmation, and DisconnectParticipant (not EndFlowExecution, so nobody
    is both queued and holding a callback). Errors go back to `hold`.
- **refs/manifest.json**: `usedBy` updated for every Tier 2 key that gains a
  user, then `npm run generate`.
- **scripts/drift.mjs**: `CONNECT_TYPES` maps `agent` to `queue` (the flows
  type an agent queue as `queue:`, VERIFY 16.11), so T3's agent queue is not
  reported as false drift. It lands here because it is a one-line fix with a
  test, and T3 depends on it.

Supporting resources, per environment (`envs/{dev,qa,prod}/supporting.tf`):

- `aws_s3_bucket` `hh-<env>-prompts` (private, SSE, public access blocked),
  `aws_s3_object` from the committed `prompts/salt-line-tips.wav`, and
  `awscc_connect_prompt.salt_line_tips` (`s3_uri`). The audio is generated
  once from `prompts/salt-line-tips.txt` (tier decision 4) and the text file
  is the copy source `tests/copy.test.ts` scans.
- `hashicorp/awscc` in every flow root's `providers.tf` and lockfile
  (`scripts/lock-providers.mjs`). The map key `prompt:salt-line-tips` already
  exists.
- Recording storage: `aws connect list-instance-storage-configs
--resource-type CALL_RECORDINGS` on each instance. If an instance has none,
  T1's recording block and this tier's stores nothing, and an
  `aws_connect_instance_storage_config` with its bucket goes into
  `envs/bootstrap` (tier decision 5). The result is recorded with its date
  either way.
- The deploy role table in `envs/README.md` gains: s3 bucket and object
  actions on `hh-<env>-prompts`; `connect:CreatePrompt`, `DescribePrompt`,
  `UpdatePrompt`, `DeletePrompt`; and the Cloud Control actions awscc calls
  (`cloudformation:CreateResource`, `GetResource`, `UpdateResource`,
  `DeleteResource`, `GetResourceRequestStatus`, `ListResources`).

## Acceptance criteria

1. `npm run lint:flows` reports no findings. In the Terraform-first
   repository, `tofu test` and `node tools/equivalence/check.mjs` are green on
   a snapshot re-vendored from this tier's last merge.
2. Round trip and `npm run generate:check` are byte-stable. Adding one
   district to `districts.config.json` still yields exactly its two
   generated flows plus one menu key (and, once `hh-collect-address` lands,
   one menu Compare branch), with no hand edit to a flow or a test.
3. `tests/coverage.test.ts` gains a per-tier floor and **fails** unless the
   flows use CreateCallbackContact, DistributeByPercentage, UntagContact,
   UpdateContactCallbackNumber, UpdateContactData,
   UpdateContactRecordingBehavior and UpdateContactRoutingBehavior (31 of
   35), the flow types include CUSTOMER_HOLD and AGENT_HOLD, and the `prompt`
   reference type is used (6 of 8). `ALLOWED_GENERIC` stays empty. Each new
   check has a mutation case, a copy of the flow set with the thing removed,
   that shows the check fails.
4. `tests/flows.test.ts`, each with a mutation case:
   - in `hh-dead-line` the welcome precedes the recording block, which
     records `["Agent"]` and has no error branch;
   - the routing adjustment is negative, static, and set before the
     transfer;
   - all four hooks are present, one per block, and none points back at the
     flow that sets it;
   - both callback-number errors are wired wherever the number is set;
   - every CreateCallbackContact names `queue:dispatch-overflow` explicitly,
     never a crew queue;
   - the queue flow's callback path ends in DisconnectParticipant;
   - no path from a yes to "Is anyone hurt?" reaches `prank-score`;
   - every path through a TagContact `screen` either untags it or ends the
     call;
   - every DistributeByPercentage sums to 100;
   - no Wait in any flow;
   - the district-name walk of T1 covers the dead line and the callback
     paths.
5. Copy (`tests/copy.test.ts`): banned terms, the 555-0100 to 555-0199
   range and the emergency line hold over the new flows and
   `prompts/salt-line-tips.txt`. The prank path ends with a kind sentence,
   never an accusation.
6. Environment invariants are unchanged: qa and prod emit identical trees,
   dev differs only in hours, prod-october only in hours and greeting. The
   new keys bind identically in every profile.
7. Live: dev, qa and prod applied in both repositories (saved plan, then
   apply). A fresh plan of every root shows "No changes". `npm run drift`
   reports "No drift." on all three. This repository is in us-east-1 and
   the Terraform-first one in us-west-2; each run is recorded with its UTC
   time.
8. Scenarios, checked offline by `tests/envScenarios.test.ts` and run live
   on dev and prod (qa when its concurrent-calls quota is raised, as in T1):
   - **S1**, the safety path: press 1 for hurt, hear the advice, press 1 to
     end, disconnect.
   - **S3**, Theo's dare: `prank-score` returns high, the caller presses 1,
     the tag is cleared, and `classify` runs.
   - **S4**, the after-hours callback: Old Town's hours substituted closed,
     the callback offer, the callback number. Simulated up to
     CreateCallbackContact; whether EndTest before it keeps a real callback
     from being created, and how to cancel one that leaks, is VERIFY CB1. A
     leaked callback holds a slot of dispatch-overflow's cap of 2 in dev and
     qa until it expires or is stopped.
   - **S5**, a departed caller (555-0193): `plane-check`, the dead line,
     either callback-number branch, transfer to `queue:the-dead`.
   - Not simulatable, documented in `scenarios/README.md`: the hold flows
     (they need an agent placing a voice hold), which A/B branch a run takes,
     and S6 (metrics).
9. VERIFY rows D1, DP1, P1, CB1 and E1 are added with an AWS documentation
   URL and checked: each sandbox row carries
   `sandbox-checked <date>, <region>: <result>`.
10. README: "Scene 2: the Queue of the Dead", and the tier table updated.

## Where the criteria stand (2026-10-04)

- [ ] 1 to 10: not started. The plan merged on its own PR; no flow, test or
      resource for this tier exists yet.

## VERIFY rows this tier adds

Each row lands in `VERIFY.md` with the PR that first depends on it, status
`needs sandbox` until a create or run on dev answers it.

| #   | Question                                                                                                                                                                                                                        | How it is answered                                                                                                                                                                                                                                             | Doc                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Does UpdateContactData accept a JSONPath (`$.Attributes.advice`) for Description, and does the description show in contact search?                                                                                              | A throwaway CONTACT_FLOW create on dev, then one S2-style run and `DescribeContact` on its contact.                                                                                                                                                            | https://docs.aws.amazon.com/connect/latest/devguide/contact-actions-updatecontactdata.html                                                                                |
| DP1 | Does a CUSTOMER_QUEUE flow accept DistributeByPercentage? Rule 37 probed it only in a contact flow.                                                                                                                             | A throwaway CUSTOMER_QUEUE create on dev with the 50/50 block, then deleted.                                                                                                                                                                                   | https://docs.aws.amazon.com/connect/latest/devguide/flow-control-actions-distributebypercentage.html                                                                      |
| P1  | Creating a prompt from S3: which principal reads the object (the caller, or Connect), what bucket policy that needs, and which audio format the service accepts.                                                                | `awscc_connect_prompt` applied on dev from a private bucket, then `DescribePrompt`; a refusal is recorded verbatim.                                                                                                                                            | https://docs.aws.amazon.com/connect/latest/APIReference/API_CreatePrompt.html, https://docs.aws.amazon.com/connect/latest/adminguide/prompts.html                         |
| CB1 | Does a simulated contact that ends with EndTest before CreateCallbackContact create no callback? If one is created, how is it stopped, and does it carry the original contact's attributes (which T3's outbound whisper reads)? | S4 on dev, then `SearchContacts` for a callback contact in dispatch-overflow; `StopContact` on any found.                                                                                                                                                      | https://docs.aws.amazon.com/connect/latest/devguide/interactions-createcallbackcontact.html, https://docs.aws.amazon.com/connect/latest/APIReference/API_StopContact.html |
| E1  | Can the Terraform-first equivalence harness plan awscc resources offline with placeholder credentials, as it does for aws?                                                                                                      | `node tools/equivalence/check.mjs` in that repository with the prompt added. If awscc needs credentials at plan, the harness gets an override that replaces the awscc resources, and the row records which. Recorded in that repository's `VERIFY.md` as well. | https://registry.terraform.io/providers/hashicorp/awscc/latest/docs, https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/what-is-cloudcontrolapi.html            |

## Pull requests, in order

Small PRs. Each lands its tests, its VERIFY row, and its deploy-role
additions; each is followed by its Terraform-first mirror and a snapshot
bump before the next starts, so the equivalence check never trails by more
than one change.

1. **S1** only: the safety-path scenario. No flow change.
2. **Holds**: `hh-customer-hold`, `hh-agent-hold`, and the generator's two
   hook blocks. No new resources.
3. **The Queue of the Dead**: `plane-check` in the hotline, `hh-dead-line`
   and its whisper, hold and queue flows; S5. The recording-storage check
   runs here, because this PR adds the second recording block.
4. **Prank screen**; S3.
5. **Work order** (UpdateContactData); D1.
6. **Callbacks**: `hh-offer-callback`, the district offer and the inline
   queue-flow callback; S4; CB1.
7. **awscc, the prompt and the A/B split**: the bucket, object and prompt
   per environment, `pick-hold-variant`; P1, DP1, and E1 answered in the
   mirror before it merges.
8. **hh-collect-address**, only once C04 is on npm and the pins move to
   that release; otherwise it moves to T3.
9. **Close**: live applies in both repositories, re-plans, drift, scenario
   runs, README scene, this file's criteria checked with dates.

## Terraform-first

Each PR above is mirrored in
[hollow-hour-example-terraform](https://github.com/flow-as-code/hollow-hour-example-terraform)
after it merges here. Its `tasks/README.md` points to this section.

- **Module files** (`modules/hollow-hour/`): new single-resource
  `hh-dead-line.flow.tf`, `hh-dead-whisper.flow.tf`, `hh-dead-hold.flow.tf`,
  `hh-dead-queue-experience.flow.tf`, `hh-customer-hold.flow.tf`,
  `hh-agent-hold.flow.tf`, `hh-offer-callback.flow.tf`, and
  `hh-collect-address.flow.tf` when PR 8 lands. Edits to
  `hh-hotline-main.flow.tf`, `hh-district.tf` (two hook actions, the
  callback invoke, refs), `hh-queue-experience.tf` (the A/B split, the
  inline callback, `"prompt:salt-line-tips" =
awscc_connect_prompt.salt_line_tips.prompt_arn`) and `hh-district-menu.tf`.
  New `prompts.tf` (bucket, object, prompt). Single-resource files stay
  readable by `@flow-as-code/hcl` (equivalence check 4).
- **Providers**: `versions.tf` gains `hashicorp/awscc`; each
  `environments/*/providers.tf` configures it for us-west-2 with the same
  default tags.
- **Tests** (`tests/flows.tftest.hcl`): a `mock_provider "awscc"` with a
  `prompt_arn` default, and runs `dead_line`, `holds`, `prank_screen`,
  `callbacks` and `hold_ab` asserting the same invariants as criterion 4.
  `tests/environments.tftest.hcl` still shows the profiles differ only in
  hours and greeting.
- **Equivalence** (`tools/equivalence`): re-vendor `snapshot/` (the new
  FlowDocs and tfmaps) at each TS merge commit and record it in
  `snapshot/SOURCE.md`; extend `expectedBindings` and the refs rewrite in
  `check.mjs` with the `awscc_connect_prompt` name.
- **Risk E1**: the harness plans with placeholder credentials and every
  `skip_` flag. awscc goes through Cloud Control and may not plan offline.
  PR 7's mirror answers E1 before it merges; the fallback is an override in
  `harness/` that stands in for the awscc resources, never skipping the
  binding check for the prompt.
- **Live**: dev, qa and prod in us-west-2, resource names `hh-tf-<env>-*`;
  saved plan, apply, then a fresh plan with "No changes".

## Assumptions

- flow-as-code 0.2.1 types all seven actions, and their catalog entries are
  the evidence-checked ones (rule 37, 2026-09-29). Rule 38 covers
  DistributeByPercentage writing its own NextAction.
- No claimed phone number (tier decision 1): callbacks are created but
  never dialed, and the hold flows never run live. Their evidence is the
  create and the offline tests.
- The stub Lambdas `plane-check`, `prank-score` and `district-for-address`
  are already deployed and associated in every environment (T1) and need no
  change.
- C03 does not affect this tier: no Wait or ShowView is added.

## Deviations

None yet.
