# T2: full moon

Tier 2. The hotline grows the parts a real dispatch line has: holds, a
polite prank screen, work orders, callbacks, an A/B test on the hold
experience, and the Queue of the Dead. It brings the showcase from 24 to 31
of the 35 action types flow-as-code 0.2.1 models, adds the CUSTOMER_HOLD and
AGENT_HOLD flow types and the `prompt` reference type, and lands in all three
environments in both repositories.

Planned 2026-10-04. Nothing below is built yet; the plan is the design in
the 2026-10-04 research (Tier 2 placement, resources, ordering), checked
against the code at `db7f02a`, and amended 2026-10-05 on review (the
callback carve-out, the closed hours, the key-use test, awscc's provider
block, the hold flows and hooks, the module alias, the VERIFY status shape,
the generic-block policy, the C11 gate).

## Scope

The seven modeled action types this tier adds, each with its one home:

| Action type                    | Flow                                                                     | Block and story                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UpdateContactRecordingBehavior | `hh-dead-line`                                                           | `dead-welcome` (MessageParticipant) first, then `record-agent-only` with RecordedParticipants `["Agent"]` and no error branch (rule 37). The Queue of the Dead records only the living liaison. `["Agent"]` still enables recording, so recording-consent applies and the welcome must come first (VERIFY 16.4).                                                                                  |
| UpdateContactRoutingBehavior   | `hh-dead-line`                                                           | `set-patience`, QueueTimeAdjustmentSeconds `"-300"`, static, never with QueuePriority, before `set-dead-queue` and `transfer-to-dead`. "You have waited this long; the living go first tonight." (VERIFY 16.5)                                                                                                                                                                                    |
| UpdateContactCallbackNumber    | `hh-dead-line`, `module:hh-offer-callback`, `hh-queue-experience-<slug>` | The number is `$.CustomerEndpoint.Address`, never static. CallbackNumberNotDialable and InvalidCallbackNumber are both wired. In the dead line both say "We cannot ring you back where you are, so stay on the line" and rejoin (VERIFY 6.2).                                                                                                                                                     |
| CreateCallbackContact          | `module:hh-offer-callback`, inline in `hh-queue-experience-<slug>`       | Always `queue:dispatch-overflow` (tier decision 6 in [README.md](README.md)), static delays and attempts. Offered at `after-hours` and at the new `overflow-full`, never at `lines-busy`, which is reached only when dispatch-overflow is itself full (16.2: a callback into a full queue takes the error branch). Copy: "a crew will call when the night shift starts" (VERIFY 16.2, 16.12, Q2). |
| UntagContact                   | `hh-hotline-main`, the prank screen                                      | `untag-screen` clears `screen` when a flagged caller presses 1 to say it is really happening. A wrong guess leaves no mark.                                                                                                                                                                                                                                                                       |
| UpdateContactData              | `hh-hotline-main`                                                        | `open-work-order` after `record-grade`, before `share-advice`. Name static ("Hollow Hour work order"), Description `$.Attributes.advice`, catch-all wired. Every call becomes a work order the crew can find in contact search (VERIFY D1).                                                                                                                                                       |
| DistributeByPercentage         | `hh-queue-experience-<slug>` (generated)                                 | `pick-hold-variant` after `check-moved` NoMatch, 50/50. Each side sets `holdVariant` and tags it; `hold` then plays the spoken tips or `prompt:salt-line-tips`. A real A/B test, readable in contact search by tag (VERIFY DP1).                                                                                                                                                                  |

New flows, all in the emitted set:

