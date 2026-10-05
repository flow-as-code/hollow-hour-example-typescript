# scenarios/

`flow-cli simulate` scenario suites, run by an operator against a deployed
environment, never in CI. Each scenario ends with EndTest (the default), so a
simulated contact never reaches an agent. `tests/envScenarios.test.ts` checks
every scenario here offline: valid for the pinned CLI, every token resolvable,
every expected prompt and keypad press one the flows really make.

| Scenario                                    | Tier | What it proves                                                                                                                                         |
| ------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `s1-safety-path.scenario.json`              | 2    | Mrs. Alder says someone is hurt: the emergency advice, the offer to end the call, and the goodbye, with no transfer                                    |
| `s2-keypad-restless-old-town.scenario.json` | 1    | Mrs. Alder's keypad interview grades Restless and reaches the Old Town crew queue (stub Lambdas)                                                       |
| `s3-theos-dare.scenario.json`               | 2    | Theo's known number scores high: the contact is tagged, he presses 1 to say it is real, the tag is cleared and classify runs                           |
| `s4-after-hours-callback.scenario.json`     | 2    | Mrs. Alder's S2 path with Old Town's hours substituted with `hours:closed`: the after-hours message, the callback offer, press 1; then the sweep below |
| `s5-departed-caller.scenario.json`          | 2    | A caller from 555-0193: plane-check says beyond, hh-dead-line welcomes them and queues them for the dead                                               |

## What can be simulated

Every scenario above runs under the harness; what each one cannot observe
is listed with it, and what no scenario can reach is documented rather than
faked.

| What                                         | Simulated | Where the run stops, and what it cannot see                                                                                                                                                  |
| -------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1, the safety path                          | yes       | at the goodbye prompt; the disconnect after it is not an event the pinned flow-cli observes                                                                                                  |
| S2, the keypad interview                     | yes       | at the transfer to the Old Town crew queue, with Old Town's hours substituted                                                                                                                |
| S3, Theo's dare                              | yes       | after the advice; the tag and untag are not events the harness observes, so the asserts (grade, gradeName) show `classify` ran after the 1                                                   |
| S4, the after-hours callback                 | yes       | at the keypress that takes the offer; the module invoke and CreateCallbackContact are not observed, so whether a callback was created is read afterwards by the sweep below (VERIFY.md, CB1) |
| S5, a departed caller                        | yes       | at the transfer to `queue:the-dead`; which callback-number error branch fired, if either, is not observed (VERIFY.md, 6.2), and both rejoin                                                  |
| the hold flows (`hh-*-hold`)                 | no        | a hold flow runs when an agent places a voice hold, and every test ends before an agent; the evidence is the create on apply and `tests/flows.test.ts`                                       |
| which side of the hold A/B split a run takes | no        | DistributeByPercentage is not a substitutable action (VERIFY.md, row 15); the side taken is read after the fact from the `holdVariant` tag in contact search (VERIFY.md, DP1)                |
| S6, queue metrics                            | no        | `$.Metrics.*` cannot be overridden (VERIFY.md, row 15); the overflow is heard live by filling a capped dev queue                                                                             |
| S8, outbound campaigns; S9, the chat view    | no        | not overridable (VERIFY.md, row 15); Tier 3                                                                                                                                                  |

## Running one

The resource map a run needs holds ARNs, so it is built on the operator's
machine and gitignored (`scenarios/*.resources.json`):

```
npm run emit:dev
tofu -chdir=envs/dev init -backend-config=...   # the same backend deploy.yml uses
node scenarios/resource-map.mjs dev             # writes scenarios/dev.resources.json
npx flow-cli simulate scenarios/ --instance "$DEV_INSTANCE_ARN" \
  --resource-map scenarios/dev.resources.json
```

`resource-map.mjs` resolves every key of `refs/<profile>.tfmap.json` against
the flow root's state and adds `flow:<name>` for every deployed flow. It
refuses to write the map when a key the scenarios use is missing. The
`flow-cli simulate` step needs AWS credentials only; the Region is read from
the instance ARN.

## After an S4 run

S4 presses 1 for a callback, which invokes `module:hh-offer-callback@live`:
UpdateContactCallbackNumber, then CreateCallbackContact in
`queue:dispatch-overflow`. Neither is an event the pinned flow-cli observes,
so the test ends at the keypress, and whether EndTest at that point keeps a
real callback from being created is open (VERIFY.md, CB1). A callback that
is created waits in queue for an agent for up to 7 days (VERIFY.md, 16.12)
and counts toward the queue's cap, which is 2 in dev and qa, so two leaked
callbacks fill `dispatch-overflow` and change where every dispatch caller
routes. After every S4 run, list the callback contacts in that queue since
the run began and stop each one. The queue id is in `aws connect list-queues`
(name `hh-<env>-dispatch-overflow`); times are epoch seconds:

```sh
aws connect search-contacts --instance-id "$INSTANCE_ID" --region "$REGION" \
  --time-range "Type=INITIATION_TIMESTAMP,StartTime=$RUN_STARTED,EndTime=$(date +%s)" \
  --search-criteria "InitiationMethods=CALLBACK,QueueIds=$DISPATCH_OVERFLOW_QUEUE_ID" \
  --query 'Contacts[].Id' --output text
aws connect stop-contact --instance-id "$INSTANCE_ID" --region "$REGION" \
  --contact-id <each id>
```

StopContact is documented for exactly this ("Use this API to stop queued
callbacks"). Run the search again afterwards and expect no ids. Never run
S4 on Sunday between 03:00 and 03:01 America/New_York, the one minute
`hours:closed` is open (VERIFY.md, HC1).

The sweep is also CB1's evidence, so before stopping each id, describe it:

```sh
aws connect describe-contact --instance-id "$INSTANCE_ID" --region "$REGION" \
  --contact-id <each id> --query 'Contact.{Method:InitiationMethod,Queue:QueueInfo.Id}'
aws connect get-contact-attributes --instance-id "$INSTANCE_ID" --region "$REGION" \
  --initial-contact-id <each id>
```

Record in VERIFY.md, row CB1, with the run's UTC time: whether the search
found a callback at all (none means EndTest at the keypress kept the create
from running, or the create ran and failed), and if it did, whether its
attributes carry `district` and `districtName`, which Tier 3's outbound
whisper reads.

## Writing a prompt expectation

A voice `expect-prompt` is matched against a speech-to-text transcript of the
prompt, not against the prompt's text. The match is case-insensitive, but the
transcript does not keep the text's punctuation or its way of writing numbers.
Observed on 2026-09-30 (UTC) in dev: "Have you heard it? Knocking, footsteps,
..." came back as "Have you heard it knocking footsteps, ...", so an
expectation of `Have you heard it?` never matched and the run timed out at 5
minutes; "Press 1" came back as "press one" in some prompts and "Press 1" in
others; "Where are you calling from? For Old Town, press 1." came back as
"Where are you calling from for old town, press 1"; "could there be more"
matched the expectation `Could there be more`. Expect a run of plain words
from inside one sentence: no `?`, no commas, no digits.

## Known service limits

On 2026-09-30 (UTC) every qa run failed within 20 seconds with
`INITIALIZATION_FAILURE: Failed to start execution of test case due to limit
reached.` on all four attempts, and the instance recorded no contact. The qa
instance's Service Quotas value "Concurrent active calls per instance",
applied at the instance level, reads 0; dev's reads 10 and dev runs. A
simulated voice contact is a call, so that quota is the likely cause, to be
confirmed by a run after raising it.
