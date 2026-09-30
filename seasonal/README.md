# seasonal/

The greeting modules, deliberately outside the flow set: `hh-greeting-standard`
and `hh-greeting-halloween`, applied from `envs/seasonal-<environment>` with
hand-written `live` aliases. Flows reach them through `module:greeting@live`,
which each profile's address map binds to one of the two, so switching the
season is a rebinding and changes no flow file.

Each module plays the brand line, the emergency line ("If anyone is hurt or in
danger, hang up and call your local emergency number (911 in the US).") and the
recording notice, sets the `season` contact attribute (`standard` or
`halloween-2026`) that `hh-hotline-main` tags, and ends with
EndFlowModuleExecution. `tests/copy.test.ts` holds the emergency line in both,
word for word.

Edit a module's `.flow.ts`, then `npx flow-cli synth seasonal/<name>.flow.ts`.
