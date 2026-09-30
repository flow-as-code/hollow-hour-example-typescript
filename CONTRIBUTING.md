# Contributing

## Ground rules

- Every guarantee lands with a test that has been shown to fail: break the
  thing the test guards, watch it go red, restore it, and say so in the pull
  request.
- Flows are FlowDocs. Generated flows (`hh-district-*`,
  `hh-queue-experience-*`) are written by `npm run generate` from
  `districts.config.json`; edit the config, never the generated files or their
  canvas. CI fails when `npm run generate` would change anything.
- References are tokens (`${cdref:queue:old-town-crew}`), never ARNs. A new
  reference key goes into `refs/manifest.json` first; the address maps are
  derived from it.
- Any Connect behavior newly relied on gets a row in `VERIFY.md` with its AWS
  documentation URL, and stays "needs sandbox" until a live create or run
  records the service's answer with its date.
- No account ids, ARNs, instance ids or credentials anywhere in the tree.
  Phone numbers only from the reserved fictional range 555-0100 to 555-0199.
- Every source file starts with the Apache-2.0 header; `npm run headers:fix`
  applies it. The copyright holder lives in one constant in
  `scripts/license-headers.mjs`.
- Every third-party action in `.github/workflows/` is pinned to a full commit
  SHA with its version in a trailing comment.
- Original names and copy only: nothing borrowed from existing ghost-removal
  fiction.
- Prose uses no em-dashes.
- Conventional commits, small and self-contained, docs in the same commit.

## Running the checks

```
npm ci
npm run check      # lint, typecheck, generated files, flow lint, tests
npm run validate   # tofu validate of every environment root
```

`npm run validate` needs OpenTofu 1.10 or later on `PATH` (or `TOFU=<path>`)
and downloads the aws and flowascode providers once into `.tofu-cache/`. It
makes no AWS call.

## The flow-as-code version

`@flow-as-code/cli` and `@flow-as-code/core` are pinned exactly and always to
the same version; `tests/packagePins.test.ts` holds that. Codegen output in
`flows/` imports `@flow-as-code/core`, so a bump regenerates the companions
(`npm run generate`) in the same commit.

## Deploying

`.github/workflows/deploy.yml`, dispatched by hand: an ungated plan job in the
`<env>-plan` GitHub environment, then, when asked, an apply job in the `<env>`
environment (`prod` requires a reviewer) that applies the saved plans. The
role ARNs, the instance id and the bucket are environment secrets, never
variables; [envs/README.md, Deploying from GitHub](envs/README.md#deploying-from-github)
lists what to configure. One deploy runs at a time across every environment,
and by hand never apply two environments at once either: the Connect API
throttle is shared by every instance in an account and Region.
