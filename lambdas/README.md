# lambdas/

Six deterministic stub Lambdas, one directory each, one per `lambda:` key in
`refs/manifest.json`. Each directory holds a single dependency-free
`index.mjs` (Node.js 22, handler `index.handler`) that `envs/<environment>/lambdas.tf`
zips as it is: no build step, nothing bundled, nothing committed but source.
The unit tests live in `tests/lambdas.test.ts` and `tests/rubric.test.ts`.

Every stub returns a flat object of non-empty strings
(https://docs.aws.amazon.com/connect/latest/adminguide/connect-lambda-functions.html).
Values a flow branches on are alphanumeric or dashed. `caller-lookup`,
`classify-apparition`, `crew-eta` and `district-for-address` also return
spoken values with spaces and punctuation (`callerName`, `gradeName`,
`advice`, `crewName`, `message`, `districtName`), and response validation
covers the whole response, so the flows invoke them with `JSON` validation
rather than `STRING_MAP`; see VERIFY.md, row L1.
Inputs are read from the function input parameters (`Details.Parameters`)
first, then from the contact attributes of the same name. For a yes/no
answer, "1", "yes", "y" and "true" mean yes and anything else means no.

Fixture callers use numbers in the fictional 555-0100 to 555-0199 range only.
Anything secret, such as a transfer number in a later tier, comes from an
environment variable at deploy time and is never committed.

| Stub                   | Used by                          | Inputs                                                                                                                                             | Returns                                                                                                                                     |
| ---------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `caller-lookup`        | hh-hotline-main                  | `CustomerEndpoint.Address`, or a `callerNumber` parameter                                                                                          | `status` (known, account, new), `found`, `callerName`, `tier`, `homeDistrict`, `accountName`                                                |
| `classify-apparition`  | hh-hotline-main                  | `canSee`, `movesObjects`, `coldSpot`, `sounds`, `touchedYou` (or `touched`), `multiple`; `anyoneHurt` (or `injured`, `injury`, `hurt`); `district` | `grade` (1 to 5), `gradeName`, `score`, `answered`, `safety` (911, none), `advice`, `crewQueue` (lantern-crew, `<district>-crew`, district) |
| `crew-eta`             | hh-queue-experience-\<district\> | `district`, `queueSize`                                                                                                                            | `etaMinutes`, `etaBand` (soon, within-the-hour, later), `crewName`, `message`                                                               |
| `plane-check`          | hh-hotline-main (Tier 2)         | `CustomerEndpoint.Address` or `callerNumber`; `claimsBeyond`                                                                                       | `plane` (living, beyond), `reason`                                                                                                          |
| `prank-score`          | hh-hotline-main (Tier 2)         | `CustomerEndpoint.Address` or `callerNumber`; the six answers; `menuResets`; `anyoneHurt`                                                          | `score`, `verdict` (high, low), `reason`                                                                                                    |
| `district-for-address` | hh-collect-address (Tier 2)      | `address`, `postcode`                                                                                                                              | `district`, `districtName`, `matchedBy` (street, postcode, default, none)                                                                   |

## The rubric (classify-apparition)

| Signal          | Points |
| --------------- | ------ |
| Can see it      | 2      |
| Moves objects   | 1      |
| Cold spot       | 1      |
| Sounds          | 1      |
| Touched someone | 2      |
| More than one   | 3      |

| Score     | Grade      | Crew                |
| --------- | ---------- | ------------------- |
| 0 to 1    | 1 Faint    | the district's crew |
| 2 to 3    | 2 Restless | the district's crew |
| 4 to 5    | 3 Manifest | the district's crew |
| 6 to 7    | 4 Hostile  | the Lantern Crew    |
| 8 or more | 5 Chorus   | the Lantern Crew    |

The injury override: when the caller says anyone is hurt, `safety` is `911`
and `advice` is about the person who is hurt ("A crew is on the way. Keep
everyone together and look after whoever is hurt.") whatever the score. The
flow has already given the emergency line and the caller has chosen to stay
on, so the advice does not tell them to hang up again. The grade still stands,
so the job still routes.

## Fixture callers (caller-lookup)

| Number (fictional) | Caller                                      | Status  | Home district  |
| ------------------ | ------------------------------------------- | ------- | -------------- |
| +1 413 555 0142    | Mrs. Alder                                  | known   | old-town       |
| +1 413 555 0107    | The Wexmoor Grand (hotel, business account) | account | harborside     |
| +1 413 555 0166    | Theo (also a known dare to prank-score)     | known   | graveyard-hill |
| 555-0190 to 0199   | the departed, to plane-check                | new     | unknown        |

`district-for-address` and `crew-eta` read the districts from `HH_DISTRICTS`,
which the environment root writes from `districts.config.json`, so a new
district needs no change here.
