# T3: witching hour

Tier 3, after the season (owner decision 5 of 2026-09-30). The crew becomes
people: Bo of the Lantern Crew gets a login, calls can be handed to him or
to his crew, a returning callback is whispered to the agent, and the hotline
opens a chat field guide. With this tier the showcase uses all 35 action
types flow-as-code 0.2.1 models (34 if Lex stays out), all ten FlowDoc
flow types, and all eight reference types (seven without Lex). It closes
with the drift-and-adopt scene.

Planned 2026-10-04. Nothing below is built yet.

## Gates

- **flow-as-code C03** (channel-restricted actions) decides how a chat-only
  flow lints. Wait and ShowView are chat-only by channel, and C03 adds a
  warning for them; criterion 2 below needs its outcome, so PR 5 waits for
  C03 to be released and the pins to move to that release.
- **Tier decisions** 1 to 3 in [README.md](README.md) (phone number, Lex,
  agent users) are settled before PR 2.
- **Lex** is all three environments or none (the environments differ only in
  bindings: `tests/refs.test.ts`, `tests/envEmit.test.ts`, and the
  Terraform-first `tests/environments.tftest.hcl`). If a dev bot works by
  about 2026-10-15 it may land early as T2.x; otherwise it is PR 7 here, or
  the one listed gap.

## Scope

| Addition                       | Flow or resource                                  | Detail                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TransferContactToAgent         | `hh-transfer-to-bo` (AGENT_TRANSFER, in-set)      | `announce` ("Putting you through to Bo of the Lantern Crew"), then `to-bo`, terminal, `Transitions: {}` (rule 38). Reached by quick connect `bo` (USER). Voice only by the action page; a busy agent disconnects the contact.                                                                                                   |
| AGENT_TRANSFER                 | `hh-transfer-to-bo`                               | As above. A district crew member hands a worsening case to Bo in person.                                                                                                                                                                                                                                                        |
| QUEUE_TRANSFER                 | `hh-escalate-lantern` (in-set)                    | UpdateContactAttributes `district=lantern-crew`, `districtName=Lantern`, the AgentWhisper hook, then TransferContactToQueue with QueueAtCapacity wired. Reached by quick connect `lantern-crew` (QUEUE).                                                                                                                        |
| OUTBOUND_WHISPER               | `hh-callback-whisper` (in-set)                    | "Hollow Hour returning your call about a $.Attributes.gradeName case", then UpdateContactRecordingBehavior `["Agent","Customer"]` (legal here, VERIFY 16.4), then EndFlowExecution. Bound by each queue's `outbound_caller_config.outbound_flow_id`. Fires only when a callback is dialed, which needs an agent and a number.   |
| ShowView                       | `hh-field-guide-chat` (CONTACT_FLOW, chat)        | `show-cards`: `view:field-guide`, InvocationTimeLimitSeconds `"300"`, one condition per card, NoMatchingCondition, NoMatchingError and TimeLimitExceeded wired, inside a `retry` Loop of 2. "What are you seeing? Cold spot, Moving objects, Voices, Something else." (VERIFY 16.9, 5.4)                                        |
| Wait                           | `hh-field-guide-chat`                             | `pause` with TimeLimitSeconds only, the one shape the service accepted (VERIFY 16.1), then TransferContactToQueue to `queue:dispatch-overflow`.                                                                                                                                                                                 |
| `view` reference               | `view:field-guide`                                | `awscc_connect_view.field_guide` (template copied from the AWS-managed Cards view) and `awscc_connect_view_version`, bound as `view:field-guide@<version>`. A managed view's ARN has no instance segment and no resource exposes it; composing one would trip the ARN hygiene test.                                             |
| Users, routing, quick connects | `envs/{dev,qa,prod}/supporting.tf`                | `aws_connect_routing_profile.crew` (VOICE 1, CHAT 2, every crew and shared queue); `data.aws_connect_security_profile` "Agent"; `aws_connect_user.crew["bo"]` (tier decision 3); `aws_connect_quick_connect.bo` (USER) and `.lantern` (QUEUE); `quick_connect_ids` on the crew queues and dispatch-overflow.                    |
| The agent-queue route          | `hh-hotline-main`, before `send-to-lantern-crew`  | CheckMetricData with AgentId `queue:crew-bo`; when Bo is available, `UpdateContactTargetQueue{agent: queue:crew-bo}` then TransferContactToQueue; otherwise the Lantern Crew queue as today. `queue:crew-bo` binds to `aws_connect_user.crew["bo"].arn` (VERIFY 16.11).                                                         |
| ConnectParticipantWithLexBot   | gated; `hh-hotline-main` (voice) or the chat flow | Tier decision 2. Voice: a new key on `ask-can-see` ("press 3 to describe it in your own words") to `lex-interview`, `lex:apparition-id`, conditions `Equals <Intent>` for MovesThings, MakesNoise, Visible, Touching, Many, mapped onto the six interview attributes, then `classify`. Only NoMatchingError is required (16.7). |
| `lex` reference                | `lex:apparition-id`                               | `aws_lexv2models_bot`, `_bot_locale` (en_US), `_slot_type`, five `_intent`s, `_bot_version`, `awscc_lex_bot_alias.apparition_id`, and `awscc_connect_integration_association` (LEX_BOT, the alias ARN). hashicorp/aws has no V2 alias resource and its bot association is V1 only. Identical in every environment.              |

