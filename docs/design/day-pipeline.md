# The day pipeline

Advancing time runs an ordered list of registered **phases**. Each phase is a
named step with its own transaction and error report, so one broken step never
cancels the rest of the day. This doc covers how a day runs and how the parts of
the engine talk to each other while it does.

The phase list, step isolation and multi-day skips get their own sections when
the pipeline itself lands. This first section covers the domain event bus.

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
