# The rival desk

Eleven of the twelve default-world promotions are run by the computer. The
rival desk (the `aip` system) is what acts for them: it decides who to push,
what to book and who to hire, and it remembers what it decided. AIP builds it
in steps. AIP1-01 lays the ground floor described here: which promotions and
brands the computer runs, the profile each one keeps, and the decision log.
Later tickets fill the sections marked "later".

Code: `packages/engine/src/systems/aip/`. Tables: `aiProfiles` and
`aiDecisions` ([data-model.md](data-model.md#rival-desk)).

## Units

A **unit** is what one rival turn acts for. `computerUnits(read)`
(`units.ts`) lists them, sorted by key:

- every `active` or `dormant` promotion whose controller is the computer, as
  a whole (`brandId` null);
- every active brand whose own `controller` is the computer inside a
  promotion the computer does not run (a computer GM brand in a human
  promotion, BRW).

A unit's key is `aiUnitKey(promotionId, brandId)` =
`<promotionId>|<brandId ?? '-'>`. Closed promotions take no turns.

Who runs a brand follows the one rule in
`systems/calendar/control.ts` (`showControllerOf`): the brand's own
controller when it has one, else the promotion's. `unitControllerOf` reuses
it. So:

| Brand's own controller | Promotion's controller | The brand belongs to                                     |
| ---------------------- | ---------------------- | -------------------------------------------------------- |
| null                   | computer               | the promotion's unit                                     |
| computer               | computer               | the promotion's unit                                     |
| human                  | computer               | nobody: it is in the promotion unit's `excludedBrandIds` |
| computer               | human                  | its own unit                                             |
| null or human          | human                  | nobody (the player runs it)                              |

A brand with its own human controller under a computer promotion (a second
seat or a player GM, D-06 and D-07) is off limits: every rival job leaves its
roster, shows and titles alone. `unitCovers(unit, promotionId, brandId)` is
the check jobs use (AIP1-05's `unitRoster` filters with it).

## Profiles

`aiProfiles` holds one row per unit (unique `byUnit` index): its stored
taste, its featured workers and the day of its last turn.

- `taste` is null until AIP2 works it out; until then AIP1-04's `tasteOf`
  falls back to the style default. The eight axes are in `taste.ts`.
- `featured` is null until AIP3 first picks an ace and up to two prospects.
  It stores employment IDs, not person IDs, so a person working for two
  promotions can be featured at one. The shape is final now, so AIP3 needs no
  save change.
- Invariants: a profile's brand belongs to its promotion, and every featured
  employment is in the unit (same promotion, and the same brand for a brand
  unit).

Profiles are made two ways, both through `ensureProfile(tx, read, unit, date)`
(`profiles.ts`), which returns the unit's row or creates a blank one:

1. The new-game step `aip.createProfiles` (order 895, after
   `wld.assignControllers` at 300) gives every computer unit its profile, so
   the human promotion, founded or chosen, gets none.
2. The turn runner (AIP1-03) calls it on every turn, so a promotion founded
   later (DAY8, DAY9) and a save made before the rival desk existed get a
   profile on their first turn.

`profileOf(read, promotionId, brandId)` is the read-only lookup for queries;
it returns null when the unit has no profile yet.

## Decision log

`aiDecisions` is the rival desk's memory of what it decided: one row per
decision, with a templated `summary` (a content key and short params, never a
rendered sentence), capped `refs` (person, employment, title and promotion IDs,
12 of each at most, and one show), a `traceRef` to its Why?, a `revealOn`
date and an `importance` from 0 (routine) to 3 (headline). `kind` is an open
camelCase key (`rosterReview`, later `push`, `card`, `title`, ...), so later
features add kinds through AIP1-03's `registerDecisionKind` with no save
change. `refs.employmentIds` is how AIP3 and AIP8 find a worker's last push,
turn or brand move.

**Never edited, pruned.** The table is `appendOnly: 'pruneOnly'`: the
transaction layer refuses every update (`AppendOnlyError`) but allows a
delete, which is how old rows are pruned. Unlike the ledger, nothing has to
reconcile, so old decisions can go.

**Retention.** `aip.decisionLogRetentionDays` (default 365, 0 keeps none) is
the window. `pruneDecisionLog(tx, today, days)` deletes a row once its date is
on or before `today - days` and it has been revealed; a plan that has not
aired yet stays whatever its age. The turn runner (AIP1-03) runs it once a
day.

**Save size.** Eleven rivals write to the log all year, so a row is kept
small: templated text, capped ID lists, no stored trace body. The Why? behind
`traceRef` is a summary-only trace (POL4-06: rival promotions keep summaries,
the player's promotion keeps full Why? traces). With retention, the table
holds at most a year of rows however long the game runs. Each feature that
adds a decision kind reports the 365-day save size in its ticket.

**Visibility.** Another controller sees a row from its `revealOn` date on (the
day the plan airs; D-07 per-player views). The `byRevealOn` index serves that
filter; the Promotions screens (AIP1-06) read through it.

Indexes: `byPromotion`, `byPromotionDate` (key `<promotionId>|<date>`,
helper `aiDecisionDateKey`) and `byRevealOn`.

## Shortcuts

Later (AIP1-03): when a rival may skip work it doesn't need to do.

## Jobs

Later (AIP1-03): the turn runner, the job registry and each job's own random
stream.

## Taste

Later (AIP1-04): the taste formula. The axes and their screen labels are in
`systems/aip/taste.ts`: Wrestling focus, Entertainment focus, Athletic focus,
Star focus, Talk share, Title focus, Youth focus and Risk appetite, each
0-100.

## Card value

Later (AIP4).

## Needs

Later (AIP1-05).

## Visibility

Later (AIP1-06): what the player sees of each rival and when. See the decision
log's `revealOn` above.