Placement rules this tier keeps:

- `quick_connect_ids` never includes `lantern-crew` on the Lantern Crew
  queue itself: queue, quick connect, flow, queue would be a Terraform
  cycle, and a transfer to the queue you are in is no transfer.
- The chat flow is reached by `aws connect start-chat-contact
--contact-flow-id` (operator) or the console's test chat. No widget, no
  website.
- `refs/manifest.json`: new keys `queue:crew-bo` (address), `view:field-guide`
  (its address set), `lex:apparition-id` moves from `stretch` to `3` if
  gated in, and the in-set `flow:hh-transfer-to-bo`,
  `flow:hh-escalate-lantern`, `flow:hh-callback-whisper`,
  `flow:hh-field-guide-chat`. `tests/refs.test.ts` "keeps the stretch and
  Tier 3 keys out of every map" flips to the opposite.

## Acceptance criteria

1. Coverage: `tests/coverage.test.ts` fails unless 35 of 35 modeled types
   are used, or 34 with ConnectParticipantWithLexBot as the one recorded
   gap citing tier decision 2; all ten FlowDoc flow types are used
   (CONTACT_FLOW, CUSTOMER_QUEUE, CUSTOMER_HOLD, CUSTOMER_WHISPER,
   AGENT_HOLD, AGENT_WHISPER, OUTBOUND_WHISPER, AGENT_TRANSFER,
   QUEUE_TRANSFER, MODULE); all eight reference types are used, or seven
   without Lex. Each floor has a mutation case.
2. `npm run lint:flows` has no findings with C03's outcome applied: either
   the chat flow declares its channel, if C03 settles on a FlowDoc field, or
   a recorded disable of the channel rule that `tests/flows.test.ts`
   restricts to `hh-field-guide-chat` and fails anywhere else.
3. `tests/flows.test.ts`, each with a mutation case:
   - TransferContactToAgent appears only in AGENT_TRANSFER flows and is
     terminal;
   - no quick connect sits on the queue its flow transfers to;
   - ShowView has its three branches and sits inside the Loop cap;
   - Wait appears only in `hh-field-guide-chat`, with TimeLimitSeconds only;
   - the outbound whisper reads contact attributes only, never a literal
     district;
   - the agent-queue route falls back to the Lantern Crew queue on every
     branch but "available".
4. Supporting resources (`tests/envSupporting.test.ts`): Bo's password is
   never in source or in a committed plan; the routing profile carries
   CHAT; user names are `hh-<env>-*` here and `hh-tf-<env>-*` in the
   Terraform-first repository; no `lantern-crew` quick connect on the
   lantern-crew queue.
5. Live apply, a re-plan with "No changes", and `npm run drift` "No drift."
   in all three environments in both repositories. `scripts/drift.mjs`
   handles the agent ARN (mapped in T2) and the view ARN, and its tests
   cover both.
6. Operator runs, recorded in `VERIFY.md` with their UTC times (none can be
   simulated):
   - **S9**: a chat through the field guide with a card chosen; records the
     `ViewResultData` field names (VERIFY 16.9, 5.4).
   - **S10**: Bo, logged in to the CCP, takes a chat from Old Town and
     quick-connects it to himself and then to the Lantern Crew, running the
     AGENT_TRANSFER and QUEUE_TRANSFER flows. Chat carries it because there
     is no number (tier decision 1); TransferContactToAgent is voice only,
     so its own evidence is the create and rule 38, and the run records what
     the chat leg does at that block.
   - **S11** (only if Lex is gated in): a dev run against the real alias, or
     simulate with C10's Lex substitution once that is released.
7. **S12**, the drift-and-adopt scene:
   - an operator builds `hh-spooky-promo` in the dev console;
   - `npm run drift -- dev` (and `flow-cli diff`) reports one unmanaged flow;
   - TypeScript-first: `flow-cli export` writes it, it is adopted into
     `flows/` with its bindings and an `import {}` block in `envs/dev`, and
     the next dev plan shows no changes; qa and prod then create it from the
     same FlowDoc, because environments differ only in bindings;
   - Terraform-first: `flow-cli export --author tf`, an `import {}` block
     (the provider documents import), and a plan with no changes;
   - README "Scene 3".
8. VERIFY rows U1, OW1, V1 and LX1 (below) added and checked.
9. README tier table and scenes updated; `scenarios/README.md` lists S9 to
   S12 as operator runs.

## Where the criteria stand (2026-10-04)

- [ ] 1 to 9: not started. Gated on the season, C03 and tier decisions 1
      to 3.

## VERIFY rows this tier adds

