# T4: full coverage

Tier 4. After T3 the showcase uses every action type flow-as-code 0.2.1
models (35). Amazon Connect documents 56 flow-language types, and a few more
outside that list. flow-as-code's Phase D (tasks D00 to D10, planned in that
repository in parallel with this file) models the rest. This tier consumes
each Phase D group as it is released, so that every documented type is
either used here, deployed here without a live run, or recorded as not
coverable with the reason and the evidence.

Planned 2026-10-04. Nothing below is built, and nothing here starts before
T3 closes and the first Phase D release is on npm.

## The denominator

"Full coverage" is the census flow-as-code D00 records, not a number written
here. As researched on 2026-10-04 it is:

- the 56 types the devguide's four category pages list (27 contact, 6
  participant, 15 flow control, 8 interactions), 35 modeled in 0.2.1 and 21
  not;
- types AWS documents elsewhere but the category pages do not list:
  RouteContactToAgent (Interrupt agent), LoadContactContent (Get stored
  content, email only), AuthenticateParticipant (Authenticate Customer),
  CheckSegmentMembership; plus TransferParticipantToThirdParty, which the
  console exports but whose doc page is now empty. D09 decides which of these
  are modeled;
- console blocks with no documented Type at all (Agentic CX, External Tool,
  Data Table, Create persistent contact association, Get profile
  recommendations). These are out of the denominator unless D00 or D09
  finds their Type names.

`tests/coverage.test.ts` takes the denominator from the D00 census as
published with the release (the catalog, not a list copied here) and fails
when a type in it is neither used by a flow nor listed in a `NOT_COVERED`
table with a reason and a VERIFY row. Each entry in that table says which
kind it is:

- **exercised**: a live run (a simulate scenario or an operator run) went
  through the block, recorded with its UTC time;
- **deploy-only**: the service accepted a flow containing it in all three
  environments, but no live contact runs it, with the reason (no number, no
  campaign quota, no SMS registration);
- **not coverable**: the service will not accept it, or accepting it means
  a feature that no longer exists or cannot be enabled. Recorded with the
  refusal message or the AWS notice.

## The rule for every item

- The type is modeled upstream first, on the evidence rule's terms (a create
  refused or accepted, dated, in flow-as-code actions.md rule 37 and on), and
  released. This repository pins the release; it never depends on a git
  commit.
- Until then, a GenericBlock carrying the type is allowed only with an
  `ALLOWED_GENERIC` reason in `tests/coverage.test.ts`, and none is added
  just to raise the count.
- A parameter carrying an ARN that has no reference type (an AI agents
  assistant, a task template, a case template, a phone number) fails
  `no-literal-arn`. Those types wait for D01 (FlowDoc 0.3 and the new
  reference types), which is the critical path.
- Each item follows the T2 shape: a VERIFY row first, a TypeScript-first PR
  (flows, generator, manifest key, tests with mutation cases), the
  Terraform-first mirror (module HCL, tftest, snapshot bump), live apply in
  all three environments, a clean re-plan, clean drift, then a scenario or a
  documented operator run.
- Environments still differ only in bindings. A resource a type needs (a
  Customer Profiles domain, a Cases domain) exists in all three
  environments or the type is not used.

## Phase D groups and what this tier does with each

