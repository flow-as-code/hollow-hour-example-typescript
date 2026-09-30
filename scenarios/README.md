# scenarios/

`flow-cli simulate` scenario suites, run by an operator against a deployed
environment, never in CI. Each scenario ends with EndTest (the default), so a
simulated contact never reaches an agent. `tests/envScenarios.test.ts` checks
every scenario here offline: valid for the pinned CLI, every token resolvable,
every expected prompt and keypad press one the flows really make.

| Scenario                                    | Tier | What it proves                                                                                   |
| ------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| `s2-keypad-restless-old-town.scenario.json` | 1    | Mrs. Alder's keypad interview grades Restless and reaches the Old Town crew queue (stub Lambdas) |

S1 and S3 to S5 arrive with task T2. S6 (metrics), S8 (campaigns) and S9
(chat view) cannot be simulated (VERIFY.md, row 15).

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
refuses to write the map when a key the scenarios use is missing.