| #   | Question                                                                                                                                                                       | How it is answered                                                                | Doc                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U1  | Are a CONNECT_MANAGED user, a USER quick connect bound to an AGENT_TRANSFER flow, and a QUEUE quick connect bound to a QUEUE_TRANSFER flow accepted, and does the user log in? | Apply on dev, `DescribeUser`, `DescribeQuickConnect`, a CCP login.                | https://docs.aws.amazon.com/connect/latest/APIReference/API_CreateQuickConnect.html, https://docs.aws.amazon.com/connect/latest/devguide/contact-actions-transfercontacttoagent.html |
| OW1 | Is `outbound_caller_config` with only `outbound_flow_id` (no caller-id number) accepted on a queue?                                                                            | Apply on dev, `DescribeQueue`.                                                    | https://docs.aws.amazon.com/connect/latest/APIReference/API_UpdateQueueOutboundCallerConfig.html                                                                                     |
| V1  | Does `awscc_connect_view` with a copy of the Cards template create, and which ARN form does ShowView take (`view/<id>:<version>` or the alias)?                                | Apply on dev, a throwaway CONTACT_FLOW create with the token bound, then S9.      | https://docs.aws.amazon.com/connect/latest/adminguide/show-view-block.html, https://docs.aws.amazon.com/connect/latest/devguide/participant-actions-showview.html                    |
| LX1 | Does ConnectParticipantWithLexBot need `Transitions.NextAction`? Rule 38 never probed it. Only if Lex is gated in.                                                             | Two throwaway creates on dev, with and without NextAction, against the dev alias. | https://docs.aws.amazon.com/connect/latest/devguide/participant-actions-connectparticipantwithlexbot.html                                                                            |

## Pull requests, in order

1. **Decisions and gates**: tier decisions 1 to 3 recorded as settled, C03's
   outcome recorded here, pins moved to the release that carries it.
2. **Users and routing**: routing profile, Bo, `queue:crew-bo`, the
   agent-queue route in the hotline; U1 (the user half).
3. **Transfer flows and quick connects**: `hh-transfer-to-bo`,
   `hh-escalate-lantern`, both quick connects, `quick_connect_ids`; U1;
   S10.
4. **Outbound whisper**: `hh-callback-whisper` and `outbound_caller_config`
   on the queues; OW1.
5. **The chat field guide**: the view, `hh-field-guide-chat`; V1; S9.
6. **Drift and adopt**: S12 and README "Scene 3".
7. **Lex**, if gated in: the bot, alias and association in all three
   environments, `lex-interview`; LX1; S11. If not, the coverage test names
   the gap and tier decision 2.
8. **Close**: live applies, re-plans, drift, README.

The deploy role table in `envs/README.md` grows with each PR:
`connect:CreateUser`, `DescribeUser`, `UpdateUser*`, `DeleteUser`, and the
same for RoutingProfile and QuickConnect; `connect:AssociateQueueQuickConnects`
and `UpdateQueueOutboundCallerConfig`; `connect:CreateView`,
`CreateViewVersion`, `DescribeView`, `DeleteView`; for Lex, `lex:*` on the
bot, `connect:CreateIntegrationAssociation` and `iam:PassRole` for the bot
role.

## Terraform-first

Mirrored after each merge here, as in T2.

- **Module files**: `hh-transfer-to-bo.flow.tf`, `hh-escalate-lantern.flow.tf`,
  `hh-callback-whisper.flow.tf`, `hh-field-guide-chat.flow.tf`; new
  `users.tf` (routing profile, user, `random_password`), `quick_connects.tf`,
  `views.tf`, and `lex.tf` if gated in (behind no flag, for the invariant
  above). `queues.tf` gains `quick_connect_ids` and
  `outbound_caller_config{outbound_flow_id}`. `hh-hotline-main.flow.tf`
  refs gain `queue:crew-bo`.
- **Tests**: `tests/flows.tftest.hcl` runs for transfers, quick-connect
  placement (no cycle), the chat flow and the whisper; mock defaults for the
  user ARN, view ARN and Lex alias ARN.
- **Equivalence**: snapshot bump per PR; `check.mjs`'s refs rewrite learns
  the `aws_connect_user` name, the view name and the Lex alias name, so a
  swapped user or view fails.
- **S12** there is `flow-cli export --author tf` plus an `import {}` block,
  ending in a plan with no changes.
- **Live**: us-west-2, `hh-tf-<env>-*` names, saved plan and apply.

## Assumptions

- No phone number (tier decision 1 default). Voice transfers, the outbound
  whisper and the hold flows are create-only evidence; chat carries S10.
- Connect Customer charges no per-user fee ("no seat-based licensing",
  https://aws.amazon.com/connect/pricing/), so a user per environment costs
  nothing idle.
- ShowView's two AWS pages disagree on channels and flow types; inbound plus
  chat is the intersection both allow, and is where it goes.
- C10 (Lex substitution in simulate) is not required: S11 can run against
  the real alias.

## Deviations

None yet.
