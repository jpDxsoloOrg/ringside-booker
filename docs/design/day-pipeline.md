# The day pipeline

Advancing time runs an ordered list of registered **phases**: housekeeping,
world events, AI turns, contracts, shows, growth, money, and the weekly, monthly
and yearly jobs. Each phase is a named step with its own transaction and its
own error report, so one broken step never cancels the rest of the day. This
doc covers how a day runs and how the parts of the engine talk to each other
while it does.

It starts with the pipeline itself (how a day runs, how phases are
registered, how steps are isolated and reported), then the calendar, because
every phase needs to answer "do I run today?", and the domain event bus, which
is how systems hear about each other's changes. The last part of "Running a
day" covers multi-day skips and the gates that stop them.

## Running a day

Code: `packages/engine/src/core/pipeline/`. Tests:
`packages/engine/test/core/pipeline/`.

### The day contract

**A day simulates date D in full, then the clock moves to D + 1.**

`runDay(runtime)` reads D from the world metadata (`meta.currentDate`) and
runs these steps, in this order:

1. **`pipeline.open`**, the engine's own step, publishes `day.started`.
2. **Every registered phase** whose cadence matches D and whose condition
   holds, in group-then-order sequence. Every one of them sees the same date D
   in `ctx.date`.
3. **`pipeline.close`**, the engine's other step, sets
   `currentDate: addDays(D, 1)` and `daysSimulated + 1` in one metadata write,
   then publishes `day.ended` with the number of failed steps.

Nothing moves the date before the day's work is done, so every result (a show
rating, the attendance, the money it made) is stamped with the day it
happened on. A loop that moved the date first and then simulated "yesterday"
would put a show and its gate receipts on different days.

`runDay` returns a `DayReport` and never throws for a failing phase. The only
thing it throws for is the close step failing (in practice, the date running
past the last supported year), because the clock would not have moved and
carrying on would simulate the same day again. That throws `InvariantError`.

### Groups

Each phase belongs to a **group**, and each group has a numeric base. A
phase's position in the day is its group's base plus its `order` (a whole
number from 0 to 99), so the day's order never depends on which system
registered first.