- **hh-dead-line** (CONTACT_FLOW): reached from `hh-hotline-main` when
  `lambda:plane-check` says `plane` is `beyond`. Welcome, record-agent-only,
  the four event hooks (AgentWhisper, CustomerHold, CustomerQueue, AgentHold,
  one block each, VERIFY 16.3), set-patience, the callback-number check, a
  CheckHoursOfOperation on `hours:the-dead` (the manifest's own note: the
  dead never close; both branches continue, and it keeps the key used by a
  flow for criterion 4's key test), then TransferContactToQueue to
  `queue:the-dead` with QueueAtCapacity wired.
- **hh-dead-whisper** (AGENT_WHISPER): "Spectral liaison call. Be patient;
  they have waited a long time."
- **hh-dead-hold** (CUSTOMER_HOLD): one MessageParticipantIteratively ("Hold
  music is wasted on you, we know. Back shortly."), no interrupt, no
  `NextAction`, and nothing else: MessageParticipant and every terminal type
  are illegal in hold flows (`FLOW_TYPE_RESTRICTIONS`; actions.md rule 38),
  and a holding action with no next ends the flow (`terminal-blocks`).
- **hh-dead-queue-experience** (CUSTOMER_QUEUE): a Loop and
  MessageParticipantIteratively; no dequeue.
- **hh-customer-hold** (CUSTOMER_HOLD): one MessageParticipantIteratively,
  "You are on hold with the $.Attributes.districtName crew. Keep the lights
  on.", and nothing else, as above.
- **hh-agent-hold** (AGENT_HOLD): one MessageParticipantIteratively, "Caller
  on hold. Grade $.Attributes.gradeName.", and nothing else. Hooked
  wherever the whisper hooks are set: the generated district flow, the dead
  line, the Lantern Crew chain in `hh-hotline-main` and the dispatch
  fallback (`dispatchBlocks`), so no path an agent can hold on gets
  Connect's default hold (decided 2026-10-05).
- **hh-offer-callback** (MODULE): `set-callback-number`, `create-callback`
  on `queue:dispatch-overflow`, EndFlowModuleExecution; `create-callback`'s
  NoMatchingError has its own copy ("We cannot take a callback right now;
  please call back in a few minutes") and ends the module. Invoked from the
  generated `hh-district-<slug>` at `after-hours` ("press 1 for a callback
  when the night shift starts, 2 to end") and at `overflow-full`, the new
  QueueAtCapacity target of `transfer-to-overflow` (the sibling crew queue
  is full; dispatch-overflow is not known to be). `lines-busy`, the
  QueueAtCapacity target of `transfer-to-dispatch`, keeps its plain "call
  back in a few minutes": it is reached exactly when dispatch-overflow is
  full, where 16.2 says the create errors. Bound as `module:hh-offer-callback`,
  unaliased: an in-set module is deployed by the same apply as the flows
  that invoke it, so a version and alias (what the out-of-set greetings
  need, VERIFY 7, 7b) would add a release resource per environment and pin
  nothing; the emitter binds an unaliased in-set key to the module
  resource's ARN (`bindingsFor` in `@flow-as-code/hcl`). Two existing
  tests change in PR 6: `flows/` may hold `kind: module` beside `flow`, and
  the out-of-set module list stays `["module:greeting@live"]` while in-set
  modules are checked separately.
- **hh-collect-address** (MODULE), gated: GetParticipantInput with
  `StoreInput "True"` and CustomValidation MaximumLength 5, then
  `lambda:district-for-address`, then UpdateContactAttributes `district` and
  `districtName`. Invoked by `hh-hotline-main` only when `caller-lookup`
  returned no `homeDistrict` (a new caller), between the classifier's
  result and `to-district-menu`; a known caller such as Mrs. Alder still
  hears the keypad menu, so S2 and README Scene 1 are unchanged. The
  generated `hh-district-menu` gains a leading Compare on
  `$.Attributes.district`, one branch per slug to `route-<slug>`, NoMatch to
  `ask-district`. **Waits on flow-as-code C11 being released**, the release
  that carries C04 (Phase C has no per-task release; C11 is gated on C01 to
  C09 and C12 to C15, including the satellite's public tag for C09): the
  typed builder cannot write `StoreInput "True"` in 0.2.1 (`blocks.js`
  writes `"False"` unconditionally and codegen inverts only that). The
  policy that holds the gate is a test added in PR 1: no action in `flows/`
  or `seasonal/` is a `GenericBlock` in its companion for a type the
  catalog models (`ALLOWED_GENERIC` in `tests/coverage.test.ts` governs
  unmodeled types only and would pass a generic GetParticipantInput). PR 8
  is expected to slip to T3 unless C11 ships before the season; when it
  does, this file records the move under Deviations.

Changes to existing flows:

- **hh-hotline-main**:
  - after `ask-anyone-hurt` and before `start-interview`: `plane-check`
    (InvokeLambdaFunction, JSON validation) and a Compare on `plane`; `beyond`
    goes to TransferToFlow `flow:hh-dead-line`. The safety question is never
    skipped. Numbers 555-0190 to 555-0199 are the departed
    (`lambdas/README.md`).
  - the Lantern Crew chain: `set-lantern-customer-hold` and
    `set-lantern-agent-hold` beside the two whisper hooks, and the same
    pair in `dispatchBlocks` (`set-dispatch-*-hold`); the test that holds
    both chains to exactly two hooks moves to four.
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
    hooks; the callback offer at `after-hours` and at `overflow-full`, a
    new MessageParticipant that replaces `lines-busy` as
    `transfer-to-overflow`'s QueueAtCapacity target; `lines-busy` itself
    is unchanged.
  - `queueExperienceFlow`: `pick-hold-variant` and the variant Compare in
    `hold`; after `share-eta`, a Compare on `$.External.etaBand` == `later`
    goes to `offer-callback-inline` (GetParticipantInput), then
    `set-callback-number`, `create-callback` on `queue:dispatch-overflow`, a
    confirmation, and DisconnectParticipant (not EndFlowExecution, so nobody
    is both queued and holding a callback). Errors go back to `hold`.
- **refs/manifest.json**: `usedBy` updated for every Tier 2 key that gains a
  user, then `npm run generate`. `tests/flows.test.ts` "uses exactly the
  manifest's Tier 1 keys" becomes: every key a flow uses is tier 1 or 2, and
  every tier 1 or 2 key is used by a flow or named by a scenario as a
  substitute, except keys in a dated `UNUSED_UNTIL` list that names the gate
  (`module:hh-collect-address` and `lambda:district-for-address` until PR 8;
  the Lambda stays deployed, since `envSupporting.test.ts` deploys exactly
  the manifest's `lambda:` keys and moving it to tier 3 would destroy it).
  `hours:the-dead` is used by the dead line; `hours:closed` (below) only by
  S4's substitution.
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
  (`scripts/lock-providers.mjs`), not the seasonal roots. awscc's provider
  block has no `default_tags`, `skip_credentials_validation` or
  `skip_requesting_account_id` (its arguments are the credentials,
  `region`, `profile`, `role_arn`, `assume_role`, `endpoints`,
  `max_retries`, `insecure`, `skip_metadata_api_check` and `user_agent`),
  so the prompt carries the module's two tags itself, as `tags`, a set of
  `{key, value}` objects, not a map; a test holds the prompt's tags equal
  to the aws `default_tags`. The map key `prompt:salt-line-tips` already
  exists in every profile, bound to
  `awscc_connect_prompt.salt_line_tips.prompt_arn` with no resource behind
  it, so the first flow to use it lands in the same PR as the resource and
  the provider in every root (PR 7), never split. The awscc package is
  hundreds of megabytes, downloaded by `npm run validate` in CI, by
  `tests/validate.test.ts` locally and by `lock-providers.mjs` for four
  platforms per root, so PR 7 caches the plugin directory in CI
  (`actions/cache` keyed on the lock files, pinned to a commit SHA like
  every other action) and `envs/README.md` notes the size.
- `aws_connect_hours_of_operation.closed`, manifest key `hours:closed`
  (tier 2, address-map, bound in every profile): the hours S4 substitutes
  for Old Town's, because no closed hours exist today (`always_open` and
  `night_shift` only, and `hours:the-dead` is always open). The provider's
  resource requires at least one `config` block, so `closed` is open for
  one minute a week (Sunday 03:00 to 03:01 America/New_York) and S4 is
  never run in that minute; the alternative, an empty config through awscc
  (the API allows zero items), is taken only if the one-minute form is
  refused. VERIFY HC1 below. Fallback if neither is accepted: S4 runs
  against `night_shift` between 06:00 and 16:00 America/New_York, recorded
  with its UTC time.
- Recording storage: `aws connect list-instance-storage-configs
--resource-type CALL_RECORDINGS` on each instance. If an instance has none,
  T1's recording block and this tier's stores nothing, and an
  `aws_connect_instance_storage_config` with its bucket goes into
  `envs/bootstrap` (tier decision 5: S3 with SSE-S3, no customer KMS key, a
  lifecycle rule that expires recordings; three buckets here and three in
  the Terraform-first repository, beside the three prompt buckets each).
  The result is recorded with its date either way.
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
     never a crew queue, and none is reachable from `lines-busy`;
   - each hold flow is one MessageParticipantIteratively and nothing else;
   - the whisper and hold hooks travel together: wherever a CustomerWhisper
     hook is set, CustomerHold and AgentHold are set in the same chain;
   - no action in `flows/` or `seasonal/` is a `GenericBlock` for a type the
     catalog models (PR 1);
   - the key-use rule above (tiers 1 and 2, scenario substitutes, the dated
     `UNUSED_UNTIL` list);
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
   - **S4**, the after-hours callback: Old Town's hours substituted with
     `hours:closed`, the callback offer, the callback number. Simulated up
     to CreateCallbackContact; whether EndTest before it keeps a real
     callback from being created, and how to cancel one that leaks, is
     VERIFY CB1. A leaked callback holds a slot of dispatch-overflow's cap
     of 2 in dev and qa until it expires (up to 7 days) or is stopped, and
     two of them fill the queue and change where every dispatch caller
     routes, so the operator step after every S4 run is `SearchContacts`
     for callback contacts in dispatch-overflow and `StopContact` on each,
     recorded in `scenarios/README.md`.
   - **S5**, a departed caller (555-0193): `plane-check`, the dead line,
     either callback-number branch, transfer to `queue:the-dead`.
   - Not simulatable, documented in `scenarios/README.md`: the hold flows
     (they need an agent placing a voice hold), which A/B branch a run takes,
     and S6 (metrics).
9. VERIFY rows D1, DP1, P1, CB1, HC1 and E1 are added with an AWS
   documentation URL and checked. `tests/verify.test.ts`'s `STATUS` accepts
   only `docs-checked 2026-09-30`, `needs sandbox` and `sandbox-checked
<date>, <region>: <result>` today; PR 1 widens it to `docs-checked
YYYY-MM-DD` and adds `harness-checked YYYY-MM-DD: <result>` for a result
   a harness run settles (E1), with the test's own positive and negative
   cases, so a row settled from documentation or a harness in 2026-10 can
   be recorded.
10. README: "Scene 2: the Queue of the Dead", and the tier table updated.

## Where the criteria stand (2026-10-05)

- [ ] 4, in part: the generic-block policy test (PR 1, `tests/flows.test.ts`,
      "generic blocks"): every companion in `flows/` and `seasonal/` writes
      no `GenericBlock` for a type the catalog models, with the mutation case
      a GetParticipantInput carrying `StoreInput "True"`, which 0.2.1's
      codegen can only write generically.
- [ ] 8, in part: S1 (`scenarios/s1-safety-path.scenario.json`), checked
      offline by `tests/envScenarios.test.ts`; not yet run live.
- [ ] 9, in part: `tests/verify.test.ts` accepts `docs-checked YYYY-MM-DD`
      and `harness-checked YYYY-MM-DD: <result>` beside the two earlier
      shapes, each with positive and negative cases (PR 1). No row added yet.
- [ ] 1 to 3, 5 to 7, 10: not started.

## VERIFY rows this tier adds

Each row lands in `VERIFY.md` with the PR that first depends on it, status
`needs sandbox` until a create or run on dev answers it.

| #   | Question                                                                                                                                                                                                                                                                         | How it is answered                                                                                                                                                                                                                                                                                                     | Doc                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Does UpdateContactData accept a JSONPath (`$.Attributes.advice`) for Description, and does the description show in contact search?                                                                                                                                               | A throwaway CONTACT_FLOW create on dev, then one S2-style run and `DescribeContact` on its contact.                                                                                                                                                                                                                    | https://docs.aws.amazon.com/connect/latest/devguide/contact-actions-updatecontactdata.html                                                                                |
| DP1 | Does a CUSTOMER_QUEUE flow accept DistributeByPercentage? Rule 37 probed it only in a contact flow.                                                                                                                                                                              | A throwaway CUSTOMER_QUEUE create on dev with the 50/50 block, then deleted.                                                                                                                                                                                                                                           | https://docs.aws.amazon.com/connect/latest/devguide/flow-control-actions-distributebypercentage.html                                                                      |
| P1  | Creating a prompt from S3: which principal reads the object (the caller, or Connect), what bucket policy that needs, and which audio format the service accepts.                                                                                                                 | `awscc_connect_prompt` applied on dev from a private bucket, then `DescribePrompt`; a refusal is recorded verbatim.                                                                                                                                                                                                    | https://docs.aws.amazon.com/connect/latest/APIReference/API_CreatePrompt.html, https://docs.aws.amazon.com/connect/latest/adminguide/prompts.html                         |
| CB1 | Does a simulated contact that ends with EndTest before CreateCallbackContact create no callback? If one is created, how is it stopped, and does it carry the original contact's attributes (which T3's outbound whisper reads)?                                                  | S4 on dev, then `SearchContacts` for a callback contact in dispatch-overflow; `StopContact` on any found.                                                                                                                                                                                                              | https://docs.aws.amazon.com/connect/latest/devguide/interactions-createcallbackcontact.html, https://docs.aws.amazon.com/connect/latest/APIReference/API_StopContact.html |
| HC1 | Is an hours of operation with a single one-minute `config` accepted, and does CheckHoursOfOperation read it as closed outside that minute? If refused, is a zero-config hours (the API's minimum is 0 items) accepted through awscc and read as closed?                          | Apply `aws_connect_hours_of_operation.closed` on dev, `DescribeHoursOfOperation`, then S4 with the substitution.                                                                                                                                                                                                       | https://docs.aws.amazon.com/connect/latest/APIReference/API_CreateHoursOfOperation.html, https://docs.aws.amazon.com/connect/latest/adminguide/set-hours-operation.html   |
| E1  | Does `tofu plan` of a new `awscc_connect_prompt` make a Cloud Control call when the awscc provider block carries placeholder `access_key` and `secret_key`, `region` and `skip_metadata_api_check` (awscc has no `skip_credentials_validation` or `skip_requesting_account_id`)? | `node tools/equivalence/check.mjs` in that repository with the prompt added and the awscc provider declared in its harness. If plan needs credentials, the harness gets an override that stands in for the awscc resources, and the row records which. Recorded in that repository's `VERIFY.md` as `harness-checked`. | https://registry.terraform.io/providers/hashicorp/awscc/latest/docs, https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/what-is-cloudcontrolapi.html            |

## Pull requests, in order

Small PRs. Each lands its tests, its VERIFY row, and its deploy-role
additions; each is followed by its Terraform-first mirror and a snapshot
bump before the next starts, so the equivalence check never trails by more
than one change.

1. **S1** only: the safety-path scenario, the `STATUS` widening in
   `tests/verify.test.ts`, and the generic-block policy test. No flow
   change.
2. **Holds**: `hh-customer-hold`, `hh-agent-hold`, the generator's two hook
   blocks, and the same pair in the hotline's Lantern Crew chain and in
   `dispatchBlocks` (the two-hook test moves to four). No new resources.
3. **The Queue of the Dead**: `plane-check` in the hotline, `hh-dead-line`
   (with its hours check) and its whisper, hold and queue flows;
   `hours:closed` and HC1 (S4 needs it in PR 6); S5. The recording-storage
   check runs here, because this PR adds the second recording block.
4. **Prank screen**; S3.
5. **Work order** (UpdateContactData); D1.
6. **Callbacks**: `hh-offer-callback` (unaliased in-set module; the two
   tests above change here), `overflow-full`, the district offer and the
   inline queue-flow callback; the key-use test with its `UNUSED_UNTIL`
   list; S4 with its sweep step; CB1.
7. **awscc, the prompt and the A/B split**: the bucket, object, explicitly
   tagged prompt and the CI plugin cache per environment,
   `pick-hold-variant`; P1, DP1, and E1 answered in the mirror before it
   merges.
8. **hh-collect-address**, only once flow-as-code C11 (carrying C04) is on
   npm and the pins move to that release; otherwise it moves to T3.
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
  `environments/*/providers.tf` configures it with `region` only (awscc has
  no `default_tags`), and `awscc_connect_prompt` carries the module's two
  tags as a set of `{key, value}` objects. `tests/versions.tf` and
  `tools/equivalence/harness/main.tf` declare awscc too, since
  `mock_provider` and the harness need it declared. The CI plugin cache
  mirrors PR 7's: the fmt-validate matrix inits five roots per OpenTofu
  version, and `tofu test` and the harness init again.
- **Tests** (`tests/flows.tftest.hcl`): a `mock_provider "awscc"` with a
  `prompt_arn` default, and runs `dead_line`, `holds`, `prank_screen`,
  `callbacks` and `hold_ab` asserting the same invariants as criterion 4.
  `tests/environments.tftest.hcl` still shows the profiles differ only in
  hours and greeting.
- **Equivalence** (`tools/equivalence`): re-vendor `snapshot/` (the new
  FlowDocs and tfmaps) at each TS merge commit and record it in
  `snapshot/SOURCE.md`; `check.mjs`'s `REWRITES` learns
  `awscc_connect_prompt.X.prompt_arn` to `.name`, `expectedBindings` the
  same address, and both learn the unaliased in-set module form
  (`flowascode_contact_flow_module.X.arn` to `.name`), which today's rules
  (the greeting alias and `flowascode_contact_flow.X.arn`) do not cover.
- **Risk E1**: the harness plans aws and flowascode with placeholder
  credentials and their `skip_` flags; awscc has no such flags, goes
  through Cloud Control and may not plan offline. PR 7's mirror answers E1
  (as rewritten above) before it merges; the fallback is an override in
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
- Checked 2026-10-05 against the code at `4fc7267` with
  `@flow-as-code/core` 0.2.1: the showcase uses 24 of 35 modeled types, the
  seven above are exactly the eleven missing minus T3's four,
  CreateCallbackContact and UpdateContactCallbackNumber are catalog-legal
  in MODULE flows, and every Tier 2 address-map key already sits in all four
  tfmaps with its resource except `prompt:salt-line-tips` (PR 7, above).

## Deviations

None yet.
