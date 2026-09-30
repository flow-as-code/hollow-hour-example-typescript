# T0: scaffold and verify

Tier 0. The repository every later task builds in, and the answers the design
depends on, before any flow is written.

## Acceptance criteria

1. `npm ci && npm test` is green on Node 22, 24 and 26 from a clean clone.
2. Every row of `VERIFY.md` carries an AWS documentation URL and a status of
   "docs-checked 2026-09-30", "needs sandbox", or "sandbox-checked <date>" with
   the service's message.
3. The layout follows the architecture: `flows/`, `seasonal/`, `generators/`,
   `lambdas/`, `refs/`, `scenarios/`, `tests/`, `envs/{dev,qa,prod}` and
   `envs/seasonal-{dev,qa,prod}`, each wired to a script or a test.
4. `package.json` is private, `engines.node >=22.12`, and pins
   `@flow-as-code/cli` and `@flow-as-code/core` exactly, at the version
   `npm view @flow-as-code/cli version` reports. The lockfile is committed.
5. Scripts: `generate`, `lint`, `test`, `emit:dev`, `emit:qa`, `emit:prod`,
   `emit:prod-october`, `validate`, `headers:fix`, `check`.
6. `districts.config.json` names old-town, harborside and graveyard-hill, each
   with an explicit `overflowTo`.
7. `refs/manifest.json` lists every reference key Tier 1 and Tier 2 use, and
   the per-profile address maps are derived from it and checked.
8. Every environment root passes `tofu validate` (`npm run validate`).
9. `ci.yml` is offline and runs `npm run check` on Node 22, 24 and 26.
   `deploy.yml` is `workflow_dispatch` only, uses GitHub environments dev, qa
   and prod (a reviewer on prod), assumes an OIDC role named by a variable,
   masks the account id, and runs in the concurrency group
   `hollow-hour-example-<env>`. Every external `uses:` is pinned to the SHA
   flow-as-code pins, with a test that fails on an unpinned one.
10. Conventions copied from flow-as-code and terraform-provider-flowascode:
    LICENSE, CONTRIBUTING, SECURITY, CODEOWNERS `* @auzroz`, Dependabot for
    github-actions and npm, ESLint flat config, Prettier, Vitest 4, the
    license-header script with its holder in one constant.

Sandbox checks, each dated with the service's message in `VERIFY.md` once
credentials exist (the local ones had expired on 2026-09-30):

- a read-only collision listing on each instance (flows, modules, queues,
  hours, Lambdas, IAM roles) before the first apply;
- negative QueueTimeAdjustmentSeconds accepted (row 16.5);
- `RecordedParticipants: []` accepted (row 16.4);
- `$.Attributes` rendering in a prompt (row 16.6);
- a hand-written version and alias on a module nothing references (row 7b);
- `always_open` and `night_shift` hours created through the provider
  (rows H1, H2);
- TransferParticipantToThirdParty created in a contact flow, and the
  ChatBehavior generic (rows 16.8, 12.7), both before Tier 3.

## Assumptions

- flow-as-code 0.2.0 is what the registry serves (`npm view` on 2026-09-30).
  The CLI depends on core, cdk, tf, hcl and studio at exactly 0.2.0; codegen
  output imports only `@flow-as-code/core`.
- The flowascode provider is 0.1.1 on both registries on 2026-09-30; the roots
  constrain it to `~> 0.1`.
- qa and prod bind identical addresses (each creates its own resources in its
  own instance), so their emitted trees are identical. The environment
  difference is the instance, the region and the state location, all supplied
  at plan time.

## Notes (2026-09-30)

- Scaffolded. `npm run check` and `npm run validate` pass locally on Node
  26.10.0 and OpenTofu 1.12.6. Node 22 and 24 are covered by CI once the
  repository is pushed; that has not happened yet.
- `flow-cli emit` exits 1 on a directory with no FlowDocs, so `emit:<profile>`
  fails until T1 adds flows. That is deliberate: an apply from an empty emit
  would destroy every deployed flow.
- The address maps name Lambda and prompt addresses that T1 and T2 create.
  `tests/envRoots.test.ts` lists them as pending and fails when one appears in
  `envs/` without leaving the list, so the list cannot go stale.
- `flow-cli lint` takes one directory per run, so `npm run lint:flows` lints
  `flows/` and `seasonal/` as two sets.
- Hours: the admin guide documents 24x7 as 12:00 AM to 12:00 AM and does not
  document a range that wraps midnight, so the night shift is two ranges per
  day (VERIFY H1, H2).

## Still open

- Owner: refresh AWS credentials; create one OIDC role per environment trusting
  this repository's subject once its numeric id exists; create the state
  bucket; set the GitHub environments' variables and the prod reviewer.
- Owner: three instances. The default quota is 2 per Region (VERIFY H3), so the
  third needs a quota increase, a second Region or a second account.
- Owner: a name search on "Hollow Hour" and on the business-account name
  before anything is public.
- `canary.yml` (a weekly, non-gating build against flow-as-code main) and the
  promotion gate comparing `<flow>_document_sha256` outputs across
  environments land with T1, when there are flows to compare.