| Upstream task                     | Types                                                                                                                                                                    | Story beat and placement                                                                                                                                                                                                                                                         | Resources (provider)                                                                                                                                                                                         | Expected coverage                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D00 catalog census                | none                                                                                                                                                                     | The denominator above.                                                                                                                                                                                                                                                           | none                                                                                                                                                                                                         | n/a                                                                                                                                                                                                  |
| D01 FlowDoc 0.3 and new ref types | none                                                                                                                                                                     | Every FlowDoc here migrates to 0.3 (the CLI's migration, then `synth`), with no change to Actions. The pins move only when a provider release that reads 0.3 is on both registries, because an older provider refuses a 0.3 document.                                            | Terraform-first: the provider floor rises in `versions.tf`.                                                                                                                                                  | n/a; a byte-stable migration and "No changes" plans in all six roots are the evidence.                                                                                                               |
| D02 contact state                 | ResumeContact, UpdatePreviousContactParticipantState, UpdateContactMediaStreamingBehavior, UpdateContactMediaProcessing                                                  | ResumeContact in `hh-task-routing` (with D05); previous-participant hold in `hh-escalate-lantern` while the briefing plays; "the sound lab" streams knocking on an opt-in key in the district flows; a chat message processor in `hh-field-guide-chat` that masks phone numbers. | `aws_connect_instance_storage_config` MEDIA_STREAMS with retention none (KVS); a stub Lambda associated as `MESSAGE_PROCESSOR` through `awscc_connect_integration_association`.                              | Media processing exercised over chat. ResumeContact exercised by an operator (StartTaskContact, PauseContact, then the flow). Previous-participant state and streaming deploy-only without a number. |
| D03 Customer Profiles             | AssociateContactToCustomerProfile, CreateCustomerProfile, GetCustomerProfile, GetCustomerProfileObject, GetCalculatedAttributesForCustomerProfile, UpdateCustomerProfile | "Welcome back" comes from a profile instead of the `caller-lookup` stub; new callers get a profile; the Wexmoor Grand's haunting history is a profile object; a frequent caller is a calculated attribute.                                                                       | `aws_customerprofiles_domain` (KMS), the instance integration, `awscc_customerprofiles_object_type`, `_calculated_attribute_definition`; seeded objects through a script (PutProfileObject has no resource). | Exercised by simulate on dev and prod. Seeded data and custom attributes leave the free tier ($0.005 per profile per day used).                                                                      |
| D04 outbound                      | CompleteOutboundCall, CheckOutboundCallStatus, StartOutboundChatContact                                                                                                  | CompleteOutboundCall in `hh-callback-whisper`; a pre-Halloween check-in campaign; an SMS "your crew is on the way".                                                                                                                                                              | A claimed number (tier decision 1); `awscc_connectcampaignsv2_campaign`; an SMS number from End User Messaging.                                                                                              | CompleteOutboundCall deploy-only without a number. CheckOutboundCallStatus and StartOutboundChatContact: see "Not coverable, or likely not".                                                         |
| D05 CreateTask and AI agents      | CreateTask, CreateWisdomSession                                                                                                                                          | "Check on Mrs. Alder tomorrow": a task from `hh-offer-callback` and the chat flow, routed by a new `hh-task-routing`; agent assist from a field-guide assistant in the hotline (voice).                                                                                          | `awscc_connect_task_template`; TASK concurrency in the routing profile; `awscc_wisdom_assistant` with an AWS-owned key and no knowledge base, tagged `AmazonConnectEnabled=True`, and its association.       | CreateTask exercised ($0.07 a task). CreateWisdomSession deploy-only unless voice real-time analytics run on a simulated call; the billing model is checked first.                                   |
| D06 Cases                         | CreateCase, GetCase, UpdateCase                                                                                                                                          | Every Hostile or Chorus call opens a case "Haunting at the Wexmoor"; a returning caller's open case is read and updated.                                                                                                                                                         | `awscc_cases_domain`, `_field`, `_template`, `_layout`, and `awscc_connect_integration_association` CASES_DOMAIN. Needs Customer Profiles first.                                                             | Exercised by simulate ($0.12 a case created). Field ids are per-domain; how they stay portable is D06's decision, and this tier follows it.                                                          |
| D07 routing criteria              | UpdateRoutingCriteria                                                                                                                                                    | Chorus calls route to agents with a "lantern-certified" proficiency, expiring to the Lantern Crew queue.                                                                                                                                                                         | `awscc_connect_predefined_attribute`; proficiencies are on `awscc_connect_user` only, so Bo either moves to awscc (removed, then imported; `moved` cannot cross providers) or keeps no proficiency.          | Deployable without agents; the expiry path is exercised by simulate. The match needs Bo logged in.                                                                                                   |
| D08 Voice ID, gated               | CheckVoiceId, StartVoiceIdStream                                                                                                                                         | None.                                                                                                                                                                                                                                                                            | None; no Voice ID domain is created.                                                                                                                                                                         | Not coverable (below), unless D08 records that the service still accepts a create, in which case deploy-only at most.                                                                                |
| D09 newly documented types        | as D09 decides: RouteContactToAgent, AuthenticateParticipant, CheckSegmentMembership, LoadContactContent, TransferParticipantToThirdParty                                | Interrupt agent in a queue flow; Chorus warm transfer to Bo's own line (the number from a Lambda environment variable, never committed).                                                                                                                                         | Cognito and Profiles for authentication; email channel for stored content; a number for third-party transfer.                                                                                                | Each one modeled is placed or listed with its reason; email-only and Cognito-backed ones likely not coverable here.                                                                                  |
| D10 release                       | n/a                                                                                                                                                                      | Pins move to each release; the Terraform-first provider floor moves with the provider release that vendors the same conformance.                                                                                                                                                 | n/a                                                                                                                                                                                                          | n/a                                                                                                                                                                                                  |

If Phase D releases in more than one npm version, the PRs here follow the
release order; if it releases once at D10, they follow the table order,
D01 first.

## Not coverable, or likely not

Each lands in `NOT_COVERED` with a VERIFY row; none is quietly skipped.

- **CheckVoiceId and StartVoiceIdStream: not coverable.** AWS ended Voice ID:
  "After May 20, 2026, you will no longer be able to use Amazon Connect
  Customer Voice ID"
  (https://docs.aws.amazon.com/connect/latest/adminguide/amazonconnect-voiceid-end-of-support.html).
  Whether the service still accepts a flow containing them is D08's finding;
  at most they are deploy-only, and no Voice ID domain is created.
- **CheckOutboundCallStatus: likely deploy-only or not coverable.** It
  "works with Connect Customer outbound campaigns only"
  (https://docs.aws.amazon.com/connect/latest/devguide/flow-control-actions-checkoutboundcallstatus.html).
  Campaigns need a Support quota increase, because the default concurrent
  campaign call quota is 0, plus a dedicated queue, a KMS key and console
  enablement (https://docs.aws.amazon.com/connect/latest/adminguide/enable-outbound-campaigns.html).
  Default: deploy-only if a create without campaigns enabled is accepted,
  otherwise not coverable; the owner decides whether to open the ticket.
- **StartOutboundChatContact: likely deploy-only or not coverable.** SMS
  only, from a registered End User Messaging number; US registration "can
  take up to 15 business days", the lease is billed before approval, and the
  account must leave the SMS sandbox
  (https://docs.aws.amazon.com/connect/latest/adminguide/setup-sms-messaging.html).
  Default: deploy-only if a create accepts a phone-number token bound to a
  voice number, otherwise not coverable.
- **LoadContactContent** (email only) and **AuthenticateParticipant**
  (Cognito, chat): not coverable here unless the owner enables the email
  channel or a Cognito pool; listed if D09 models them.
- **Undocumented console blocks**: out of the denominator, listed in the
  README so the claim "N of N" says what N is.

## Acceptance criteria

1. `tests/coverage.test.ts` reads the denominator from the pinned catalog's
   census and fails when any type in it is neither used nor in
   `NOT_COVERED`; every `NOT_COVERED` entry names its kind (exercised,
   deploy-only, not coverable) and a VERIFY row. A mutation case removes a
   used type and shows the test fails.
2. Every FlowDoc is FlowDoc 0.3 after D01, migrated with no change to
   Actions, and `npm run generate:check` and the round trip are byte-stable.
3. Lint has no findings; `ALLOWED_GENERIC` holds only types that D00 lists
   as unmodeled by design, each with its reason.
4. For each Phase D group used: its resources in all three environments in
   both repositories, a clean re-plan, `npm run drift` "No drift.", and the
   Terraform-first equivalence check green on the bumped snapshot.
5. Every type marked exercised has a scenario (simulated) or an operator
   run recorded in `VERIFY.md` with its UTC time; every deploy-only type has
   its create recorded as accepted in all three environments.
6. Tier decision 1 (phone number) is settled before D04 is consumed, and
   the README's "no public number" statement is updated to match it.
7. The README states the coverage as "used N of M documented types", with
   the not-coverable list and the reasons beside it.

## Where the criteria stand (2026-10-04)

- [ ] 1 to 7: not started. Waits on T3 and on the first Phase D release.

## Terraform-first

- Nearly every new resource is awscc-only: task templates, Cases, the
  AI agents assistant and its association, predefined attributes, user
  proficiencies, message-processor and Lex integration associations.
  hashicorp/aws covers the Customer Profiles domain, the media-streams
  storage config and phone numbers. Risk E1 (T2) is the precondition: the
  equivalence harness must plan awscc offline before any of these lands.
- New module files follow T2 and T3: one `*.flow.tf` per new flow
  (`hh-task-routing.flow.tf`), one supporting file per capability
  (`profiles.tf`, `cases.tf`, `tasks.tf`, `assist.tf`, `streaming.tf`).
- The provider floor in `versions.tf` moves with each provider release that
  vendors the conformance the npm release uses; D01's FlowDoc 0.3 needs the
  provider that reads it before any root plans a 0.3 document.
- tftest runs and `check.mjs`'s refs rewrite learn each new reference type
  (task template, case template, assistant, phone number) by name.

## Assumptions

- Phase D's numbering and grouping are as planned in flow-as-code on
  2026-10-04; if they change, this table follows that repository's
  `tasks/`.
- Costs are from the AWS pricing pages and the public price list of
  2026-09-15: a US DID about $0.90 a month; tasks $0.07; cases $0.12;
  chat $0.010 a message; profiles $0.005 a day once they hold imported data.
- Lex, users and the view exist from T3.

## Deviations

None yet.
