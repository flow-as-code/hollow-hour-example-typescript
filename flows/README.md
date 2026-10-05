# flows/

The emitted flow set: every in-set FlowDoc (`<name>.flowdoc.json`) and its
`.flow.ts` companion, flat, every name prefixed `hh-`. Emitted per profile by
`npm run emit:<profile>`, linted by `npm run lint:flows`.

| Flow                         | Type             | Source                             |
| ---------------------------- | ---------------- | ---------------------------------- |
| `hh-hotline-main`            | CONTACT_FLOW     | hand-authored                      |
| `hh-customer-whisper`        | CUSTOMER_WHISPER | hand-authored                      |
| `hh-agent-whisper`           | AGENT_WHISPER    | hand-authored                      |
| `hh-customer-hold`           | CUSTOMER_HOLD    | hand-authored                      |
| `hh-agent-hold`              | AGENT_HOLD       | hand-authored                      |
| `hh-district-menu`           | CONTACT_FLOW     | `npm run generate` (`generators/`) |
| `hh-district-<slug>`         | CONTACT_FLOW     | `npm run generate` (`generators/`) |
| `hh-queue-experience-<slug>` | CUSTOMER_QUEUE   | `npm run generate` (`generators/`) |

## Editing

- Generated flows: edit `districts.config.json` or `generators/flows.ts`, then
  `npm run generate`. A hand edit to a generated file fails
  `npm run generate:check` and `tests/generator.test.ts`.
- Hand-authored flows: edit the `.flow.ts`, then
  `npx flow-cli synth flows/<name>.flow.ts`, or edit on the canvas with
  `npx flow-cli studio flows`. Either way the pair stays in sync, and
  `tests/roundtrip.test.ts` holds that the companion is exactly codegen of the
  document.
- Adding a district is one config entry and `npm run generate`. The generator
  adds the district's two flows and one key to the generated
  `hh-district-menu`, and changes no other flow; no hand-authored flow or
  test needs an edit (`tests/generator.test.ts` holds that).

The two hold flows are each one MessageParticipantIteratively and nothing
else: MessageParticipant and every terminal type are illegal in hold flows,
and a loop of prompts with no next ends the flow. They are hooked wherever
the whisper hooks are set (the generated district flows, the dispatch
fallback, the Lantern Crew chain in `hh-hotline-main`), one hook per block
(VERIFY.md, row 16.3), so no path an agent can hold on gets Connect's default
hold. They never run under the simulate harness, which ends every test
before an agent; their evidence is the create and `tests/flows.test.ts`.

## What the flows read and write

Lambda responses, read as `$.External.<key>`. Every invocation uses `JSON`
response validation, because each of these stubs also returns spoken values
with spaces and punctuation and validation covers the whole response
(VERIFY.md, row L1):

| Lambda                       | Receives                                                                                              | Returns                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `lambda:caller-lookup`       | the contact (no parameters)                                                                           | `status` (`known`, `account`, anything else is new), `callerName` |
| `lambda:classify-apparition` | `canSee`, `movesObjects`, `coldSpot`, `sounds`, `touched`, `multiple`, `injured`, each `yes` or `no` | `grade` (`1` to `5`), `gradeName`, `advice`, `safety`, `crewQueue` |
| `lambda:crew-eta`            | `district` (the slug)                                                                                 | `etaMinutes`                                                    |

Contact attributes, which reach whispers and later flows (flow attributes do
not):

| Attribute                      | Set by                                  | Read by                              |
| ------------------------------ | --------------------------------------- | ------------------------------------ |
| `season`                       | the greeting module                     | `hh-hotline-main` (the `season` tag) |
| `callerName`, `callerStatus`   | `hh-hotline-main`                       | `hh-hotline-main` (welcome back)     |
| `grade`, `gradeName`, `advice` | `hh-hotline-main` (from the classifier; `gradeName` is `Ungraded` on the dispatch fallback from a failed classification) | `hh-hotline-main`, `hh-agent-whisper`, `hh-agent-hold` |
| `district`, `districtName`     | `hh-district-menu`; rewritten by `hh-district-<slug>` before an overflow, by `hh-queue-experience-<slug>` before a move, and by `hh-hotline-main` for the Lantern Crew and dispatch | both whispers, `hh-customer-hold`, the queue flows' copy |
| `moved`                        | `hh-queue-experience-<slug>` (`true` before a move, `false` if it fails) | `hh-queue-experience-<slug>` (skips the offer) |

The interview answers are flow attributes of `hh-hotline-main`, passed to the
classifier and nowhere else. `overflowCrew` is a flow attribute of each
`hh-district-<slug>`, read by its own at-capacity message.

## Coverage

`npx vitest run tests/coverage.test.ts --reporter=verbose` prints which of the
35 modeled action types and 8 reference types the flows use and which are
still missing. Missing ones do not fail; an unmodeled action type does.
