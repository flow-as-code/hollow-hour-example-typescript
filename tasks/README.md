# Tasks

Work in order. Each task restates its acceptance criteria, lists its
assumptions, and is done when every criterion is demonstrably met with the
checks green. Notes record what landed, dated, in the task file itself; this
directory is the record of how anything got the way it is.

| #   | Task          | Tier | File                                       |
| --- | ------------- | ---- | ------------------------------------------ |
| T0  | Scaffold      | 0    | [T0-scaffold.md](T0-scaffold.md)           |
| T1  | First night   | 1    | [T1-first-night.md](T1-first-night.md)     |
| T2  | Full moon     | 2    | [T2-full-moon.md](T2-full-moon.md)         |
| T3  | Witching hour | 3    | [T3-witching-hour.md](T3-witching-hour.md) |
| T4  | Full coverage | 4    | [T4-full-coverage.md](T4-full-coverage.md) |

T2 to T4 were planned on 2026-10-04 and are not started. T3 starts after the
season and after flow-as-code C03 is released; T4 follows flow-as-code's
Phase D releases. Each file carries a "Terraform-first" section with what
[hollow-hour-example-terraform](https://github.com/flow-as-code/hollow-hour-example-terraform)
mirrors; that repository's `tasks/README.md` points here rather than keeping
a second copy of the criteria.

## Owner decisions (2026-09-30)

These are settled; do not re-ask them.

1. The repository is `flow-as-code/hollow-hour-example-typescript` (built as
   `hollow-hour`, renamed `hollow-hour-example`, then renamed again on
   2026-09-30 when the owner split the showcase into approach-specific
   repositories; the Terraform-first one is
   `flow-as-code/hollow-hour-example-terraform`), Apache-2.0, public later.
   flow-as-code integrates it by vendoring a pinned snapshot, under a Phase C
   plan in that repository.
2. dev, qa and prod are each deployed live, each to its own Connect instance.
   Every environment root is apply-ready, parameterized by the instance id
   through `TF_VAR_connect_instance_id`, never a stub.
3. The deploy path is `flow-cli emit --target flowascode` plus the published
   flowascode provider. CDK is not used here.
4. Lex is a stretch goal. The keypad interview is the baseline, and Tier 1 has
   no Lex.
5. Tier 3 comes after the season.
6. Flow and module names carry the constant `hh-` prefix, identical in every
   environment.
7. Original names only. The draft's fifth grade is **Chorus**, and the queue
   for the two worst grades is **queue:lantern-crew** (Bo's Lantern Crew).

## Tier decisions (proposed 2026-10-04)

Open until the owner confirms each one. Each has a recommended default; a
task does not start work that depends on a decision until it is confirmed,
and the confirmation is recorded here with its date.

1. **Phone number.** Default: none in T2 and T3, and the README keeps saying
   there is no public number. Callbacks are created but never dialed, and
   voice transfers, the outbound whisper and the hold flows are
   create-only evidence. Decided again at T4, where the recommendation is
   one US DID per instance (about $0.90 a month each, so about $5.40 for the
   six instances across both repositories), kept for the life of the
   instance and never released: a released number enters a cooldown of up
   to 180 days, and claim-and-release cycles above the quota block further
   claims
   (https://docs.aws.amazon.com/connect/latest/APIReference/API_ReleasePhoneNumber.html).
   A real number can be called by the public, which the "never mistaken for
   a real line" rule has to answer first.
2. **Lex scope.** Default: still a stretch (decision 4 above), all three
   environments or none, because the environments differ only in bindings.
   If it goes in, voice in `hh-hotline-main` as the manifest names it (a
   "press 3" path beside the keypad baseline), which simulate can run
   without a phone number; chat in the field guide is the cheaper fallback.
   In by about 2026-10-15 as T2.x, otherwise T3 PR 7 or the one recorded
   gap.
3. **Agent users.** Default: one user `bo` per environment
   (`hh-<env>-bo` here, `hh-tf-<env>-bo` in the Terraform-first repository),
   CONNECT_MANAGED, password from `random_password` with
   `lifecycle { ignore_changes = [password] }`, never in source or in a
   committed plan. The password lives in the encrypted state; the operator
   reads it through a sensitive output for S10. No per-user charge under
   Connect Customer.
4. **Prompt audio.** Default: synthesized once with Amazon Polly and
   committed as `prompts/salt-line-tips.wav`, with
   `prompts/salt-line-tips.txt` beside it as the copy the tests scan. The
   wav is regenerated only when the text changes, by a documented command.
5. **Recording storage.** Default: check each instance with
   `aws connect list-instance-storage-configs --resource-type
CALL_RECORDINGS` at T2 PR 3, and add an `aws_connect_instance_storage_config`
   with its bucket in `envs/bootstrap` (and in the Terraform-first
   `instance.tf`) where none exists. Recorded with its date either way.
6. **Queue for the in-queue callback.** Default, weighed against the design's choice of the crew queue: `queue:dispatch-overflow`
   for both callback paths, not the caller's crew queue. The design's case
   for the crew queue was that the caller leaves it, so the cap nets out.
   It does not hold at the moment it matters: CreateCallbackContact runs
   while the caller still occupies a slot, so a crew queue at its cap of 2
   (dev and qa) would be over it before the disconnect frees one, and
   queued callbacks count toward the cap (VERIFY Q2). A callback can wait up
   to 7 days for an agent (VERIFY 16.12), so one leaked by a test would hold
   a crew slot and change where live callers route. Naming one queue for
   every callback also makes the test a single rule. The cost, a callback
   answered by dispatch rather than the district crew, is covered by the
   district attributes the callback carries (VERIFY CB1 checks that).
7. **Terraform-first tracking.** Default: that repository gets a short
   `tasks/README.md` that points to these task files, and each task file
   here carries a "Terraform-first" section with that repository's specifics
   (module files, tftest runs, equivalence snapshot bumps, risks).
