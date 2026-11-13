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
aired yet stays whatever its age. The daily phase `aip.pruneDecisionLog` runs
it (see [Jobs](#jobs)).

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

The runner does no work for a unit with nothing due: it makes sure the unit
has a profile and moves on, with no turn, no event and no `lastTurnOn` change.
Later jobs add their own shortcuts inside `run` (for example, nothing to
review when the roster has not changed).

## Jobs

Every rival behaviour is a **job**: the weekly roster review (AIP1-05), push
reviews (AIP3), card planning before a show (AIP4), monthly business reviews
(AIP8), hiring (ECO6), brand GM bookings (BRW6). They all run through one
phase, so they visit the promotions in the same order, spread over the week
instead of piling onto one day, and one broken rival never rolls back another
rival's work.

Code: `packages/engine/src/systems/aip/jobs/` and `phases.ts`.

**Adding a job.** One `registerAiJob({ id, cadence, units?, run })` call in the
feature's own system module, with no phase of its own. `id` is an API name
such as `aip.rosterReview`; a duplicate id throws `RegistryError` naming both.
`units` is `promotions` (whole promotions only), `brands` (computer GM brands
only) or `all` (the default). `aiJobs()` lists them sorted by id. A job that
draws random numbers declares its own stream in `streams.ts` (named after the
job), so one job's draws never shift another's.

**The runner.** `aip.runTurns` (group `aiTurns`, order 50, daily, so before
contracts and shows) walks `computerUnits` in key order. For each unit it
calls `ensureProfile` (self-healing: a promotion founded later or a save from
before the rival desk gets its profile on its first turn), then runs each due
job in id order. After the unit's jobs it sets the profile's `lastTurnOn` and
publishes `aip.turnTaken` with the ids of the jobs that ran. Human-controlled
units never run jobs, and a promotion unit's jobs must leave the brands in
`unit.excludedBrandIds` alone (`unitCovers`).

**Cadences.**

| Cadence      | Due on                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `daily`      | every day                                                                                                                        |
| `weekly`     | the unit's weekday: `(toEpochDay(date) - unitOffset(key, 7)) mod 7 = 0`                                                          |
| `monthly`    | the unit's day of the month: `1 + unitOffset(key, 28)`, so 1 to 28 and every month has it                                        |
| `beforeShow` | a day the unit has a `scheduled` or `booked` show (`eventInstances` `byDate`): its promotion's, and for a brand unit its brand's |

`beforeShow` jobs see the day's shows as `job.shows`; they run before the
shows phase (500) runs them. Until a calendar feature stores shows, the
cadence simply never fires.

**Spreading.** `unitOffset(unitKey, modulo)` is `hashString32(unitKey) %
modulo`, the foundation's frozen-output hash (`core/hash.ts`). It is a hash of
the unit's own key and not its position in the list, because a position
shifts whenever a promotion is founded or closes and would move every later
rival's review day; the hash never changes, needs no stored state and draws
no random numbers. `nextDueOn(cadence, unit, from)` gives the first due date
on or after `from` for weekly and monthly jobs (null for the others), so a
screen can say when the next review is; nobody should assume "the 1st of the
month". `isDue(cadence, unit, date, read)` is the runner's own test.

**Savepoints and the buffer.** Each job runs in
`tx.savepoint('aip.job:<jobId>:<unitKey>', ...)`. A savepoint rolls back rows
but not staged events or traces, so the job context's `publish`,
`recordTrace` and `recordDecision` are buffered and handed to the phase's
stagings only when the savepoint returns `ok: true`. A job that throws
therefore changes nothing (no rows, events, traces or decisions); the runner
logs the job, unit and message, publishes `aip.jobFailed` and carries on with
the next job and the next unit. The job context keeps `PhaseContext`'s exact
`publish` and `recordTrace` signatures, so it can be passed straight to the
workers doors (`DoorContext`) and the booking writer.

A rolled-back job has still advanced its random stream. That is
deterministic (same seed, same failure, same draws) and keeps streams simple,
so streams are not snapshotted per job.

**Failure visibility.** A job caught by its savepoint does not fail the
`aip.runTurns` step, so it never reaches the pipeline failure log or the
repeated-failure stop: one broken rival job must not stop the player's skip.
It shows instead in the step's log, as the `aip.jobFailed` event (readable
through `sim.recentEvents`), and in `npm run sim -- --strict`, which fails on
any `aip.jobFailed` (`--fail-on-event` changes the list). A bug in the runner
itself, outside any job, still throws and fails the step as usual.

**Decisions.** `job.recordDecision({ kind, summary, refs?, traced?,
traceKind?, revealOn?, importance? })` refuses a kind nobody registered
(throwing, so the job rolls back), inserts the `aiDecisions` row (`revealOn`
defaults to today, `importance` to 0), stores `traced` summary-only under
`{ kind: traceKind ?? 'aip.<kind>', id: '<unitKey>:<date>:<n>' }` (n counts
the unit's decisions that day) and publishes `aip.decisionRecorded`. It
returns the decision's ID. Setup steps with no job context (AIP2-02's day-one
appointments) call `writeAiDecision(tx, ctx, unit, spec)`, which does the
same. Trace IDs are guessable; who may read them is decided by the queries.

**Decision kinds.** `registerDecisionKind({ kind, chip, icon? })` adds a kind
with the label of its Decision log filter chip (and optionally a Lucide icon
name); a duplicate throws `RegistryError`. `decisionKinds()` lists them by
kind and `decisionKindOf(kind)` looks one up. The rival desk registers
`rosterReview` ("Roster review"); later features register theirs (`push`,
`card`, `title`, `businessReview`, ...) from their own modules.

**Pruning.** `aip.pruneDecisionLog` (group `periodic`, order 42, daily)
deletes expired rows in ID order with the `pruneOnly` delete
([Decision log](#decision-log)). On most days it reads only the rows that can
have expired that day through the indexes: each promotion's rows dated
`today - retentionDays` (`byPromotionDate`) and the rows revealed today
(`byRevealOn`). On the 1st of each month it also sweeps the whole log, which
catches rows a lowered retention left behind.

**What a job must not do.** Write to a human-controlled unit or to a brand in
`excludedBrandIds`; use `Math.random` (use `job.rng(stream)`); read a worker's
hidden `development`; or add a phase of its own.

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
