# Hollow Hour Example: TypeScript-first

Hollow Hour Removal Co. runs a dispatch line for haunted households, built on
Amazon Connect with [flow-as-code](https://flow-as-code.dev/). The business is
invented. The engineering is not: one set of flows, written once as FlowDocs with
typed TypeScript companions, deployed to three environments on three Connect
instances, where every difference between those environments, the Halloween
season included, is a reference binding rather than an edit to a flow.

This repository is the TypeScript-first approach: flows are authored as
FlowDocs and TypeScript, and Terraform is generated from them per
environment. For the same hotline written entirely in Terraform, see
[hollow-hour-example-terraform](https://github.com/flow-as-code/hollow-hour-example-terraform).

> Status: **Tier 1 live in dev, qa and prod** (task T1, 2026-09-30). The
> bootstrap root created the three instances and the state bucket, and each
> environment is applied: 6 resources in each seasonal root and 55 in each
> flow root, dev and qa earlier that day and prod at about 20:20 UTC, with
> every FlowDoc matching what is live (`npm run drift`). Scenario S2 passed on
> dev and on prod; on qa it waits on a quota increase for the instance's
> concurrent calls (VERIFY.md, S2). All three instances are in us-east-1:
> dev moved there from us-west-2 later that day, by destroy, instance
> replacement and re-apply, and afterwards drift was clean on all three and
> S2 passed on the new dev (VERIFY.md, R1). See
> [Tiers and status](#tiers-and-status).
>
> The deploy found that Amazon Connect refuses a Compare with no
> `Transitions.NextAction`, which flow-as-code 0.2.0's typed Compare did not
> write, so the Compares here were generic blocks that carried it. flow-as-code
> 0.2.1 writes it, and since 2026-09-30 they are typed again, with the deployed
> flows unchanged ([VERIFY.md, row C1](VERIFY.md#the-table)).

## The premise

A town has a ghost problem, and Hollow Hour is the crew you call. The hotline
treats the paranormal the way a good plumber treats a burst pipe: calmly,
with a few questions, and with somebody on the way. Callers are homeowners with
a cold spot or a cupboard that will not stay shut, curious neighbours and
the occasional prankster, business accounts with long histories, and now and
then the haunting itself, who is routed to the Queue of the Dead and treated
as a customer with a legitimate complaint.

A short keypad interview grades what the caller is dealing with, and the grade
decides who picks up:

| Grade    | What it means                        | Who responds      |
| -------- | ------------------------------------ | ----------------- |
| Faint    | A cold spot, an odd smell, a feeling | The district crew |
| Restless | Moves small objects, makes noise     | The district crew |
| Manifest | Visible and deliberate               | The district crew |
| Hostile  | Touching people or property          | The Lantern Crew  |
| Chorus   | Several presences at once            | The Lantern Crew  |

Three districts each have their own crew, and each names the sibling crew that
takes its overflow: Old Town, Harborside and Graveyard Hill
([`districts.config.json`](districts.config.json)).

The tone is warm and dry. It never makes light of real grief, illness or
emergencies, and the prank path always ends the call kindly.

## Safety

This is a fictional service and must never be mistaken for a real emergency
line. The greeting says, before anything else that matters:

> If anyone is hurt or in danger, hang up and call your local emergency number
> (911 in the US).

The interview asks "Is anyone hurt?" on the keypad before any other question,
and a yes repeats that advice and then offers to end the call or continue. It
never transfers an injured caller to a ghost queue. There is no public phone
number: calls are placed through Connect's test-case API or by the operator of
a sandbox instance, and every phone number in this repository is in the
reserved fictional range 555-0100 to 555-0199.

## Scene 1: the keypad

Mrs. Alder calls from her usual number, +1 413 555 0142. Her kitchen cupboards
open themselves at 2 am. This is scenario S2
([`scenarios/s2-keypad-restless-old-town.scenario.json`](scenarios/s2-keypad-restless-old-town.scenario.json)),
and what she hears is exactly what the flows say:

| Step                                         | The hotline                                                                                                                        | Mrs. Alder |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `hh-hotline-main`, before anything else      | "Hollow Hour Removal. Calls are recorded."                                                                                         |            |
| the greeting module (`module:greeting@live`) | the brand line, and "If anyone is hurt or in danger, hang up and call your local emergency number (911 in the US)."                |            |
| `lambda:caller-lookup` knows the number      | "Welcome back, Mrs. Alder."                                                                                                        |            |
| the safety question                          | "Before anything else: is anyone hurt? ..."                                                                                        | 2 (no)     |
| question 1                                   | "Can you see it right now?"                                                                                                        | 2          |
| question 2                                   | "Has it moved anything?"                                                                                                           | 1          |
| question 3                                   | "Is there a cold spot where it happens?"                                                                                           | 2          |
| question 4                                   | "Have you heard it? Knocking, footsteps, humming, anything at all."                                                                | 1          |
| question 5                                   | "Has it touched anyone?"                                                                                                           | 2          |
| question 6                                   | "Could there be more than one of them?"                                                                                            | 2          |
| `lambda:classify-apparition`                 | "Thank you. From what you describe, this is a Restless case. Put small breakables away and keep a light on in the room it favors." |            |
| `hh-district-menu` (generated)               | "Where are you calling from? For Old Town, press 1. For Harborside, press 2. For Graveyard Hill, press 3."                         | 1          |
| `hh-district-old-town` (generated)           | checks `hours:old-town`, then queues her for the Old Town crew                                                                     |            |

Moves and a cold spot score 2 points, which is grade 2, Restless
([the rubric](lambdas/README.md#the-rubric-classify-apparition)), so she stays
with her district's crew rather than the Lantern Crew. When a crew member
picks up, the whispers read contact attributes: she hears "You are through to
the Old Town crew", and the crew hears "Old Town call. Grade: Restless" with
the advice she was given. If Old Town's queue is full she is moved to
Harborside, its `overflowTo`, and both whispers and the queue copy say
Harborside, because the district attributes move with her.

Offline, `tests/envScenarios.test.ts` replays her keypad answers and number
through the stub Lambdas and holds the scenario's asserts (grade 2, Restless,
Mrs. Alder, old-town) to what they return. The live run against dev is an
operator step (T1 criterion 10).

## Three environments, compared

What differs between the environments is the address maps, and so the
emitted `flows.tf`, and nothing else. `npm run emit:<profile>` writes each
profile's tree under `build/emit/<profile>/`, and the invariants are held by
`tests/envEmit.test.ts`.

qa and prod bind the same addresses, so their emitted trees are
byte-identical: `diff -r build/emit/qa build/emit/prod` prints nothing. The
difference is the instance each is applied to.

dev against prod: the district hours (three districts today), and nothing else.

```diff
-  "hours:graveyard-hill": "aws_connect_hours_of_operation.always_open.arn",
-  "hours:harborside": "aws_connect_hours_of_operation.always_open.arn",
-  "hours:old-town": "aws_connect_hours_of_operation.always_open.arn",
+  "hours:graveyard-hill": "aws_connect_hours_of_operation.night_shift.arn",
+  "hours:harborside": "aws_connect_hours_of_operation.night_shift.arn",
+  "hours:old-town": "aws_connect_hours_of_operation.night_shift.arn",
```

prod against prod-october: the same hours the other way, and the
greeting.

```diff
-  "hours:graveyard-hill": "aws_connect_hours_of_operation.night_shift.arn",
-  "hours:harborside": "aws_connect_hours_of_operation.night_shift.arn",
-  "hours:old-town": "aws_connect_hours_of_operation.night_shift.arn",
+  "hours:graveyard-hill": "aws_connect_hours_of_operation.always_open.arn",
+  "hours:harborside": "aws_connect_hours_of_operation.always_open.arn",
+  "hours:old-town": "aws_connect_hours_of_operation.always_open.arn",
-  "module:greeting@live": "data.terraform_remote_state.seasonal.outputs.greeting_standard_live_arn",
+  "module:greeting@live": "data.terraform_remote_state.seasonal.outputs.greeting_halloween_live_arn",
```

These are `diff refs/dev.tfmap.json refs/prod.tfmap.json` and
`diff refs/prod.tfmap.json refs/prod-october.tfmap.json`; the emitted
`flows.tf` differs on the same bindings, one line each. `tests/readme.test.ts`
recomputes both from the maps and fails when this section no longer matches.

## Three environments

One FlowDoc set, three Connect instances, four deploy profiles:

| Profile        | Deploys to        | Crew hours                | Greeting  |
| -------------- | ----------------- | ------------------------- | --------- |
| `dev`          | the dev instance  | around the clock          | standard  |
| `qa`           | the qa instance   | night shift, 4 pm to 6 am | standard  |
| `prod`         | the prod instance | night shift, 4 pm to 6 am | standard  |
| `prod-october` | the prod instance | around the clock          | Halloween |

Each profile is an address map in [`refs/`](refs/), derived by
`npm run generate` from [`refs/manifest.json`](refs/manifest.json), the one
file that lists every reference key the flows make. The flows name
`${cdref:queue:old-town-crew}`, never an ARN; the map says which Terraform
address that is in each environment. qa and prod bind the same addresses
because each creates its own resources in its own instance, so their emitted
flows are identical and the difference is the instance they are applied to.
Switching prod into October changes exactly four bindings (three crews' hours
and the greeting), and switching it back is the reverse.

Each environment is an OpenTofu (or Terraform) root under [`envs/`](envs/):
`envs/<environment>` for the flows and the resources they use, and
`envs/seasonal-<environment>` for the two greeting modules and their `live`
aliases, applied first. The roots differ only in `environment.tf`. The
instance id is always supplied at plan time and never committed.

## Quickstart

You need Node 22.12 or later, and OpenTofu 1.10 or later for
`npm run validate` and to deploy.

```sh
git clone https://github.com/flow-as-code/hollow-hour-example-typescript.git
cd hollow-hour-example-typescript
npm ci
npm run check       # everything CI's check job runs: lint, types, generated files, flow lint, tests
npm run validate    # tofu validate of every root, each with its profile's flows emitted into a temporary copy
```

`npm test` makes no AWS call. When OpenTofu is on PATH it also runs
`tests/validate.test.ts`, which downloads the aws, archive and flowascode
providers from the registry the first time (about a minute; cached in
`.tofu-cache/`). `HH_SKIP_TOFU=1 npm test` keeps it fully offline.
`npm run validate` needs nothing emitted first: it emits every profile itself.

### Deploying to your own instance

Before the first deploy you need:

- a Connect instance per environment and an S3 bucket for state.
  [`envs/bootstrap`](envs/README.md#bootstrap) creates both, by default
  all three instances and the bucket in `us-east-1`. The default quota is
  two instances per account and Region (VERIFY.md, H3), so this repository
  alone needs it raised to at least 3 in `us-east-1`, plus any instances
  already there; [envs/README.md, Bootstrap](envs/README.md#bootstrap) has
  the read and the request. The Terraform-first repository keeps its three
  in `us-west-2`, so the two never share a Region;
- credentials whose role can do what the roots do: read the instance
  (`connect:DescribeInstance`); create and delete Connect queues, hours of
  operation, flows, flow modules and their versions and aliases, and Lambda
  associations (`connect:AssociateLambdaFunction`); create IAM roles named
  `hh-<environment>-*` with inline policies (and `iam:PassRole` on them);
  create Lambda functions and their permissions; create CloudWatch log groups
  named `/aws/lambda/hh-<environment>-*`; and read and write the state
  objects in the bucket. [`envs/README.md`](envs/README.md) lists the actions
  by resource.

The seasonal root must be **applied**, not just planned, before the flow root
can be planned: the flow root reads the greeting alias ARNs from its state.
`deploy.yml` refuses to plan the flow root until that has happened (a first
deploy there is two dispatches; [envs/README.md, First apply](envs/README.md#first-apply)).

```sh
# From `tofu -chdir=envs/bootstrap output`: dev's instance and Region, and
# the state bucket and its Region, which need not be the same.
export TF_VAR_aws_region=us-east-1
export TF_VAR_connect_instance_id=<dev instance id>
export TF_VAR_seasonal_state='{bucket="<state bucket>",key="hollow-hour-example/dev/seasonal.tfstate",region="us-east-1"}'

npm run emit:dev    # or emit:qa, emit:prod, emit:prod-october

tofu -chdir=envs/seasonal-dev init \
  -backend-config="bucket=<state bucket>" \
  -backend-config="key=hollow-hour-example/dev/seasonal.tfstate" \
  -backend-config="region=us-east-1" \
  -backend-config="use_lockfile=true"
tofu -chdir=envs/seasonal-dev plan -out=seasonal.tfplan
tofu -chdir=envs/seasonal-dev apply seasonal.tfplan

tofu -chdir=envs/dev init \
  -backend-config="bucket=<state bucket>" \
  -backend-config="key=hollow-hour-example/dev/flows.tfstate" \
  -backend-config="region=us-east-1" \
  -backend-config="use_lockfile=true"
tofu -chdir=envs/dev plan -out=flows.tfplan
tofu -chdir=envs/dev apply flows.tfplan
```

Apply the saved plan you read, as `deploy.yml` does, never
`apply -auto-approve`. `npm run drift -- dev` then checks every FlowDoc
against what is live ([envs/README.md, Checking drift](envs/README.md#checking-drift)).

Each root commits its `.terraform.lock.hcl` with hashes for Linux and macOS
on amd64 and arm64, so init installs only the reviewed provider builds;
`npm run lock:providers` rewrites them. They are OpenTofu registry locks: with
Terraform, init adds its own registry's entries, so review that diff and keep
it out of a pull request.

In this repository the same steps run from `.github/workflows/deploy.yml`,
dispatched by hand: a plan job with no gate that writes both plans to the
run's summary, then, when asked, an apply job that waits for prod's reviewer
and applies those saved plans. One deploy runs at a time across every
environment ([envs/README.md, Deploying from GitHub](envs/README.md#deploying-from-github)).

Supporting resources are named `hh-<environment>-*` and tagged
`hollow-hour-example = true`; flows and modules carry the constant `hh-` prefix.
Tear down with `tofu destroy` in `envs/<environment>`, then in
`envs/seasonal-<environment>`, with the same exports and `init` as the apply;
removing the instances and the state bucket as well takes the steps in
[envs/README.md, Teardown](envs/README.md#teardown).

## What is simulated and what is not

- The Lambdas are deterministic stubs. Grading is a fixed rubric, so tests can
  assert every boundary.
- Scenarios run through Connect's test-case API against a deployed
  environment, as an operator step, never in CI. Every scenario ends with
  EndTest.
- Not simulatable, and documented rather than faked: queue metrics (the
  overflow scenario), outbound campaigns, and the chat view. Every queue is
  capped (two contacts in dev and qa), so an operator can fill one and hear
  the overflow live.
- Lex is a stretch goal. The keypad interview is the baseline.
- There is no live public hotline.

[`VERIFY.md`](VERIFY.md) lists every Connect behavior the design relies on,
with its AWS documentation and whether it has been checked against a live
instance yet.

## Tiers and status

| Tier | Name          | Scope                                                                                                                                                        | Status                                                                                            |
| ---- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| T0   | Scaffold      | Layout, toolchain, CI, environment roots, reference manifest, VERIFY.md                                                                                      | done; owner setup open                                                                            |
| T1   | First night   | Main line with keypad triage and interview, generated district and queue flows, whispers, seasonal greetings, supporting resources in all three environments | live in dev, qa and prod, all in us-east-1 (2026-09-30); qa S2 waits on a quota increase          |
| T2   | Full moon     | Holds, the Queue of the Dead, prank screen, work orders, callbacks, a hold A/B test with a recorded prompt, the address module (when flow-as-code C04 ships) | planned 2026-10-04 ([T2](tasks/T2-full-moon.md)); not started                                     |
| T3   | Witching hour | Bo as an agent, transfers to him and the Lantern Crew, the outbound whisper, the chat field guide, Lex if gated in, the drift-and-adopt scene                | planned 2026-10-04 ([T3](tasks/T3-witching-hour.md)); after the season, gated on flow-as-code C03 |
| T4   | Full coverage | Every documented action type flow-as-code Phase D models, used here or recorded as deploy-only or not coverable with the reason                              | planned 2026-10-04 ([T4](tasks/T4-full-coverage.md)); follows Phase D releases                    |

Each tier's acceptance criteria are in [`tasks/`](tasks/).

## License

Apache-2.0. Copyright The flow-as-code Authors.
