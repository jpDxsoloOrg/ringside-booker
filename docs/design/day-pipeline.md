# The day pipeline

Advancing time runs an ordered list of registered **phases**: housekeeping,
world events, AI turns, contracts, shows, growth, money, and the weekly, monthly
and yearly jobs. Each phase is a named step with its own transaction and its
own error report, so one broken step never cancels the rest of the day. This
doc covers how a day runs and how the parts of the engine talk to each other
while it does.

This doc fills in as the pipeline is built. The phase list, step isolation and
multi-day skips get their own sections when the pipeline itself lands. It
starts with the calendar, because every phase needs to answer "do I run
today?" before anything else, and the domain event bus, which is how systems
hear about each other's changes.

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

A phase carries its cadence next to its name and its step function. The phase
registry itself comes with the pipeline, but the shape is:

```ts
const payroll = {
  name: 'money.payroll',
  cadence: defineCadence({ kind: 'weekly', weekday: 'fri' }),
  run: runPayroll,
};
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

Step timings in the day report are the only place the pipeline needs wall-clock
time. The host passes in a `now()` function for that, so the engine itself
still never reads the clock.

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
