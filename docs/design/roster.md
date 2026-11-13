# Roster

The Roster screen is the player's own people. The `roster` system
(`packages/engine/src/systems/roster/`) answers it with one query,
`roster.rows`: every active contract with the viewer's promotion, one row each,
with every number already worked out so the screen only formats it.

The roster adds one formula of its own, the [push gap](#push-gap) and its
[verdict](#push-verdict). Everything else in a row comes from the
[workers](workers.md) system's helpers and formulas, so the roster, a profile
and the workers list can never disagree about a person.

## Roster rows

`buildRosterRows(read, promotionId, date, deps, filter)` reads the
`byPromotionStatus` index for the promotion's `active` contracts. Offers and
signed contracts that have not started belong to the contracts screens, not the
roster. A row is keyed on the employment, not the person: push, alignment,
brand, morale and momentum live on the contract, and a person can hold two
contracts with the same human (a promotion and its development territory,
D-07).

| Field                                     | Where it comes from                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `employmentId`, `personId`, `promotionId` | The employment row                                                                                                                  |
| `brandId`, `brandName`                    | The employment's brand and its name; both `null` for a contract on no brand (shared)                                                |
| `group`                                   | `rosterRoleGroupOf(role)`: wrestlers, managers, announcers, referees, producers, others (presenters and bookers)                    |
| `role`, `ringName`, `alignment`, `push`   | The employment row                                                                                                                  |
| `imageRef`, `gender`                      | The person row                                                                                                                      |
| `age`                                     | `ageOn(person, date)`, whole years                                                                                                  |
| `overall`                                 | `overallOf(person, role)` for the contracted role ([role ratings](workers.md#role-ratings)), to 1 decimal, and the `gradeOf` letter |
| `expectedPush`                            | `expectedPush` for the contracted role ([expected push](workers.md#expected-push)); `null` for anyone but a wrestler                |
| `pushGap`                                 | `{ steps, verdict }` from the [push gap](#push-gap) and [verdict](#push-verdict); `null` for anyone but a wrestler                  |
| `popularity`                              | `footprintPopularityValue` among this promotion's fans ([footprint](workers.md#footprint-popularity)), 0 to 100, to 1 decimal       |
| `momentum`                                | `{ value, traceRef }`: the stored momentum, `null` until the first appearance under the contract                                    |
| `morale`                                  | `{ value, traceRef }`: the stored morale                                                                                            |
| `availability`                            | `availabilityOf(person, employment, date)` as `{ status, reason, until }`; `reason` is `null` for someone simply available          |
| `endsOn`                                  | The contract's last day, `null` when open-ended                                                                                     |
| `daysLeft`                                | Days from the date to `endsOn` (`diffDays`), `null` when open-ended                                                                 |

Only wrestlers have push fields. `PUSH_LEVELS` gives crew and managers `none`,
so they have no card position to compare.

`traceRef` points at the trace the [momentum or morale door](workers.md#doors)
stored for that contract (`workers.momentum` or `workers.morale`, keyed by the
employment ID) when the trace store still holds one, and is `null` otherwise.
Overall, expected push, popularity and the push gap are derived on read and
never stored: a query cannot record traces, so their Why? is rebuilt on demand
from the same inputs.

Rows are sorted by group, then card position (main event first), then ring name
in natural order (`Test Name 5` before `Test Name 10`), then employment ID, so
the order is the same on every call.

### Filters and the view

`roster.rows` takes `{ promotionId?, brandId?, group? }`. `brandId` is a brand's
ID or `'shared'` for the contracts on no brand; `group` keeps one section. The
answer is a `RosterView`:

- `promotion`: `{ promotionId, name, brands }` with the promotion's active
  brands, flagship first, or `null` when the roster cannot be shown;
- `unavailableReason`: why there are no rows, written for the player, or `null`;
- `rows`: the rows above.

On a 300-contract roster (the screen's windowed-table threshold) building the
rows takes a few tens of milliseconds in Node.

## Push gap

How many card positions a worker sits below the push they expect:

```
push gap = position now − position expected
```

Positions count down the card from the main event: main event 0, upper card 1,
mid card 2, lower card 3, enhancement 4. A positive gap means they sit lower
than they expect, a negative one higher. A main eventer who expects the mid card
has a gap of −2; an enhancement worker who expects the main event has 4.

`computePushGap({ push, expected })` takes the expected push as WRK1's traced
`expectedPush`, so the expected push's whole Why? sits inside the gap's own
trace. The positions are fixed numbers (the order of the card), not tunables.

## Push verdict

The verdict turns the gap into the marker the roster shows:

| Gap                                | Verdict         | What the player reads          |
| ---------------------------------- | --------------- | ------------------------------ |
| `roster.expectsMoreSteps` or more  | `expectsMore`   | Expects a bigger push          |
| `−roster.expectsMoreSteps` or less | `aboveExpected` | Pushed beyond what they expect |
| Anything in between                | `asExpected`    | Where they expect to be        |

| Key                       | Kind    | Default | Range | Unit  | Meaning                                                                               |
| ------------------------- | ------- | ------- | ----- | ----- | ------------------------------------------------------------------------------------- |
| `roster.expectsMoreSteps` | integer | 1       | 1–4   | count | Card positions below (or above) the push they expect before the roster marks a worker |

The smallest value is 1 on purpose: 0 would mark every row. At 4 only the
extreme case (an enhancement worker who expects the main event, or the
reverse) is marked. `computePushVerdict(gap)` reads the tunable into its trace,
so the Why? names it.

The default world is calibrated so every wrestler starts at the push they
expect: all of Altura's wrestlers start `asExpected`.

## Viewer scoping

The roster is always the viewer's own:

- with no `promotionId`, the query takes the first promotion the viewer runs
  (`viewerPromotionIds`);
- a seat that runs no promotion (a spectator, a computer controller, the
  all-seeing viewer with no `promotionId`) gets no rows and "You don't run a
  promotion yet.";
- a controller asking for a promotion it does not run gets no rows and "You can
  only open your own roster here. Other promotions' workers are under World >
  Workers.";
- the all-seeing viewer (tools, tests, the sandbox) may read any promotion.

A query can only return data, so a refusal is data too: `promotion: null`,
`rows: []` and the reason.

Rows never carry development (potential and ceilings), vices, wages or contract
terms; the contract's end date is the only term shown. Morale is in the row
because the roster is always the viewer's own, and a rival's roster cannot be
read through this query (rivals' workers are on the [workers list](workers.md#workers-list),
which leaves morale out).

## Set push

`roster.setPush { employmentIds, push }` is the one roster edit: it moves one
worker, or a whole selection, to one card position. The single-row menu and the
bulk action both send it; the single-row menu sends one ID. It returns
`{ changed, unchanged }`, both in ascending ID order.

| Argument        | Rule                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------- |
| `employmentIds` | 1 to 300 employment IDs (300: the largest roster the DataTable is built for), no repeats |
| `push`          | A card position, or `none`                                                               |

A malformed or repeated ID, an empty list or more than 300 is `invalidArgs` on
`employmentIds`, before any row is read.

**All or nothing.** Every row is checked before anything changes. Any refused
row refuses the whole call: no row changes and no event is published. The
answer has one reason per offending row, in ascending ID order, each with
`field: 'employmentIds[<index>]'` (the row's place in the arguments) and
`subject: { kind: 'employment', id }`. Each row reports the first rule it fails:

| Code                 | When                                                                      | What the player reads                                                                  |
| -------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `employmentNotFound` | No such contract                                                          | That contract no longer exists. Refresh the roster and try again.                      |
| `notAllowed`         | The issuer does not run the contract's promotion                          | Test Name 3 works for Test Promotion B. You can only change pushes on your own roster. |
| `contractNotActive`  | The contract is not `active` (an offer, signed but not started, or ended) | Test Name 3's contract isn't active (it is expired), so their push can't change.       |
| `pushNotForRole`     | A crew member or manager given a card position                            | Test Name 3 is a referee. Only wrestlers have a place on the card.                     |
| `pushNotForRole`     | A wrestler given `none`                                                   | Pick a card position for Test Name 3, from Main event to Enhancement.                  |

Who runs a promotion is `sameController` on the promotion's `controller`: the
same human, or the computer for a computer-run promotion. The AI uses this same
command for its own rosters (D-01, D-07). Brand controllers (D-06 brand wars)
are not consulted yet; a push is the promotion's call.

**Applying.** Rows go in ascending ID order. A row already at `push` is
`unchanged` and publishes nothing. Every other row goes through the workers
system's [push door](workers.md#doors) with the source `'player'` for a human
and `'ai'` for the computer and the reason key `roster.setPush`; the door
records the `workers.push` trace and publishes `employment.pushChanged`. All
rows change in the command's one transaction, so a failure part way undoes the
rows already changed. `applySetPush(ctx, args, issuedBy, door)` does the work
and takes the door as an argument so a test can make it fail.

**No direct morale effect.** The command writes the push and nothing else: no
morale, momentum, popularity or money. How a worker feels about being moved is
for the features that listen to `employment.pushChanged` (WRK8), so the story
shield for a wrestler losing as part of an angle lives in one place. While WRK8
is not built, a push change moves nothing but the push.

Like every command it is refused with `busy` while days are advancing, and
every attempt (applied, refused or failed) is in the [command log](engine-api.md#the-command-log).
