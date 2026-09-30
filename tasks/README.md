# Tasks

Work in order. Each task restates its acceptance criteria, lists its
assumptions, and is done when every criterion is demonstrably met with the
checks green. Notes record what landed, dated, in the task file itself; this
directory is the record of how anything got the way it is.

| #   | Task                | Tier                      |
| --- | ------------------- | ------------------------- |
| T0  | Scaffold and verify | 0                         |
| T1  | First night         | 1                         |
| T2  | Full moon           | 2 (file written at start) |
| T3  | Witching hour       | 3 (file written at start) |

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