| Group          | Base | What belongs here                                                                      |
| -------------- | ---- | -------------------------------------------------------------------------------------- |
| `open`         | 0    | Engine only: `pipeline.open`.                                                          |
| `housekeeping` | 100  | Clearing up from yesterday: expiring offers, finishing leave, healing, birthdays.      |
| `worldEvents`  | 200  | Random world events, off-screen injuries and morale for rival rosters (D-01).          |
| `aiTurns`      | 300  | Computer-controlled promotions and brands making their decisions.                      |
| `contracts`    | 400  | Negotiations, signings, renewals and releases.                                         |
| `shows`        | 500  | Every computer-run show dated today, rated and resolved (the player's run on command). |
| `settlement`   | 600  | What a show earned on the day: tickets, viewers, live merch.                           |
| `growth`       | 700  | Skill and popularity growth and decline, momentum and relationship decay.              |
| `money`        | 800  | Wages, running costs, sponsors and the ledger.                                         |
| `periodic`     | 900  | Weekly, monthly and yearly jobs, and the season end (a daily phase with a condition).  |
| `close`        | 1000 | Engine only: `pipeline.close`.                                                         |

`settlement` sits straight after `shows` so a show's revenue lands on the day
of the show. Groups are 100 apart so a later system can slot in without
anything else being renumbered.

The health system's `housekeeping` phases ([health.md](health.md)):

| Phase                      | Order | Cadence         | What it does                                                                                                                                                          |
| -------------------------- | ----- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health.recovery`          | 10    | daily           | Injuries due back today end (`injury.healed`); then fatigue fades for everyone above 0 (stamina, age and traits count; less after a talking-only show day yesterday). |
| `health.conditionRecovery` | 12    | weekly, Mondays | Damaged body parts heal a little, up to the cap for the worker's age; no rolls, no traces.                                                                            |

The `contracts` group's phase (ECO4-01, see
[contracts.md](contracts.md#lifecycle)):

| Phase                 | Order | Cadence | What it does                                                                                                                                        |
| --------------------- | ----- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts.lifecycle` | 10    | daily   | Due contracts ask the renewal policies and otherwise expire; signed deals whose start date has come become active; then the `afterLifecycle` hooks. |

The `money` group's phases so far (ECO1-03, see
[finances.md](finances.md#payroll)):

| Phase                    | Order | Cadence             | What it does                                                                                     |
| ------------------------ | ----- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `finance.payroll`        | 10    | daily               | One Wages row per open promotion with anyone to pay: monthly payroll × 12 ÷ 365.25, to the cent. |
| `finance.monthlyMedical` | 20    | monthly, on the 1st | One Medical row per open promotion: people under contract × the cost of its medical policy.      |

Both post through `postMoney`, visit promotions in id order, post nothing for
a zero amount and draw no random numbers (only the ledger rows' ids).

The `periodic` group's weekly phases so far, all on Mondays:

| Phase                      | Order | What it does                                                                                                                             |
| -------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `match.momentumDrift`      | 30    | Momentum drifts for workers who did not wrestle that week ([match-aftermath.md](match-aftermath.md#momentum-drift)).                     |
| `office.weeklySnapshot`    | 34    | One promotion history row per active or dormant promotion, then old weeks thinned to one row per month ([office.md](office.md#history)). |
| `match.pruneAftermaths`    | 40    | Each worker keeps only their newest stored aftermaths ([match-aftermath.md](match-aftermath.md#stored-aftermaths)).                      |
| `history.rollUp`           | 41    | History older than `history.keepDetailDays` becomes summaries and monthly totals ([save-format.md](save-format.md#history-retention)).   |
| `health.pruneInjuryDetail` | 44    | The traces of injuries older than `history.keepDetailDays` become summaries; the rows stay ([health.md](health.md#returns)).             |

The rival desk's phases ([rival-desk.md](rival-desk.md#jobs)), both daily:
`aip.runTurns` (`aiTurns`, order 50) runs every due rival job for every
computer unit, `aip.pruneDecisionLog` (`periodic`, order 42) prunes the
rival decision log, and `aip.pruneCardDetail` (`periodic`, order 43) keeps
only a summary of rival card slots older than `history.keepDetailDays`. The
match system's daily `match.prunePhysicalDetail` (`periodic`, order 45) does
the same for the physical toll traces of the player's matches
([physical-toll.md](physical-toll.md#stored-traces)).

On a show day the rival job `aip.bookShow` (a `beforeShow` job, AIP4-05, see
[rival-booking.md](rival-booking.md#show-day)) runs inside `aip.runTurns`, so
every computer-run show dated today is booked (or cancelled) in `aiTurns`,
before `shows.runShows` (`shows`, order 10) runs it with its card. A booked
card that nothing runs (a world without show night) is closed as Not run by
`calendar.closePastShows` (`settlement`, order 90) at the end of the day, with
its segments kept. The player's shows are never touched: the day still stops
on them (`shows.tonight`).

### Registering a phase

A system describes its phase and registers it once, when the engine is built:

```ts
registry.register({
  id: 'money.payroll', // system.camelName, unique
  group: 'money',
  order: 10, // 0 to 99, unique within the group
  cadence: { kind: 'weekly', weekday: 'fri' },
  run: (ctx) => {
    for (const employment of ctx.read.tables.employments.values()) {
      // ... ctx.tx.create('ledgerEntries', { ... }), ctx.publish(...), ctx.recordTrace(...)
    }
  },
});
```

`definePhase` (which `register` calls) checks the id, the group, the order and
the cadence. `register` then throws `PipelineError` when:

- another phase already has the id,
- another phase already holds the same group and order,
- the group is `open` or `close`, or the id starts with `pipeline.` (both are
  the engine's own).

An optional `when: (view) => boolean` turns a phase off for the day without a
cadence, for settings such as "aging disabled" or for the season end check. It
only reads. A `when` that throws counts as a failed step.

The context a phase gets:

| Field         | What it is                                                                          |
| ------------- | ----------------------------------------------------------------------------------- |
| `date`        | D, the day being simulated                                                          |
| `tx`          | The step's transaction. `tx.create(...)` mints the new row's ID from the seeded RNG |
| `read`        | The world as it stands, including the step's own writes (`tx.view`)                 |
| `rng(name)`   | A named random stream                                                               |
| `tunables`    | Every engine tunable, typed by key                                                  |
| `publish`     | Stages a domain event                                                               |
| `recordTrace` | Stages a calculation trace                                                          |
| `log`         | Adds a line to the step's report                                                    |

There is no `ids` handle: the runtime installs the seeded ID minter on the
world, so `tx.create` draws each kind's IDs from its own `ids.<prefix>` stream
(see `determinism.md`). That replaces any ID factory the world was built with,
including the sequential one the test fixtures use.

### No async in phases

`run`, `when` and every reaction are synchronous. A phase that needs to do a
lot of work (computer booking for dozens of promotions) still does it in one
synchronous call. The order of the day is part of the save's determinism, and
an `await` would let the order depend on scheduling. The world's `transact`
rejects a body that returns a promise, and the pipeline never wraps it in
anything async. The UI stays responsive because the engine runs in a Web
Worker and the multi-day loop yields between days, not inside them.

### Step isolation

Every step (the engine's two, each phase, and each command) runs through
one wrapper, `runStep`. Before the step starts it takes an RNG snapshot and
opens an event staging and a trace staging. Then it runs the step inside
`world.transact`.

- **The step returns:** its writes stay, its traces are stored, its events are
  committed (getting their sequence numbers) and then delivered to reactions.
- **The step throws:** the transaction has already undone its writes. The
  wrapper puts the RNG back to the snapshot and discards both stagings. Then
  it records the failure: a `failed` step report with the error, an entry in
  the failure log, and a `pipeline.stepFailed` event published from a fresh
  staging and delivered straight away, so the news feed or a debug panel can
  show it. The rest of the day carries on. A failed command skips the
  `pipeline.stepFailed` notice (`runStep`'s `announceFailure: false`): the
  caller gets the error back directly, and a failed command must leave the
  event log as it was (see [engine-api.md](engine-api.md)).

Restoring the RNG matters as much as rolling back the writes. Without it, a
step that draws three numbers and then crashes would still use them up, and
the next phase on the same stream would get different numbers than it would
have without the crash. Fixing the crash would then change that phase's
results too, and a before-and-after comparison of the fix would be
misleading. With the restore, a failed step changes nothing but the report.

One transaction per step is also what keeps a bad step contained. A single
`try` around several unrelated jobs means one broken job cancels all of them;
here every job has its own.

### Reactions

Committed events are delivered with `bus.dispatch`, which the pipeline hands a
runner. The runner puts each reaction through the same wrapper as a step: its
own transaction, its own RNG snapshot, its own stagings, and the event source
`{ kind: 'reaction', id: subscriberId }`. Reactions get the same context as a
phase (on the event's date).

A reaction that throws loses its own writes, draws, events and traces and
nothing else. The step that published the event keeps its writes, and the
failure is listed on that step's report under `reactionFailures` (subscriber
id, the event's `seq` and the error). It also goes into the failure log as
`reaction:<subscriberId>`. A failed reaction does not count as a failed step.

The reactions to show night so far:

| Reaction                  | Event            | What it does                                                                                                                          |
| ------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `promoPop.applyAfterShow` | `show.completed` | Applies the show's popularity change ([promotion-popularity.md](promotion-popularity.md)).                                            |
| `finance.postShowCosts`   | `show.completed` | Posts the show's appearance fees, travel and catering, player and rival alike, once per show ([finances.md](finances.md#show-costs)). |

### Reports

`runStep` returns a `StepReport`; `runDay` returns a `DayReport` with one
`StepReport` per step, skipped phases included.

| `StepReport` field | Meaning                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| `stepId`, `group`  | The phase (or `pipeline.open`/`pipeline.close`); `group` is null for a command |
| `status`           | `ok`, `failed` or `skipped`                                                    |
| `skippedReason`    | `cadence` (not today) or `condition` (`when` returned false)                   |
| `error`            | The serialised error (`name`, `message`, `code`, `stack`) of a failed step     |
| `eventsPublished`  | Events the step itself committed (0 when it failed)                            |
| `tracesRecorded`   | Distinct traces the step committed (0 when it failed)                          |
| `reactionFailures` | Reactions to its events that failed                                            |
| `logs`             | `ctx.log` lines from the step and its reactions, plus pipeline notes           |
| `timing.ms`        | How long it took, by the host's clock                                          |

The `DayReport` adds the date, `failedCount` (failed steps) and
`eventsPublished` (every event committed during the day, reactions and failure
notices included).

**Two things in a report are not deterministic:** everything under `timing`,
and the `stack` of an error. `deterministicDayReport(report)` strips both, and
it is what tests compare between two runs.

`serializeError` turns anything thrown into plain JSON. Errors keep their
name, message, string `code` and a stack trimmed to 4,000 characters; anything
else thrown becomes `{ name: 'NonErrorThrown', message: String(value) }`.

### The failure log

Day reports go away once the UI has shown them. The `PipelineFailureLog` keeps
the last 100 failures (`{ date, stepId, error }`, oldest dropped first) across
days and is saved with the game, so a bug report can include them.
`pipelineFailureLogStateSchema` validates it on load, and the engine API
registers it with the save format as the `failureLog` part.

### Iteration order

Phases read entities only through the table methods `values()`, `ids()`,
`entries()` and `lookup()`, which always return rows in ascending ID order.
They never iterate a raw `Map`. A `Map` iterates in insertion order, and
insertion order after loading a save is not the order the rows were created
in, so a phase that looped over a `Map` could give different results before
and after a save and load. The runDay tests insert rows in reverse ID order
and check that a phase still sees them in ascending order.

### The runtime

Everything a day needs travels in one `SimRuntime`: the world, the RNG
registry, the tunables, the event bus, the trace store, the phase registry,
the gate registry, the failure log and the host. It also holds
`lastDayReport`, the report of the last day a multi-day advance simulated,
for the status query. That one is not saved. `createRuntime` builds one with
defaults for everything but the world, checks the RNG seed matches the
world's, and
installs the seeded ID minter. The runtime is generic over the table registry,
so the pipeline tests run on a small toy registry instead of the full game
schema.

The host supplies `now()` for step timings and defaults to `() => 0`. Step
timings are the only place the pipeline needs wall-clock time, so the engine
itself never reads the clock.

### Gates

A **gate** is a reason for a multi-day skip to stop by itself because the
player is needed: their show today has no card, a decision is waiting in the
inbox, the date they asked to stop at has come. Code:
`packages/engine/src/core/pipeline/gates.ts`.

**When gates are checked.** At the start of every day of a skip, before that
day is simulated, the first day included. A hit stops the skip with the
world still on that date, so the player books the show before its day runs.
If a gate hits before the first day, the skip returns straight away with
`daysAdvanced: 0` and the reasons, which is how pressing Next Day on an
unbooked show day explains why nothing happened. Gates are not checked after
the last day of a skip; the next skip checks them first anyway.

**Registering a gate.** A system registers its gates once, when the engine
is built, next to its phases:

```ts
runtime.gates.register({
  id: 'shows.tonight', // system.camelName, unique
  label: 'Show night',
  check: (view, date) => {
    const [show] = myShowsOn(view, date); // an indexed lookup, not a table scan
    if (show === undefined) {
      return null;
    }
    return {
      gateId: 'shows.tonight',
      reason: `Tonight: ${show.name}`,
      subject: { kind: 'eventInstance', id: show.id },
      actionHint: 'showNight',
    };
  },
});
```

The real show-day gate is `shows/tonight.ts` (EVT2-09, which replaced EVT2-03's
`booking.showNeedsBooking`): the day stops on every open show of the player's,
and the show runs only when they press Run the show (`shows.runTonight`). See
[show-night.md](show-night.md#the-players-shows).

`defineGate` (which `register` calls) checks the id and the label.
`register` throws `PipelineError` for a duplicate id or for an id starting
with `sim.`, which is kept for the engine's own gates.

The rules for a `check`:

- **It only reads.** It gets a `WorldView` and the date about to be
  simulated. No transaction, no random numbers, no events.
- **It is cheap.** It runs every day of a skip, up to 3,650 times in one
  call, so it uses indexed lookups (`lookup()` on an index, a row by ID)
  rather than walking whole tables.
- **It returns null** to let the day run, or a `GateHit`.

`GateHit` is plain JSON: `gateId`, `reason`, an optional `subject` (an
`EntityRef` the UI can link to) and an optional `actionHint` (the screen route
key, such as `booking` or `inbox`). The pipeline always sets `gateId` to the
gate's own id, and a `check` that throws counts as a hit whose reason names
the gate and the error. A broken gate stops the skip where the player can see
it, instead of letting the skip run past whatever it was meant to catch.

**Writing reasons.** The reason is shown to the player as it is, so write it
for them: say what needs doing and name the thing, with its date when it has
one. "Your show 'Friday Fury' on 2031-03-14 has no card yet", not
"show_unbooked" or "gate hit". One sentence, no ids, no jargon. If there is a
screen where they can fix it, set `actionHint` to its route key so the UI can
offer a button.

**Order and hits.** Gates run in registration order and every hit is
collected. The first hit is the main reason the UI shows; the rest are listed
under it, so a day with an unbooked show and a waiting decision mentions
both.

**`evaluateGates(state, date)`** is the one function that runs the gates. It
takes anything with the runtime's `world` and `gates` and returns every hit in
registration order, or `[]`. It only reads, so the status queries
(`sim.pendingGates`, `sim.status`) call it to say whether Next Day would stop
right now, and the advance loop calls the same function, so the two never
disagree. The skip's own two gates below exist only while a skip runs, so
`evaluateGates` on the runtime reports the registered gates only.

**The built-in gates.** Each advance adds two gates of its own after the
registered ones:

| Gate                  | Hits when                                                                                                        | Reason                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `sim.stopDate`        | The date about to be simulated is the `stopAtDate` the player picked                                             | "Reached the date you asked to stop at"                                             |
| `sim.repeatedFailure` | The same step failed on each of the last `sim.stopSkipAfterConsecutiveFailures` days (default 3) of this advance | Names the step and its last error message, so the player can put it in a bug report |

**The systems' gates.** Registered by the system bundles:

| Gate                      | System | Hits when                                                              | Reason                                                               | Hint        |
| ------------------------- | ------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------- |
| `shows.tonight`           | shows  | The player has an open show today (EVT2-09)                            | "Tonight: Friday Fury", or "Your show 'Friday Fury' has no card yet" | `showNight` |
| `health.ownWorkerInjured` | health | An injury to one of the player's workers waits to be noticed (WRK6-04) | "Big Joe was injured (Sprained ankle, out until Mar 14, 2031)"       | `roster`    |

The hints a gate can carry are the web shell's route keys: `showNight` (the
show screen), `inbox`, `booking` and `roster` (the roster; WRK6-06 lands it on
the Injuries tab or the worker's profile). A hint the shell does not know yet
still gets a button with the gate's own reason.

The failure count is per advance and per step. Two different phases failing on
alternate days, or one phase failing every other day, never trips it; a phase
that fails every day stops a ten-year skip after three days instead of running
silently to the end.

### Multi-day advance

`advanceDays(runtime, options)` runs `runDay` in a loop. Code:
`packages/engine/src/core/pipeline/advance.ts`.

| Option        | What it does                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `maxDays`     | The most days to run: a whole number from 1 to 3,650 (ten years). Anything else throws `RangeError` |
| `stopAtDate`  | Stop at the start of this date. Must be after the current date, or it throws `RangeError`           |
| `signal`      | Anything with a `readonly aborted: boolean`. A host's `AbortSignal` fits                            |
| `yieldToHost` | Awaited once after every day. Defaults to `() => Promise.resolve()`                                 |
| `onDay`       | Called after every day with `{ dayIndex, date, totalDays, failedCount }`; `dayIndex` counts from 1  |

Each turn of the loop:

1. `evaluateGates` for the current date. Any hit stops the loop with
   `{ kind: 'gate', hits }`.
2. `runDay`, which simulates the date and moves the clock on. Its report
   becomes `runtime.lastDayReport`.
3. `onDay(progress)`.
4. `await yieldToHost()`.
5. If `signal.aborted` is set, stop with `{ kind: 'cancelled' }`.

The loop ends with `{ kind: 'completed' }` once `maxDays` days have run. A
signal that is already set before the first day stops it with no days run.
The headless runner calls `advanceDays` again for runs longer than ten years.

The result, `AdvanceResult`, is plain JSON: `startDate`, `endDate` (the first
day not simulated), `daysAdvanced`, `stoppedBy`, `failures` (every failed
step as `{ date, stepId, message }`), `eventsPublished` and `timing.ms`. Like
the day reports, `timing` comes from the host's clock and is left out of
determinism checks. Everything else is deterministic: one 30-day advance and
thirty 1-day advances leave identical state.

### Cancelling and yielding: the host contract

Phases are synchronous, so without a yield a 365-day skip would hold the Web
Worker for its whole length and a Cancel message could never be read. The
loop therefore awaits `yieldToHost()` once after every day, and only between
days:

- **The host decides how to yield.** The Web Worker host posts to a
  `MessageChannel` and resolves when the message comes back, which lets queued
  messages (Cancel) run first. Tests and the headless runner use a resolved
  promise. The engine never uses timers.
- **Cancel by setting the signal.** The loop reads `signal.aborted` after each
  yield. The engine only knows the shape `{ readonly aborted: boolean }`; it
  never names `AbortSignal`, because it is built without the DOM or Node type
  libraries.
- **A cancel always lands between whole days.** Each day finishes, clock
  move included, before the loop yields, so a cancelled skip leaves a world
  that is exactly some number of whole days further on, never half a day.
- **`onDay` runs before the yield,** so a host can post progress and then let
  the UI catch up. It must not change the world; setting the signal from it is
  fine and takes effect after that day.
- **What throws:** bad options (`RangeError`, before anything runs) and the
  rare `InvariantError` from a day that could not close. A failing phase
  never throws; it shows up in `failures` and, if it keeps failing, in the
  `sim.repeatedFailure` gate.

### Fast paths

A long skip spends most of its time on rival show nights, and most of that on
work only the player sees: traces a Why? might open, region previews and
roll-ups of every country on the map. The fast paths (POL4-09) skip or shorten
that work **only where the result is identical**: the same world, the same
stored traces, the same RNG and the same save, byte for byte. Code:
`packages/engine/src/core/fastPaths.ts`.

| Fast path                       | Where                                                                | What it skips                                                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aftermath without region detail | `applySegmentAftermath` (show night's MTCH3 applier)                 | The per-region preview and the country and continent roll-ups of each competitor's change. The applier stores none of them; the popularity door works the regions out as it writes |
| Summary-only record check       | `TraceStaging.record` with `summaryOnly`                             | Validating every node of a tree that is kept only as a summary: the tree is fitted into the size limits as before, then only its root and direct steps are checked                 |
| One-walk record check           | `TraceStaging.record`                                                | `assertJsonValue` plus the load schema's zod parse: `copyValidTraceContent` builds the same copy in one walk, or returns null and the full check runs (and throws) as before       |
| Headline and reach roll-ups     | `headlinePopularityOf` (office), `reachOf` (finance)                 | Rolling up every country and continent to read the home country, the home continent and the world (`popularityRollupPart`)                                                         |
| Card values without traces      | `buildCardPool` (rival booker)                                       | The card value trace of every worker for every show: `cardValueNumber` does the same steps in the same order. A Why? that shows a card value builds it with `cardValue`            |
| Rival wear by body part         | `computePhysicalToll` (MTCH4's applier) on a rival show              | Each body part's wear trace: the same `load × weight` as plain numbers; the show stores only summaries                                                                             |
| Rival-rules injury chance       | `computePhysicalToll` on a rival show under `ai.skipInMatchInjuries` | The injury chance formula: the policy makes it 0, given with its rival-rules line; the roll is still drawn                                                                         |

**Proof.** `setFastPaths(false)` turns them all off, so the engine takes the
full path everywhere. `test/core/fastPaths.test.ts` runs a month of the roster
fixture (every show a rival card) both ways in `npm test` and compares the
tables that carry world effects (popularity, momentum, injuries and fatigue on
`people` and `employments`, titles and reigns, results, money, aftermaths,
decisions), the trace store, the RNG and the world hash; with
`RB_SLOW_TESTS=1` it does the same for 120 days of the default world.
`fastCopy.test.ts` holds the one-walk check to the schema, and the
`cardValue` sweep holds `cardValueNumber` to the traced value to the bit. A
new fast path must read `fastPathsEnabled()` and keep both tests passing; if
it cannot keep the world identical it does not belong here.

**Measured** (365 days, default world, `withMyShowsRun`, dev machine under
other load, wall / CPU, 2026-11):

| Setup                  | Before POL4-09 (AIP5) | After POL4-09   |
| ---------------------- | --------------------- | --------------- |
| No rival cards added   | 22.0 s / 31.6 s       | 9.0 s / 13.8 s  |
| Every show carded      | 28.6 s / 40.1 s       | 11.5 s / 16.9 s |
| Roster fixture (`sim`) | 2.4 s                 | 1.2 s           |

Where a year went before (CPU profile, no rival cards added, about 25 s
sampled): show night 11.1 s, of which the aftermath applier 9.1 s (the
roll-ups alone 5.4 s); recording traces 4.7 s (3.5 s validating them);
reactions to `popularity.changed` 2.5 s (the office's headline Why?, a full
roll-up each time); rival planning and booking 2.0 s; garbage collection
4.6 s. On the roster fixture planning was most of the run, about 12 ms a
show, two thirds of it card value traces. Save sizes did not change (1.15 MB
and 1.46 MB on disk).

## Calendar

Code: `packages/engine/src/core/calendar/`. Tests:
`packages/engine/test/core/calendar/cadence.test.ts`.

### Dates are `GameDate`s

Every date the pipeline sees is a `GameDate` from `core/date.ts`: an ISO
`YYYY-MM-DD` string with integer calendar maths underneath. That module is the
only place that parses dates or does date arithmetic (`addDays`, `weekday`,
`isLastDayOfMonth`, ...). The calendar code builds on those helpers and has no
date type or arithmetic of its own. It never creates a JS `Date`, never reads
the clock and never slices the date string, so a cadence gives the same answer
in every time zone.

The test script proves that last part. After the normal run, `npm test` runs
the cadence tests again under `TZ=Pacific/Kiritimati` (UTC+14) and
`TZ=America/St_Johns` (UTC−3:30 with daylight saving). Each run hashes every
matching date for a set of cadences over 2023–2025 and must produce the same
frozen value.

### Cadence kinds

A **cadence** says how often a job runs. There are four kinds:

| Cadence                                | Runs                                | Described as                    |
| -------------------------------------- | ----------------------------------- | ------------------------------- |
| `{ kind: 'daily' }`                    | every day                           | "every day"                     |
| `{ kind: 'weekly', weekday: 'mon' }`   | one weekday each week               | "every Monday"                  |
| `{ kind: 'monthly', day: 1 }`          | a fixed day, 1 to 28, of each month | "on the 1st of each month"      |
| `{ kind: 'monthly', day: 'last' }`     | the last day of each month          | "on the last day of each month" |
| `{ kind: 'yearly', month: 1, day: 1 }` | one date each year                  | "every year on 1 January"       |

Weekdays are written as short names (`mon` to `sun`) because they read better
in phase definitions and data packs than numbers. `WEEKDAY_NAMES` is the one
mapping between the names and the `Weekday` numbers that `weekday()` returns
(0 = Monday), with `weekdayFromName` and `weekdayName` to convert.

The functions:

- `defineCadence(cadence)` checks a cadence and returns a frozen copy.
- `matchesCadence(date, cadence)` says whether the job runs on that date.
- `nextOccurrence(from, cadence)` gives the first date on or after `from` when
  it runs, for report lines like "next payroll on 2024-03-29". It looks at most
  366 days ahead, which covers every valid cadence.
- `describeCadence(cadence)` gives the plain-English text above, for day
  reports and traces.
- `cadenceSchema` is the zod schema for cadences in data packs and saved
  schedules. It runs the same checks as `defineCadence` and rejects unknown
  fields, so a misspelt key fails instead of being ignored.

### Why days 29–31 and 29 February are rejected

A monthly job "on the 31st" sounds reasonable and quietly doesn't run in seven
months of the year. On the 30th it misses February; on the 29th it misses
February three years in four. Nothing crashes. The job just doesn't happen, and
you find out months later when the books don't add up. Yearly jobs on
29 February have the same problem, skipping three years out of four.

Rolling the date over (the 31st becomes the 30th in April) would be a guess
about what the author meant: maybe "end of month", maybe "around the 30th". So
the calendar doesn't guess. A monthly day has to be 1 to 28, which exists in
every month, or `'last'`, which says "end of month" outright. A yearly date has
to exist in a common year. Anything else throws `InvalidCadenceError` (code
`INVALID_CADENCE`) when the cadence is defined, and the message names the bad
field:

```
Invalid cadence: monthly.day must be a whole number from 1 to 28, or 'last' for
the final day of the month (...), got 31
```

`matchesCadence`, `nextOccurrence` and `describeCadence` run the same check, so
a cadence built by hand without `defineCadence` still can't skip days silently.

### How a phase declares its cadence

A phase carries its cadence next to its id and its step function (see
"Registering a phase" above):

```ts
registry.register({
  id: 'money.payroll',
  group: 'money',
  order: 10,
  cadence: { kind: 'weekly', weekday: 'fri' },
  run: runPayroll,
});
```

Each day the pipeline calls `matchesCadence(currentDate, phase.cadence)` and
skips the phase when it returns false. `describeCadence` and `nextOccurrence`
give the day report its schedule lines, such as "Payroll: every Friday, next on
2024-03-08".

Some schedules aren't cadences:

- **Seasons.** Season length is chosen per game (D-08), so a season boundary
  doesn't land on a fixed weekday or day of the month. The `seasonEnd` phase
  uses a `daily` cadence with a condition that compares the current date to the
  active season's end date.
- **Event recurrence.** "Every other week" and tour schedules belong to the
  event calendar, which expands its own recurrence rules on top of the same
  `core/date.ts` helpers.

## Domain events

Systems announce what happened (`match.completed`, `title.changed`,
`contract.signed`, `worker.injured`, ...) without knowing who listens. News,
the social feed, achievements and later mods react to those events instead of
reaching into other systems.

The bus runs inside the engine, so it behaves the same for the player's shows
and rival shows, in tests, in the headless balance runner and inside the Web
Worker. There is no "background" mode where events go quiet: if a rival
promotion's title changes hands during a skip, every listener hears about it.

Code: `packages/engine/src/core/events/` and `packages/engine/src/core/json.ts`.

### Naming

Event types are `noun.pastTenseVerb`, dot separated, in camelCase segments:
`match.completed`, `title.changed`, `pipeline.stepFailed`. The noun is the
thing that changed and the verb says what happened to it, in the past tense,
because an event is a fact about something that already happened. Commands are
the imperative ones (`bookSegment`); events never are.

The runtime pattern is `^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$`.

### Payload rules

- **IDs and small primitives only.** A `title.changed` payload carries the
  title ID and the two holder IDs, never a copy of the title or the wrestlers.
  A listener that wants the title's name reads it from the world. Copies go
  stale, bloat the save and tempt listeners to treat them as the truth.
- **Plain JSON.** Payloads are saved in the recent-event log and cross the
  worker boundary, so they must survive `JSON.stringify` unchanged. With the
  bus's `debugChecks` option on (the default, and always on in tests),
  `publish` runs `assertJsonValue` on the payload and throws
  `NotSerialisableError` with the first bad path, for example
  `events.title.changed.holders is not serialisable: it is a Map`.
- **Frozen.** A payload is frozen when it is published, so build a fresh object
  for each event rather than passing in one you mean to keep changing.

`core/json.ts` is the one serialisability check in the engine. It accepts null,
booleans, finite numbers (`-0` included), strings, and arrays and plain objects
of those. It rejects functions, `Map`, `Set`, `Date`, class instances,
`undefined`, array holes, `NaN`, `Infinity`, `bigint`, symbols and circular
references. Trace helpers and the save writer use the same check.

### Staging

Events never go straight to listeners. A step or command opens a **staging**:

```ts
const staging = bus.stage({ kind: 'phase', id: 'titles.defences' }, date);
staging.publish('title.changed', { titleId, newHolderId, previousHolderId });
// ... the step finishes without throwing:
const events = staging.commit();
```

If the step throws, the pipeline rolls back its writes and calls
`staging.discard()`. Nothing staged is delivered. Without this, a step that
publishes `title.changed` and then fails would roll the title back but still
produce news about a title change that never happened.

Sequence numbers are handed out at **commit**, in publish order. A discarded
staging uses up no numbers, so the same run always numbers its events the same
way. The bus's last sequence number is saved with the game, so numbering
carries on across save and load.

Each event records its `source`: the phase, command or reaction that published
it, and the game date it happened on.

### Delivery order

`bus.dispatch(events, runReaction)` delivers committed events to the
**reactions** (subscribers):

1. Events are delivered in the order given, which is `seq` order.
2. For each event, the matching subscribers run in priority order, lowest
   first (default 0). Equal priorities run in registration order.
3. A subscriber to `'*'` receives every event type.
4. Every subscriber has a unique id. Registering a second subscriber with the
   same id throws.

Handlers are synchronous. An async handler would make the order depend on
scheduling, and determinism would go with it.

### Reactions and observers

**Reactions** can change the world. Each one runs through a runner the
pipeline injects:

```ts
type ReactionRunner<ReactionContext> = (
  subscriberId: string,
  run: (ctx: ReactionContext) => void,
  event: AnyDomainEvent,
) => ReactionOutcome;
```

The runner opens a transaction and a staging for that reaction, calls
`run(ctx)` with a context such as `{ tx, rng, tunables, date, publish }`,
then commits both, or rolls both back if the handler threw. A broken news
generator loses its own writes, not the match result that triggered it. The
failure is reported with the subscriber id and the event's `seq`, and every
other reaction still runs.

The context is a type parameter of the bus (`EventBus<ReactionContext>`), so
the bus itself knows nothing about the world's transaction type.

**Observers** are read-only listeners: the headless runner's log, and later
the UI forwarder in the Web Worker. They:

- run after all reactions for the batch, and see every event of it in `seq`
  order, including the ones reactions published;
- get frozen events and no context, and any attempt to stage, publish or
  dispatch while observers run throws;
- are caught when they throw, and reported without touching the world.

### Cascade limit

A reaction can publish events of its own, through `ctx.publish`. Those are
collected and delivered in the next round, breadth first, so every reaction to
one event finishes before any reaction to the events it caused.

A dispatch runs at most `sim.maxEventCascadeDepth` rounds (default 8). Round 1
delivers the events passed in. Events published in the last allowed round are
still committed and logged, because the reactions that published them did
commit, but no reaction receives them. The dispatch report lists their types
and sequence numbers under `dropped`, so a reaction that triggers itself stops
with a report instead of looping forever.

### The recent-event log

The bus keeps the newest `sim.eventLogSize` committed events (default 500) in
a ring buffer. `bus.recent({ limit, types })` returns them oldest first,
optionally filtered by type; filtering by type narrows the result type. A size
of 0 keeps nothing, while sequence numbers still advance.

The saved state is:

```json
{
  "version": 1,
  "seq": 1042,
  "recent": [
    {
      "type": "day.started",
      "seq": 1041,
      "date": "2026-01-05",
      "source": { "kind": "phase", "id": "housekeeping" },
      "payload": { "date": "2026-01-05" }
    }
  ]
}
```

`eventBusStateSchema` (zod) validates it on load: the version, increasing
sequence numbers no higher than `seq`, well-formed event types and dates, and
payloads that are plain JSON. Which payload belongs to which event type is only
known at compile time, so the payload's shape is not checked on load.

### Adding events for a system

Event types live in one typed map, `DomainEventMap`, but nobody edits a central
list. Each system declares its own events next to its own code by declaration
merging:

```ts
// packages/engine/src/systems/titles/events.ts
import type { PersonId, TitleId } from '../../core/ids';

declare module '../../core/events/types' {
  interface DomainEventMap {
    'title.changed': {
      titleId: TitleId;
      newHolderId: PersonId;
      previousHolderId: PersonId | null;
    };
  }
}
```

After that, `staging.publish('title.changed', ...)` type-checks its payload,
and a misspelt type or a wrong payload is a compile error.
`bus.subscribe('title.changed', handler, { id: 'news.titleChanges' })` gives
the handler a fully typed event, and a `'*'` handler can narrow by checking
`event.type`.

The core events the bus starts with:

| Event                 | Payload                         | Published when                       |
| --------------------- | ------------------------------- | ------------------------------------ |
| `day.started`         | `date`                          | The pipeline starts a day            |
| `day.ended`           | `date`, `failedSteps`           | The pipeline finishes a day          |
| `pipeline.stepFailed` | `stepId`, `message`             | A step threw and was rolled back     |
| `tunables.changed`    | `key`, `value` (null = default) | A tunable override is set or cleared |

Systems add their own next to their code. The calendar's
([calendar.md](calendar.md)):

| Event                      | Payload                                            | Published when                                            |
| -------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| `show.scheduled`           | `eventInstanceId`, `promotionId`, `date`           | The daily horizon phase stores a new show                 |
| `show.cancelled`           | `eventInstanceId`, `promotionId`, `date`, `reason` | A show's day ends with it still open, or it is called off |
| `calendar.horizonExtended` | `from`, `through`, `created`                       | A new game stores its opening schedule                    |

The workers system's events, one per [door](workers.md#doors). Each payload
also carries `source` (`player`, `ai` or `system`) and `reasonKey`:

| Event                         | Payload                                                                   | Published when                                                |
| ----------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `employment.pushChanged`      | `employmentId`, `personId`, `promotionId`, `from`, `to`                   | A worker's card position changes                              |
| `employment.alignmentChanged` | `employmentId`, `personId`, `promotionId`, `from`, `to`                   | A worker turns                                                |
| `employment.roleChanged`      | `employmentId`, `personId`, `promotionId`, `from`, `to`                   | A worker's job with the promotion changes                     |
| `popularity.changed`          | `subjectKind`, `subjectId`, `worldBefore`, `worldAfter`, `regionsChanged` | A person's or promotion's popularity changes in a region      |
| `momentum.changed`            | `employmentId`, `personId`, `promotionId`, `before`, `after`              | A worker's momentum changes (`before` is null the first time) |
| `morale.changed`              | `employmentId`, `personId`, `promotionId`, `before`, `after`              | A worker's morale changes                                     |

The health system's events ([health.md](health.md#injuries)):

| Event              | Payload                                                                                            | Published when                                              |
| ------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `fatigue.cleared`  | `personId`                                                                                         | A person's fatigue reaches 0                                |
| `injury.sustained` | `personId`, `injuryId`, `kindKey`, `bodyPart`, `severity`, `expectedReturn`, `source`, `segmentId` | `health.injure` hurts someone (`segmentId` null off screen) |
| `injury.healed`    | `personId`, `injuryId`, `kindKey`, `daysOut`                                                       | `health.recovery` brings someone back on their return date  |

The booking system's events ([booking.md](booking.md#commands)):

| Event          | Payload                                                            | Published when                   |
| -------------- | ------------------------------------------------------------------ | -------------------------------- |
| `card.changed` | `eventInstanceId`, `promotionId`, `brandId`, `segmentId`, `change` | A booking command changes a card |

The shows system's events ([show-night.md](show-night.md#events)):

| Event               | Payload                                                                                                                                                                                | Published when                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `segment.completed` | `segmentId`, `eventInstanceId`, `promotionId`, `brandId`, `kind`, `slot`, `preShow`, `winnerIds`, `loserIds`, `drawIds`, `storylineIds`, `titleIds`, `finishKey`, `methodKey`, `score` | A segment is run and rated on show night  |
| `show.completed`    | `eventInstanceId`, `promotionId`, `brandId`, `date`, `importance`, `score`, `rawScore`, `offscreen`, `segmentCount`                                                                    | A show is run, on screen or off it        |
| `title.changed`     | `titleId`, `promotionId`, `fromReignId`, `toReignId`, `segmentId`, `eventInstanceId`, `newHolderIds`, `previousHolderIds`                                                              | A title changes hands in a segment        |
| `title.defended`    | `titleId`, `promotionId`, `reignId`, `segmentId`, `eventInstanceId`, `defences`                                                                                                        | A champion keeps their title in a segment |

The finance system's events ([finances.md](finances.md#postmoney)):

| Event                   | Payload                                                      | Published when                                            |
| ----------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| `finance.moneyPosted`   | `promotionId`, `ledgerEntryId`, `category`, `amount`, `date` | `postMoney` writes a row for a human-controlled promotion |
| `finance.policyChanged` | `promotionId`, `area`, `from`, `to`                          | A promotion changes a spending policy (ECO1-04)           |

The contracts system's events ([contracts.md](contracts.md#end-employment)),
money in cents:

| Event               | Payload                                                                         | Published when                                                   |
| ------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `contract.started`  | `employmentId`, `personId`, `promotionId`                                       | A signed contract reaches its start date                         |
| `contract.expired`  | `employmentId`, `personId`, `promotionId`, `reasonKey`                          | An active contract runs out (`contracts.endDate`)                |
| `contract.released` | `employmentId`, `personId`, `promotionId`, `severance`, `source`, `mutual`      | A promotion releases a worker, or withdraws a signed future deal |
| `contract.quit`     | `employmentId`, `personId`, `promotionId`, `how`, `severance`                   | A worker leaves: granted release, walk-out or exclusive deal     |
| `contract.renewed`  | `employmentId`, `personId`, `promotionId`, `previousEndsOn`, `endsOn`, `source` | A renewal policy moves a contract's end date later               |

The rival desk's events ([rival-desk.md](rival-desk.md#jobs)):

| Event                  | Payload                                                                        | Published when                                               |
| ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `aip.turnTaken`        | `promotionId`, `brandId`, `date`, `jobIds`                                     | A computer unit had at least one rival job due and ran it    |
| `aip.decisionRecorded` | `decisionId`, `promotionId`, `brandId`, `kind`, `revealOn`, `importance`       | A rival job records a decision in the decision log           |
| `aip.jobFailed`        | `jobId`, `promotionId`, `brandId`, `message`                                   | A rival job threw and its savepoint rolled it back           |
| `aip.cardBooked`       | `eventInstanceId`, `promotionId`, `brandId`, `segmentCount`, `titleMatchCount` | `aip.bookShow` booked a computer-run show's card on show day |

The promotion popularity system's events ([promotion-popularity.md](promotion-popularity.md#after-every-show)):

| Event                    | Payload                                                                                                        | Published when                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `showPopularity.changed` | `eventInstanceId`, `promotionId`, `worldBefore`, `worldAfter`, `regionsGained`, `regionsLost`, `regionsCapped` | A completed show's popularity change is applied |
