# The engine API

The web app never touches the World. Neither does the headless runner, and
neither will mods. They all go through one object, the **engine**, which
`createEngine` builds from a saved state and a list of system bundles. The
engine offers three things:

- **Queries**: read-only views shaped for one screen ("the roster table", "the
  top bar"). Plain JSON in, plain JSON out.
- **Commands**: intent-based changes ("set this tunable", later "book this
  segment", "offer this contract"). Each one is validated and then either
  fully applied or rejected with reasons.
- **Time**: `advanceDays` runs the day pipeline until the days run out, a gate
  stops it, or the player cancels.

Code: `packages/engine/src/core/api/`. Tests: `packages/engine/test/core/api/`.

## The shape of it

```ts
const engine = createEngine({ state: initialEngineState(world), systems: defaultSystems });

const me: Controller = { kind: 'human', playerId: 'player-1' };
const status = engine.query('sim.status', {}, { kind: 'controller', controller: me });
const result = engine.command('tunables.setOverride', { key: 'sim.eventLogSize', value: 200 }, me);
const advance = await engine.advanceDays({ maxDays: 7 });
const save = engine.exportState();
```

| Member                          | What it does                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `query(name, args, viewer)`     | Runs a query for a viewer. Returns `{ ok: true, data }` or reasons.               |
| `command(name, args, issuedBy)` | Runs a command for a controller and logs it. Returns data and events, or reasons. |
| `queryRaw` / `commandRaw`       | The same with untyped parts, for messages that arrive from the main thread.       |
| `advanceDays(options)`          | SIM-09's multi-day advance. Returns an `AdvanceResult`.                           |
| `onEvent(listener)`             | A read-only observer of every committed event. Returns an unsubscribe.            |
| `exportState()`                 | The whole game as plain JSON (`EngineState`).                                     |
| `loadIssues`                    | Tunable overrides in the state that were dropped on the way in.                   |

Nothing a caller sends makes the engine throw. Bad arguments, a malformed
viewer or controller, an unknown name, a rule that says no, or a bug inside a
query or command all come back as `{ ok: false, reasons }`. The two
exceptions are deliberate and happen before any game is running or while time
is moving: `createEngine` throws for a broken state or a bad bundle, and
`advanceDays` rejects for options it cannot run with (or while another
advance is running).

## Queries vs commands

A **query** reads. It gets a `QueryContext` with the world as a read-only
view, the viewer, the tunables, the trace store, the recent events, the gates,
the last day report, the failure log and the command log. It never gets a
transaction, so it cannot change anything, and calling it twice in a row gives
the same answer.

A **command** changes things, and says what it wants rather than how. "Set
this tunable" is a command; "write 0 to row X" is not. The engine decides
whether it is allowed and why not. The same path will carry the computer's
decisions too, so people and AI play by one rule set.

Anything that changes the world is a command. Anything a screen shows is a
query. A screen that needs a number the engine doesn't expose gets a new
query, never a peek at the World.

## Naming

Names are dot-separated camelCase words with the area first:

- queries are `area.noun`: `sim.status`, `sim.pendingGates`, `tunables.list`,
  `trace.get`. (`clock.get` reads best as a verb and is the one exception.)
- commands are `area.verb`: `tunables.setOverride`,
  `tunables.clearOverride`, later `booking.addSegment`.

The area is usually the system's own id, but it doesn't have to be: the
engine's own bundle (`sim`) owns `clock.*`, `trace.*` and `tunables.*` too.
`defineQuery` and `defineCommand` check the pattern; `createEngine` refuses two
bundles that use the same name.

## Adding a query or a command

Each system declares its queries and commands next to its own code, in three
steps.

**1. Declare the types** by merging into `QueryMap` and `CommandMap`. Each
entry is `{ args; result }`:

```ts
// packages/engine/src/systems/roster/api.ts
declare module '../../core/api/maps' {
  interface QueryMap {
    'roster.rows': { args: { promotionId: PromotionId }; result: RosterRow[] };
  }
  interface CommandMap {
    'roster.release': { args: { employmentId: EmploymentId }; result: { severance: Cents } };
  }
}
```

That is what makes `engine.query('roster.rows', ...)` typed: an unknown name
or a wrong argument shape is a compile error, and `data` has the declared
result type.

**2. Define them** with a zod schema for the arguments:

```ts
export const rosterRows = defineQuery('roster.rows', {
  args: z.strictObject({ promotionId: zId('promotion') }),
  run: (ctx, args) => buildRosterRows(ctx.read, args.promotionId, ctx.viewer),
});

export const releaseWorker = defineCommand('roster.release', {
  args: z.strictObject({ employmentId: zId('employment') }),
  validate: (read, args, issuedBy) => releaseReasons(read, args.employmentId, issuedBy),
  apply: (ctx, args) => releaseEmployment(ctx, args.employmentId),
});
```

**3. Add them to the system's bundle** and the bundle to `defaultSystems` in
`packages/engine/src/systems/index.ts`:

```ts
export const rosterSystem = defineSystem({
  id: 'roster',
  phases: [contractExpiryPhase],
  gates: [expiringContractsGate],
  subscriptions: [onTitleChanged],
  queries: [rosterRows],
  commands: [releaseWorker],
});
```

Tests can declare their own entries the same way, merging into
`'@ringside/engine'` (see `test/core/api/apiTestSystem.ts`).

## How a command runs

1. **The controller** is checked against `ControllerSchema`. A malformed one is
   refused with `invalidArgs` reasons under `issuedBy` and is not logged,
   because the log names who issued each command and nobody valid did.
2. **The arguments** are parsed with the command's schema. Bad ones come back
   as `invalidArgs` reasons, one per problem, each naming its `field`
   (`amount`, `types[2]`, `ref.kind`).
3. **`validate(read, args, issuedBy, env)`** returns every reason the command
   is not allowed right now. Any reason rejects the command before a
   transaction is opened. `env.tunables` is the save's tunable reader, for a
   rule built on a tunable (`booking.lockCard` runs the booking checks here).
4. **`apply(ctx, args, issuedBy)`** runs as one pipeline step through
   `runStep`, with the event source `{ kind: 'command', id: name }` and the
   step id `command:<name>`. It gets a `CommandContext`: a normal step context
   (transaction, RNG streams, `publish`, `recordTrace`) plus `issuedBy` and
   `tunableOverrides`.
5. **If `apply` throws**, its writes, RNG draws, events and traces are rolled
   back, the error goes into the failure log under `command:<name>`, and the
   caller gets one `internal` reason. Unlike a failed phase, a failed command
   does not publish `pipeline.stepFailed`: the caller already has the error,
   and a failed command leaves the event log exactly as it was.
6. **If it returns**, the step commits, its events are delivered to reactions,
   and the caller gets `{ ok: true, data, events }`. `events` lists the
   events the command itself committed, `{ type, seq }`, in order. Events its
   reactions published are not in the list; `onEvent` sees them all.

Commands are all-or-nothing: a rejected or failed command leaves the world,
the RNG, the events and the traces exactly as they were.

Commands are refused with `busy` while `advanceDays` is running. The advance
yields between days so the UI stays responsive, and a command landing between
two days of a skip would make the result depend on timing. Queries still work
during an advance.

## Reasons

```ts
interface Reason {
  code: string; // invalidArgs, notAllowed, internal, unknownQuery, busy, or a system's own
  message: string; // shown to the player as it is
  field?: string; // the argument it is about
  subject?: EntityRef; // the entity it is about, so the UI can link to it
}
```

`message` is written for the player: "Tunable "sim.traceRetentionPerKind"
must be at most 5000, got 999999." rather than a stack trace. Validation is a
first-class, tested step, not something that fails quietly inside `apply`.

The built-in codes:

| Code             | When                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| `invalidArgs`    | Arguments, viewer or controller don't match their schema              |
| `unknownQuery`   | No query has that name                                                |
| `unknownCommand` | No command has that name                                              |
| `notAllowed`     | The controller may not do this                                        |
| `busy`           | A command arrived while `advanceDays` was running                     |
| `internal`       | A query or command threw, or returned something that isn't plain JSON |

### Refusing a query

A command says no in `validate`. A query has no such step: its `run` only
returns data. When a query has to refuse (the person it was asked about does not
exist, say), it calls `refuseQuery` with a reason of its own:

```ts
run: (ctx, args) => {
  const person = ctx.read.tables.people.get(args.personId);
  if (person === undefined) {
    return refuseQuery({ code: 'notFound', message: 'No such worker' });
  }
  // ...
};
```

`refuseQuery(reason | reasons)` never returns. It throws a `QueryRefusal`, an
error that carries the reasons, and `engine.query` hands them back as
`{ ok: false, reasons }` exactly as given. That is not a bug, so it is not
reported as `internal` and nothing is written to the failure log. Any other
throw from a query is still `internal`.

Use it for "there is nothing to show and here is why". A query that has an
empty answer (no rows, `null` for an optional detail) should return that
instead. Both `refuseQuery` and `QueryRefusal` live in `core/api/result.ts`
and are exported from `@ringside/engine`.

## Controllers, viewers and the command log

Following design decision D-07, nothing in the engine assumes a single player.

- **`Controller`** is defined once, in `model/controller.ts` (FND-07), as a
  human (`{ kind: 'human', playerId }`) or the computer. The API re-exports
  it; there is no second definition.
- **Every command names the controller that issued it.** `apply` and
  `validate` receive it, so a rule like "only the promotion's own controller
  may book its shows" is one comparison.
- **Every query runs for a `Viewer`**: `{ kind: 'controller', controller }`
  or `{ kind: 'omniscient' }`. The omniscient viewer is for tools, tests and
  the sandbox setting. Each system decides what a viewer may see of its own
  data (rival finances, offers to other promotions' workers). The engine
  passes the viewer through; it doesn't filter for the system.
- **Which promotion a human runs** is only ever read from the `controller`
  field of the promotion rows, which the new-game command (WLD-10) sets.
  `viewerPromotionIds(read, viewer)` returns them in ascending ID order; a
  computer controller or the omniscient viewer runs none. The engine never
  stores or reads a global "player promotion".

UI-08's worker host injects the local viewer and controller into every call,
so screens never pass them by hand.

### The command log

Every command the engine is asked to run is logged, whatever happened to it:

```ts
interface CommandLogEntry {
  seq: number; // log-wide order, carries on across save and load
  date: GameDate;
  issuedBy: Controller;
  name: string;
  args: JsonValue; // as parsed, or as sent when they were refused
  outcome: 'applied' | 'rejected' | 'failed';
  reasonCodes: string[];
}
```

Rejected and failed commands are kept too, so a bug report shows what someone
tried as well as what worked. The log keeps the newest `sim.commandLogSize`
entries (0 keeps none, though `seq` still counts) and is saved as the
`commandLog` state part. The `sim.commandLog` query reads it.

## The built-in system

`simSystem` is the engine's own bundle and always comes first in
`defaultSystems`.

| Query               | Args                | Returns                                                   |
| ------------------- | ------------------- | --------------------------------------------------------- |
| `clock.get`         | `{}`                | `{ date, weekday, dayNumber }` (day 1 is the start date)  |
| `sim.status`        | `{}`                | Date, active season, the viewer's promotion (see below)   |
| `sim.pendingGates`  | `{}`                | `{ date, hits }`: today's gate hits, without advancing    |
| `sim.lastDayReport` | `{}`                | The last simulated day's `DayReport`, or null             |
| `sim.recentEvents`  | `{ limit, types? }` | The newest events from the recent-event log, oldest first |
| `sim.failures`      | `{ limit }`         | The newest pipeline failures                              |
| `sim.commandLog`    | `{ limit }`         | The newest command log entries                            |
| `trace.get`         | `{ ref }`           | A full trace, a summary, or null                          |
| `tunables.list`     | `{ category? }`     | One row per tunable, with its value and whether it's set  |

| Command                  | Args             | Does                                              |
| ------------------------ | ---------------- | ------------------------------------------------- |
| `tunables.setOverride`   | `{ key, value }` | Sets an override and publishes `tunables.changed` |
| `tunables.clearOverride` | `{ key }`        | Removes one, so the default applies again         |

Commands other systems add:

| Command               | Args                  | Does                                                                                                       |
| --------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `calendar.cancelShow` | `{ eventInstanceId }` | Calls off a show the issuer controls and publishes `show.cancelled` ([calendar.md](calendar.md#lifecycle)) |

Queries other systems add:

| Query                 | Args                                                                                             | Returns                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `condition.fatigue`   | `{ personId }`                                                                                   | A person's fatigue and the trace behind it, or null                                                                                                     |
| `calendar.range`      | `{ from, to, scope, promotionId?, brandId? }`                                                    | `{ today, horizonEnd, shows }`: the stored shows in the window ([calendar.md](calendar.md#range))                                                       |
| `calendar.projected`  | `{ from, to, scope, promotionId?, brandId? }`                                                    | `{ today, projectionEnd, shows }`: shows past the horizon, worked out on read ([calendar.md](calendar.md#projection))                                   |
| `calendar.show`       | `{ eventInstanceId }`                                                                            | One show's row, placement trace and recurrence wording, or null ([calendar.md](calendar.md#one-show))                                                   |
| `calendar.nextShow`   | `{ scope? }`                                                                                     | `{ show, daysUntil }` for the first open show from today, or null ([calendar.md](calendar.md#the-next-show))                                            |
| `match.preview`       | `{ kind, typeKey, sides, slotRole, importance, regionId, televised, promotionId?, previewSeed }` | One rated segment with every trace inline, never written and rolled on a detached stream ([match-rating.md](match-rating.md#previews))                  |
| `match.previewBatch`  | The preview arguments and `runs` (1–500)                                                         | Statistics, a 20-bin score histogram and a quarter-star count over the runs ([match-rating.md](match-rating.md#previews))                               |
| `match.labOptions`    | `{}`                                                                                             | The Match lab's regions, event sizes, the viewer's promotion and defaults ([match-rating.md](match-rating.md#previews))                                 |
| `match.labWorkers`    | `{ scope, regionId, search?, limit?, promotionId? }`                                             | `{ rows, total }`: the lab's worker picker, nothing hidden ([match-rating.md](match-rating.md#previews))                                                |
| `match.simulate`      | The preview arguments and `{ winner, finishKey, methodKey? }`                                    | The resolved result (winner, finish, method, names, trace) and the preview rated with the finish ([match-finishes.md](match-finishes.md#simulate))      |
| `match.simulateBatch` | The Simulate arguments and `runs` (1–500)                                                        | The preview batch's statistics plus wins per side, draws, no contests and finish counts over the runs ([match-finishes.md](match-finishes.md#simulate)) |
| `match.resultMode`    | `{}`                                                                                             | `{ randomWinners }` for the viewer's first promotion ([match-finishes.md](match-finishes.md#simulate))                                                  |

The calendar queries share one row, `CalendarShow`. `scope` is `mine` or
`world`; a window may cover at most 366 days and is refused with
`invalidArgs` on `to` otherwise. See [calendar.md](calendar.md#queries).

### The status and pending-gate queries

The top bar (UI-10) renders these two and nothing else.

`sim.status` returns the date, the active season (`{ number, endDate }`, or
null before season 1 exists) and the viewer's promotion at a glance:

```ts
promotion: {
  promotionId, name, cash,
  popularity: { homeRegionId, homeRegion, prestige, traceRef },
} | null
```

The promotion is the first one `viewerPromotionIds` returns, read straight
from its row: `cash`, popularity in its home region (0 when it has none
there) and `prestige`. There are no formulas here. `traceRef` stays null
until a popularity epic records popularity traces, and richer status (a
population-weighted roll-up, morale) gets added by the epics that own it. The
omniscient viewer, a computer controller and a human who runs no promotion
get `promotion: null`.

`sim.pendingGates` runs every registered gate for today with
`evaluateGates`, the same function the multi-day advance calls before each
day, so the two can never disagree. It doesn't advance or change anything.
This is what turns the Next Day button into "Go to show" or "2 decisions
waiting".

### Tunables

`tunables.setOverride` is checked by the same `validateOverride` a save load
uses, and a refused value comes back with the tunable's own message and its
problem as the code (`aboveMax`, `notInteger`, `unknownKey`, ...). A value of
0 is a real value. The change takes effect for every step that runs after the
command, including the reactions to its own `tunables.changed` event. The
trace store's limits and the command log's size follow it straight away; the
event log's size and the cascade depth are fixed when the engine is built, so
those two apply from the next load.

In a world with players, only a human listed in `meta.players` may change
tunables. A world with no players (a headless run, a sandbox still being set
up) lets anyone. That's the single-player rule; the modding and multiplayer
epics can tighten it, for example to the host of an online game.

## Serialisability

Results cross a Web Worker boundary through structured clone, and the UI's
query cache compares them, so everything that leaves the engine is plain JSON:
null, booleans, finite numbers, strings, and arrays and plain objects of
those. No `Map`, `Set`, `Date`, class instance, function, `undefined` value or
`NaN`.

`assertSerialisable(value, path)` checks it. It's a thin wrapper over
`assertJsonValue` in `core/json.ts`, so there's one definition of "plain JSON"
in the engine. With `debugChecks` on, the engine runs it on every query
result, every command result (inside the command's transaction, so a bad
result rolls the command back), every reason list and every `advanceDays`
result (a bad one makes `advanceDays` reject), and the event bus runs
the same check on every event payload. A failure comes back as an `internal`
reason naming the bad path, such as `queries["roster.rows"][3].signedOn`.

`debugChecks` defaults to true. Tests and CI keep it on. The engine has no
idea what kind of build it's in, so the production web build turns it off
when it creates the engine, because the checks cost time on every call.

## System bundles

A **system bundle** declares, in one place, what a system adds at run time:

| Field           | What                                          | Registered with            |
| --------------- | --------------------------------------------- | -------------------------- |
| `phases`        | Day phases (`PhaseSpec`)                      | The phase registry         |
| `gates`         | Reasons for a skip to stop (`GateSpec`)       | The gate registry          |
| `subscriptions` | Reactions: `{ id, type, priority?, handler }` | The event bus              |
| `queries`       | `defineQuery(...)` results                    | The engine's query table   |
| `commands`      | `defineCommand(...)` results                  | The engine's command table |

`createEngine` registers bundles in the order given. A duplicate phase, gate,
subscription, query or command id, inside one bundle or across two, throws a
`RegistryError` naming both systems. A malformed phase or gate throws with the
system id in front of the pipeline's own message.

Two things a system owns are **not** in its bundle, because they have to be
known at compile time:

- **Tunables** stay in the compile-time aggregate (`systems/tunables.ts`,
  `ALL_TUNABLES`), so a misspelt key is a type error and a save can check its
  overrides before any system runs.
- **RNG stream names** are declared by merging into `StreamNames`
  (`core/rng/streams.ts`).

`defineSubscription({ id, type, handler })` types a handler by its event type.

## The engine state

```ts
interface EngineState {
  world: SerializedWorld; // FND-11: meta plus every table, rows in ascending ID order
  rng: RngState;
  tunableOverrides: TunableOverrides;
  traces: TraceStoreState;
  events: EventBusState;
  failureLog: PipelineFailureLogState;
  commandLog: CommandLogState;
}
```

`exportState()` returns it and `createEngine({ state })` starts from it.
Exporting, writing it out as JSON, reading it back and building a new engine
gives an engine whose next `exportState()` is identical, and which then plays
on exactly like one that never stopped. `createEngine` throws if `rng.seed` is
not the world's `meta.seed`.

`initialEngineState(world)` is the state of a game that hasn't started: the
world as it is, the RNG seeded from `meta.seed` with no streams touched, no
overrides, and empty traces, events, failures and command log. The new-game
command, the test fixtures and the headless runner start from it.

The day report of the last advance (`sim.lastDayReport`) is not part of the
state: it's there for the screen that shows the day just simulated.

### Registering the parts with the save format

The save document (see [save-format.md](save-format.md)) gives each
simulation part a named slot and takes the slot's schema from the caller, so
`persistence/` imports no simulation code. `core/api/saveParts.ts` is the one
place that knows all six schemas:

- `engineStateParts` maps each part to its schema: `rngStateSchema`,
  `tunableOverridesSchema`, `traceStoreStateSchema`, `eventBusStateSchema`,
  `pipelineFailureLogStateSchema` and `commandLogStateSchema`.
- `createEngineSaveDocumentSchema()` is `createSaveDocumentSchema(engineStateParts)`.
- `engineLoadOptions(extra?)` returns `loadSave` options with those schemas
  and the tunable override check wired to `validateOverrides(ALL_TUNABLES, ...)`.
  An unknown or out-of-range override is dropped and listed as a warning, so a
  removed tunable never makes an old save unloadable.
- `engineSaveState(state)` hands an `EngineState` to `createSaveDocument`, and
  `engineStateFromSave(doc)` turns a loaded document back into one.

Saving and loading through the engine:

```ts
const doc = createSaveDocument(engineSaveState(engine.exportState()), extras);
const bytes = await encodeSave(doc);

const report = await loadSave(bytes, TABLES, engineLoadOptions());
if (report.ok) {
  const engine = createEngine({ state: engineStateFromSave(report.doc), systems: defaultSystems });
}
```

## The rule

**The UI never touches the World.** It doesn't import `Tx`, it never sees a
table, and it doesn't work out game numbers itself. It asks the engine with a
query and changes things with a command. Everything that crosses is plain
JSON, so the same calls work through the Web Worker today and over the network
for online play later.
