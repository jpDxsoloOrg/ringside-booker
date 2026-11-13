# Calculation traces

Every number in the game explains itself. A match rating, an attendance
figure, a wage demand or a computer GM's pick comes with a breakdown of the
inputs and steps that produced it, and the "Why?" panel shows that breakdown to
the player. This doc covers the shape of those breakdowns, the builders that
make them, the checks that keep them honest, how they are kept once a result is
recorded, and the conventions every formula in every system follows.

Code: `packages/engine/src/core/trace/`. Test helpers:
`packages/engine/test/support/trace.ts`.

## Purpose

If the maths and its explanation were written separately, they would drift. A
tweak to a formula would change the number and leave the breakdown describing
the old rule. So the explanation is not written separately: a formula computes
its number _through_ a builder, and each step of the builder both changes the
running value and records the step. The arithmetic is the trace.

A replay check (see [Replay](#replay)) then proves it. It re-runs the recorded
steps and fails the test when they do not reproduce the result, which catches
the one way left to cheat: computing something outside the chain and passing
in a number the trace cannot account for.

## The shape

A formula returns a `Traced<T>`:

```ts
interface Traced<T> {
  value: T;
  trace: TraceNode;
}
```

`TraceNode` is a discriminated union on `kind`. Every node carries:

| Field      | Meaning                                                                          |
| ---------- | -------------------------------------------------------------------------------- |
| `kind`     | Which kind of node this is (see [Node kinds](#node-kinds))                       |
| `label`    | Plain English, written for the player (see [Labels](#labels))                    |
| `value`    | `number`, `boolean`, `string` or `null`. Numbers are always finite               |
| `unit`     | Optional. Any tunable unit (`points`, `percent`, `money`, ...) plus `stars`      |
| `docRef`   | Optional. The design doc anchor that explains this step, e.g. `matches.md#crowd` |
| `children` | Optional. Sub-steps, which the UI shows as a collapsible group                   |

Traces are plain JSON. They go into saves and across the Web Worker boundary,
so they hold no functions, `Map`, `Set`, `Date`, class instances, `undefined`
values or `-0`. An optional field is left out, never set to `undefined`.

An `input` node can link to the entity it came from with
`ref: { kind, id }`, where `kind` is an entity kind such as `person` or
`promotion`. The trace points at the entity; it never embeds a copy of it, so
the "Why?" panel can show the current name and link to the profile.

### Units

A calculation names its unit once, on the formula (`startCalc(label, start,
{ unit: 'money' })`); the steps the builder records leave `unit` out, so a
stored trace does not repeat it on every step (that would add about 6% to a
year's save). Anything that shows a step on its own reads the trace through
`withStepUnits(root)` first, which hands each step the unit of its calculation
at read time:

- the steps of a formula (its starting value, additions, limits, rounding,
  notes) are in the formula's unit;
- except while the running value is still in its starting value's own unit (a
  crowd `count` at the start of a `money` formula): steps up to the first
  multiply or divide stay in that unit, and that multiply or divide is the step
  that changes it. It gets two read-time fields the builder never records and
  the save schema refuses: `beforeUnit` (the unit it started from) and, when
  its factor names a unit of its own, `operandUnit`, so the row reads
  `×$15.50 Spent per fan · 1,200 → $18,600`, not `×1,550 · $12 → $18,600`;
- an amount added or subtracted, and a floor or ceiling, is in the same unit as
  the value it changes, so its own trace inherits that unit;
- a factor (multiply, divide, power) is a plain number whatever the running
  value measures, and the inside of an input, decision, roll or branch measures
  something else, so nothing is passed down there;
- a node that names its own unit keeps it and passes that unit on instead.

So a money formula's `subtract` step reads `−$333,930.19`, not `−33,393,019`,
in the "Why?" panel and in the sim-runner's `--trace` output. A formula whose
starting value is in another unit gives that value its unit itself, with
`inputOf(label, value, ref, unit)` or a traced value that has one; a plain
number start takes the formula's unit.

## Node kinds

| Kind                                    | Records                                                                    | Example                                                           |
| --------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `formula`                               | The root of a calculation. Children are the start value, then each step    | "Match rating" = 71                                               |
| `input`                                 | A named input value, optionally with `ref` to its entity                   | "Popularity of Rex Vance" = 64                                    |
| `constant`                              | A fixed number that is deliberately not tunable, with its `reason`         | "Percent scale" = 100, because percentages are stored as 0 to 100 |
| `tunable`                               | A balance number: `key`, `value`, `defaultValue` and `overridden`          | "Rest recovery per day" = 0 (default 12, overridden)              |
| `add`, `subtract`, `multiply`, `divide` | One arithmetic step: `operand`, `before`, `after` and an optional `reason` | "Hometown crowd" +5: 48 → 53                                      |
| `power`                                 | Raises the running value to `operand` (the exponent), same fields as above | "Diminishing returns" raised to the power 1.5: 0.25 → 0.125       |
| `min`                                   | A ceiling, `Math.min(before, limit)`, with `applied`                       | "Production ceiling" 45: 52 → 45 (applied)                        |
| `max`                                   | A floor, `Math.max(before, limit)`, with `applied`                         | "No negative crowd" 0: 12 → 12 (not applied)                      |
| `clamp`                                 | A range, `min`..`max` both included, with `applied`                        | "Kept between 0 and 100": 104 → 100                               |
| `round`                                 | Rounding: `mode` is `round` (halves go up), `floor` or `ceil`              | "Rounded down": 7.6 → 7                                           |
| `roll`                                  | A random roll: the full roll record (stream, odds, range, result)          | "Injury check": 15% chance, came up false                         |
| `branch`                                | A condition that was checked: `condition` and `taken`                      | "Main event slot": taken                                          |
| `decision`                              | A non-numeric choice: `chosen`, `reason` and every `considered` option     | "Title decision": retain (scores: retain 62, change 48)           |
| `note`                                  | Text only. The label is the note                                           | "Title match"                                                     |

Every limit (`min`, `max`, `clamp`) is recorded whether or not it changed the
value, with `applied: true` or `false`. "Checked against the production
ceiling of 45, not reached" is as useful to a player as "capped at 45", and a
hidden cap that only shows up when it bites is the kind of thing that makes a
sim feel unfair. The UI can hide unapplied limits by default.

## Building a number

`startCalc(label, initial, options?)` returns a `Calc` builder. Each method
records one step and returns the builder; `done()` returns the `Traced<number>`.

```ts
const calc = startCalc('Crowd reaction', inputOf('Performance', performance), {
  unit: 'points',
  docRef: 'matches.md#crowd',
});
return calc
  .subtract('Expected from these workers', expectation)
  .multiply('Crowd weight', calc.tunable(tunables, 'matches.crowd.weight', 'Crowd weight'))
  .add('Hometown crowd', hometownBonus, 'Show is in their home region')
  .clamp(-20, 20)
  .done();
```

- **Start.** A plain number becomes an `input` node labelled by
  `options.startLabel` (default "Starting value"). A `Traced<number>` brings
  its own trace, which becomes the first child.
- **Arithmetic.** `add`, `subtract`, `multiply` and `divide` take a number or a
  `Traced<number>`. A traced amount is embedded as the step's children, so a
  sub-formula shows up as a collapsible step. `divide` throws on 0, and any
  step that would produce `NaN` or an infinite number throws.
- **Power.** `power(label, exponent, reason?)` raises the running value to
  `exponent` (a number or a `Traced<number>`), for curves such as diminishing
  returns. It throws for a negative value with a fractional exponent, which has
  no real result.
- **Limits.** `min(label, limit)` is a ceiling and `max(label, limit)` is a
  floor, named after the maths functions they apply. `clamp(min, max, label?)`
  keeps the value in a range.
- **Rounding.** `round('round' | 'floor' | 'ceil', label?)`. `round` sends
  halves up (`2.5 → 3`, `-2.5 → -2`), like `Math.round`.
- **Tunables.** `calc.tunable(reader, key, label?)` returns the value and
  records a `tunable` node under the _next_ step, so pass the value straight
  into that step. A read that no step uses is still recorded, as a step of its
  own. The label defaults to the tunable's description; a short label reads
  better.
- **Rolls, branches and notes.** `roll(record)`, `branch(condition, taken)` and
  `note(text)` record a step without changing the value.
- **Running value.** `calc.current` is the value so far, for a formula that
  branches on it.
- **Done.** `done()` takes a snapshot. The builder can carry on afterwards.

Smaller helpers:

- `inputOf(label, value, ref?, unit?)`: a named input as a traced value.
- `untraced(value, label)`: a single `input` node, for tests and values that
  need no story.
- `constantOf(label, value, reason)`: a fixed number as a traced value.
- `traced(value, node)`: pairs a value with a hand-built node, fitted into the
  size limits.
- `mapTraced(source, label, transform)`: derives a non-arithmetic value from a
  traced one (a star rating label, an "is injured" flag), keeping the source
  trace as its child. Numeric maths belongs in `startCalc`, where it can be
  replayed.

## Labels

Labels are shown to players in the "Why?" panel, so they are plain English and
never internal names:

| Good                     | Bad                    |
| ------------------------ | ---------------------- |
| "Fatigue before rest"    | "fat0"                 |
| "Crowd expected more"    | "expDelta"             |
| "Main event (long)"      | "slot.role=main"       |
| "Rest recovery per day"  | "condition.restPerDay" |
| "Kept between 0 and 100" | "clamp"                |

A label says what the number is, not how it was computed. The `reason` on an
arithmetic step says why it applies ("Show is in their home region"). Names of
people and promotions go in an `input` node with a `ref`, so the UI shows the
current name even after a rename.

Two things the panel adds to a label by itself, so formulas do not repeat them:

- **A tunable's key.** The row for a `tunable` node ends with its key ("Ring
  work weight: 3 · Game setting · `workers.rating.wrestler.ringwork`"). The
  label says what the number is; the key is what to look for in the tunables
  list or a balance profile to change it.
- **A decision's options in words.** A `decision` carries its options as the
  codes the data uses (`mainEvent`, `lightHeavyweight`), since `chosen` is the
  value the caller gets back. The panel turns a camelCase code into words
  ("Main event", "Light heavyweight") in the headline and in the list of
  options. An option that is not a code (a name, a sentence) is shown as it
  is.

## Constants and tunables

Every balance number is a tunable (see [tunables.md](tunables.md)), read
through `calc.tunable(...)` so the trace shows its value, its default and
whether the save overrides it. A tunable overridden to 0 shows
`overridden: true, value: 0`: 0 means 0.

A `constant` is for the rare number that is deliberately not a balance knob:
a unit conversion (100 to turn a percent into a fraction), the ends of a fixed
scale (a 0 to 100 rating), or a count that defines the rules (a week has 7
days). It always has a reason. If anyone might ever want to tune it, it is a
tunable.

## Recording rolls

Randomness comes from the recorded roll helpers (`rollChance`, `rollInt`, ...;
see [determinism.md](determinism.md)). Each returns the value and a
`RollRecord` with the stream, the odds, the range and the result. Record the
roll, then use its value:

```ts
const swing = rollInt(rng, -3, 3, 'Crowd swing');
calc.roll(swing.roll).add('Crowd swing', swing.value);
```

The recorded helpers draw exactly what the plain ones do, so switching a call
site to a recorded helper never changes a result.

## Decision traces

Some of the numbers the game must explain are not numbers: who wins, whether a
champion drops the title, which worker a computer GM drafts. These use
`startDecision<T>(label)`, where `T` is a string union of options or `boolean`
for yes/no outcomes:

```ts
const result = startDecision<'retain' | 'change'>('Title decision')
  .rule('Champion is fit to defend', true)
  .consider('retain', retainScore, 'Reign is still drawing')
  .consider('change', changeScore)
  .choose('retain', 'Keeping the title scored higher');
```

- `consider(option, score, reason?)` weighs an option. Options keep the order
  they were considered in. A traced score is embedded as a child, so the
  player can open how each option was scored. Considering the same option
  twice throws.
- `rule(text, passed)` records a rule that was checked, as a `branch` node.
- `roll(record)`, `note(text)` and `tunable(reader, key, label?)` work as in
  the calculation builder.
- `include(label, traced)` nests another trace, numeric or not, as a child
  shown under `label`: a choice made inside this one (a challenger pick inside
  a match's decision) or a calculation that is not an option's score.
- `choose(option, because)` returns the `Traced<T>`. When any options were
  considered, the chosen one must be among them.

## Size limits

A trace holds at most 400 nodes and 12 levels (the root is level 1). The caps
protect saves and the worker boundary from pathological traces, such as a loop
over a whole roster. 400 is generous for one formula and can become a tunable
later if a real formula needs more.

Going over a limit never throws, and the value is never cut short:

- **Too many nodes.** Once a builder runs out of room, every later step is
  replaced by one `note`, "N more steps not shown", at the end of the root's
  children. The note records `hiddenSteps` (how many nodes are not shown) and,
  in a numeric formula, the running value after them. A step that only has
  room for itself keeps its own fields (so it still replays) but loses its
  children, which the note counts. The 400 includes the note.
- **Too deep.** Nodes at the last allowed level keep their own fields but lose
  their children, and their parent gets one note saying how many were cut.
- **Embedded traces** are trimmed to the room that is left when they are added.

The counts live on each builder, never in module state, so formulas built side
by side do not share a budget.

## Replay

`replayTrace(node)` recomputes a numeric trace from its steps alone. For a
`formula` node it starts from the first child's value and applies every
arithmetic, limit and round step in order. Other steps (inputs, tunables,
rolls, branches, notes) carry no arithmetic and are skipped; their effect
already shows in the operand of the step that used them. A truncation note
carries the running value past the steps it hides. Any other node with a
number value is a recorded fact and replays to itself.

`assertTraceReplays(traced, epsilon = 1e-9)` throws a `TraceReplayError` unless:

- the replay matches `traced.value`,
- the root node records the same value,
- every step records the `before`, `after` and `applied` the replay computes,
  and
- every formula nested inside the trace (a sub-formula embedded in a step, a
  traced score) replays to the value it records.

Numbers are compared within `epsilon`, relative to their size once they are
above 1. Each problem in the error names the step it was found at.

## Retention

A formula's trace is only useful if the "Why?" panel can find it later, but a
busy world makes thousands of results a month, and keeping every tree forever
would bury the save. The trace store (`core/trace/store.ts`) keeps full traces
for recent results, a short summary for older ones, and nothing beyond that.

### Refs and kinds

Every stored trace is filed under a `TraceRef`:

```ts
interface TraceRef {
  kind: string; // what sort of result: 'segment.rating', 'show.attendance', 'contract.ask'
  id: string; // what it belongs to, usually an entity ID such as 'seg_...'
}
```

The kind is dot-separated camelCase words, like a tunable key. It never
contains a colon, so `refKey(ref)`, which is `${kind}:${id}`, is unique. The
system that owns a result picks its kind and decides which results are worth
recording; the store does not care what the kind means.

Recording the same ref again replaces what was there. A re-rated segment has
one trace, the latest one, never a history of drafts.

### Per-kind retention

The newest `sim.traceRetentionPerKind` full traces of **each kind** are kept.
Limits are counted per kind because results arrive at very different rates: a
world produces far more segment ratings than contract asks, and one global
limit would let segments push everything else out.

When a kind goes over its limit, its oldest full traces are demoted to
summaries. A retention of 0 keeps no full traces for any kind: every result is
summarised as soon as it is committed.

### Size budget per kind

Counting alone lets a kind with big trees fill the save: 200 popularity door
traces of a worker known in sixty regions were 4 MB on their own. So each kind
is also held to `sim.traceBytesPerKind` (500,000) characters of JSON across its
full traces (POL4-06). After a commit, the oldest full traces of a kind are
demoted while the kind is over **either** its count or its size budget, so a
kind of small traces keeps its 200 and a kind of big ones keeps fewer.

Sizes are `JSON.stringify(entry).length` of each stored entry, counted when it
is stored and again when a save is loaded. They are never saved: key order
does not change the length, so a loaded store counts exactly what the live one
did and demotes the same entries. A budget of 0 summarises everything at once,
like a retention of 0.

### Summary-only results (rivals)

A result recorded with `record(ref, date, traced, { summaryOnly: true })` is
stored as a summary straight away, marked `summaryOnly: true`, and replaces any
full trace the ref had. It still uses up a `seq` and counts against
`sim.traceSummaryLimit` like any summary. Systems use it for computer-run
promotions' results that nobody opens in full:

| Recorded by                 | Kinds                                        | When                           |
| --------------------------- | -------------------------------------------- | ------------------------------ |
| `postMoney` (finance)       | `finance.rivalEntry`                         | Every ledger row of a rival    |
| The match aftermath (MTCH3) | `match.popularityGain`, `match.momentumGain` | Matches on a computer-run show |
| The worker doors (WRK1)     | `workers.popularity`, `workers.momentum`     | Changes with source `ai`       |

A promotion's own popularity door trace (`promotions.popularity`) and rival
show results (`shows.rivalSegmentScore`, `match.rivalResult`,
`promoPop.rivalShowChange`, `boxOffice.rivalAttendance`) stay full: they are
public, and the size budget bounds them. The player's own results keep full
traces as before.

The Why? panel tells the two kinds of summary apart: an aged-out one says
"Full breakdown is only kept for recent results", a summary-only one says
"Only a summary is kept for other promotions' results". Both show the value,
the date and what moved it most.

### Lean popularity door traces

The popularity door's trace (`workers.popularity`, `promotions.popularity`)
has a step only for the regions whose stored value changed this call; the
rest are counted in one note, "And N more regions unchanged". The three most
populous changed regions (`DOOR_TRACE_DETAILED_REGIONS`) show their working
(share, taper, clamp and rounding); the others show only the points they
moved. The trace still replays to the points moved in total.

### Summaries

A summary keeps what a history screen needs to say what a number was and why:

| Field             | Kept from the full trace                                   |
| ----------------- | ---------------------------------------------------------- |
| `ref`, `date`     | What the result was for, and the game date it was recorded |
| `seq`             | Its place in the store's order (see below)                 |
| `label`, `value`  | The root's label and the result, such as "Match rating" 76 |
| `unit`            | The root's unit, when it has one                           |
| `topContributors` | The three steps that moved the value most, largest first   |
| `summaryOnly`     | `true` when no full trace was ever kept (see below)        |

A contributor is a direct step of the root with its label and its effect,
`after - before`. Arithmetic steps always count; a limit (`min`, `max`,
`clamp`) counts only when it applied, since a ceiling that was not reached
moved nothing. Steps with no effect are left out, and ties keep trace order. A
decision trace has no arithmetic steps at its root, so its summary keeps the
chosen value and no contributors.

At most `sim.traceSummaryLimit` summaries are kept across all kinds. Past
that, the oldest are dropped for good. A limit of 0 keeps no summaries, so
results past the retention limit disappear entirely.

### Order

The store hands out a sequence number (`seq`) to every trace it commits, and
saves the counter with the store. "Oldest" always means "lowest `seq`", never
wall-clock time or the order a `Map` happened to be filled in, so a game that is
saved and loaded demotes and drops exactly the same entries as one that was
not. A summary keeps the `seq` of the trace it came from, so an old result
demoted late still counts as old.

### Staging

Traces are written through a staging that belongs to one pipeline step or
command:

```ts
const traces = store.stage();
traces.record({ kind: 'segment.rating', id: segmentId }, today, rating);
// ... the rest of the step ...
traces.commit(); // or traces.discard() when the step fails
```

Nothing staged is visible to `get`, `has` or `listByKind` until `commit()`.
When a step throws, the pipeline rolls back its world writes and discards its
staging along with them. The result never happened, so its trace must not
exist either: a "Why?" panel that explains a rating the world does not have
would be worse than no explanation. Discarding uses up no sequence numbers.

`commit()` gives each staged trace the next `seq` in the order it was recorded,
then applies retention to the kinds it touched, then trims the summaries. A
staging cannot be used again once it is committed or discarded.

`record` fits the trace into the [size limits](#size-limits), checks it is
plain JSON and validates it with the same schema a load uses (a `-0` is stored
as `0`), so everything in the store can be saved and loaded again. A trace that
fails the schema throws `SchemaViolationError` at `record`, not when the save is
next loaded.

### Saving

The store's state is one part of the save:

```ts
interface TraceStoreState {
  version: 1;
  seq: number; // the last seq handed out
  full: StoredTrace[]; // sorted by seq
  summaries: TraceSummary[]; // sorted by seq
}
```

`traceStoreStateSchema` validates it on load. Every trace goes through
`traceNodeSchema`, which knows every node kind and its fields and enforces the
same limits as the builders (12 levels, 400 nodes), so a hand-edited save
cannot load an unknown kind or an unbounded tree. The schema also checks that
both arrays are in `seq` order, that no `seq` is above the store's, and that a
ref appears only once. Loading applies the current limits straight away, so a
save made with higher limits is trimmed the same way a commit would trim it.

### Tunables

| Tunable                     | Default | Controls                                        |
| --------------------------- | ------- | ----------------------------------------------- |
| `sim.traceRetentionPerKind` | 200     | Full traces kept per kind before summarising    |
| `sim.traceBytesPerKind`     | 500000  | JSON characters of full traces kept per kind    |
| `sim.traceSummaryLimit`     | 5000    | Summaries kept across all kinds before dropping |

Both are expected to be tuned once real formulas exist and save sizes can be
measured. Changing either applies at once (`setLimits`), not just on the next
commit.

## Formula module conventions

Every game formula in every system follows these rules, and tickets cite this
section.

1. **One formula per file**, in
   `packages/engine/src/systems/<system>/formulas/<name>.ts`, exporting one
   function.
2. **Signature:**

   ```ts
   export function fatigueRecovery(
     inputs: FatigueRecoveryInputs,
     deps: { tunables: EngineTunables; rng?: RngStream },
   ): Traced<number>;
   ```

   `inputs` is a plain object type named after the formula
   (`<Name>Inputs`). `deps.tunables` is the engine's tunable reader
   (`EngineTunables`, the `TunableReader` over every engine tunable).
   `deps.rng` is present only when the formula rolls, and is the one named
   stream it draws from.

3. **Inputs are plain values and IDs**, never the World or a `Tx`. The calling
   system reads what the formula needs from the world and passes it in. That
   keeps formulas pure, cheap to test and safe to call from a preview.
4. **No side effects.** A formula reads its inputs and returns a traced value.
   It does not write to the world, publish events or log. The same inputs and
   the same RNG state always give the same result.
5. **Every balance number is a tunable** read through the builder, and every
   other fixed number is a `constant` with a reason. No bare magic numbers.
6. **A design doc section per formula.** The system's design doc has a section
   for each formula that explains the maths and why. The root node's `docRef`
   points at it.
7. **A test file per formula**, at
   `packages/engine/test/systems/<system>/<name>.test.ts`, whose first line is
   a comment linking that design doc section:

   ```ts
   // Fatigue recovery. Design: docs/design/condition.md#fatigue-recovery
   ```

### Required tests for a formula

- **Zero inputs**: every numeric input at 0.
- **Maximum inputs**: every input at the top of its range.
- **Each clamp boundary**: just below, exactly at and just above every limit,
  with `applied` checked.
- **Each branch boundary**: both sides of every condition the formula checks.
- **Each tunable** at its minimum, its maximum and 0 where 0 is allowed.
- **`expectTraceReplays` on every numeric case**, and **`expectSerialisable`**
  on every trace.

The helpers in `packages/engine/test/support/trace.ts`:

| Helper                                          | Checks                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `expectTraceReplays(result)`                    | The trace replays to the value, every step matches, and it is plain JSON      |
| `expectTraceContains(result, { kind, label? })` | A node of that kind (and label) exists; returns it, narrowed, for more checks |
| `expectRollRecorded(result, stream)`            | A roll from that stream is in the trace; returns its record                   |
| `expectSerialisable(value)`                     | The value is plain JSON and survives a JSON round trip unchanged              |

## Worked example

Fatigue recovery comes from the `condition` system, the reference system. It
is deliberately tiny: once a day, everyone with some fatigue sheds a little of
it. It exists to show every piece of the core working together once, so each
later system can copy its layout instead of working it out again. The fatigue model itself is a
placeholder; the workers epic owns the real one (gain from matches, effort,
injuries) and will replace or absorb this system.

| Piece        | File (under `packages/engine/src/systems/condition/`) | What it shows                                       |
| ------------ | ----------------------------------------------------- | --------------------------------------------------- |
| Tunables     | `tunables.ts`, added to `systems/tunables.ts`         | Balance numbers with ranges, units and defaults     |
| RNG stream   | `streams.ts`                                          | A named stream declared by merging `StreamNames`    |
| Formula      | `formulas/fatigueRecovery.ts`                         | A pure function returning `Traced<number>`          |
| Domain event | `events.ts`                                           | An event declared by merging `DomainEventMap`       |
| Day phase    | `phases.ts`                                           | Reads, calls the formula, writes, traces, publishes |
| Query        | `queries.ts`                                          | A "Why?"-ready view with a `TraceRef`               |
| Bundle       | `index.ts`, added to `systems/index.ts`               | `defineSystem`, the only way a system plugs in      |

No core file names the system. It reaches the engine only through the
`defaultSystems` list and the tunables aggregate.

The stream, event and query declarations are types merged into core
interfaces, and they only exist in a program that loads the file declaring
them. So the bundle's `index.ts` imports `./streams` and `./events` (and
`./queries` through its query list), and `systems/index.ts` re-exports the
bundle. That keeps every declaration reachable from the package entry, so the
web app, the tools and the tests all see them, including tests and dev screens
that add their own names with `declare module '@ringside/engine'`.

### The maths

```
fatigue after = clamp(fatigue before − daily recovery − extra rest, 0, 100)
extra rest    = a whole number from 0 to the bonus maximum, both ends included
```

| Tunable                             | Kind    | Default | Range | Unit       | What it does                                                         |
| ----------------------------------- | ------- | ------- | ----- | ---------- | -------------------------------------------------------------------- |
| `condition.fatigueRecoveryPerDay`   | number  | 4       | 0–100 | points/day | Fatigue every person sheds each day before any bonus                 |
| `condition.fatigueRecoveryBonusMax` | integer | 1       | 0–10  | points/day | Largest random extra recovery per day; 0 turns the roll's effect off |

The default of 4 is a placeholder, not a balance decision. The random extra is
there only so the example shows how a roll appears in a trace.

### The formula

```ts
export function computeFatigueRecovery(
  inputs: FatigueRecoveryInputs,
  deps: { tunables: EngineTunables; rng: RngStream },
): Traced<number> {
  const calc = startCalc('Fatigue after a day of rest', inputs.fatigue, {
    unit: 'points',
    docRef: FATIGUE_RECOVERY_DOC_REF, // 'docs/design/calculation-traces.md#worked-example'
    startLabel: 'Fatigue before rest',
  });
  calc.subtract(
    'Daily recovery',
    calc.tunable(deps.tunables, 'condition.fatigueRecoveryPerDay', 'Daily recovery'),
  );
  const bonusMax = calc.tunable(
    deps.tunables,
    'condition.fatigueRecoveryBonusMax',
    'Most extra rest',
  );
  const extraRest = rollInt(deps.rng, 0, bonusMax, 'Extra rest');
  return calc
    .roll(extraRest.roll)
    .subtract('Extra rest', extraRest.value)
    .clamp(FATIGUE_MIN, FATIGUE_MAX)
    .done();
}
```

Things to copy:

- **Inputs are plain values.** The formula gets a number, the tunable reader
  and one stream. It never sees the World or a `Tx`, so a booking preview can
  call it too.
- **Every tunable is read through the builder.** The daily recovery's read is
  attached to the subtract step that uses it. The bonus maximum is read just
  before the roll, so it is attached to the roll node: the player can see the
  range came from a tunable.
- **The roll is always drawn**, even when the bonus maximum is 0 and the roll
  can only come up 0. Every call takes exactly one draw from
  `condition.recovery`, so changing the tunable never shifts the stream.
- **The ends of the scale are constants with a reason.** 0 and 100 are the
  range of `fatigue: zStat` on the Person schema, not balance numbers, so they
  are named constants (`FATIGUE_MIN`, `FATIGUE_MAX`) rather than tunables.
- **The clamp is always recorded**, applied or not.

### The trace it produces

A person at 50 fatigue, with the default tunables and an extra rest roll of 1:

```json
{
  "kind": "formula",
  "label": "Fatigue after a day of rest",
  "value": 45,
  "unit": "points",
  "docRef": "docs/design/calculation-traces.md#worked-example",
  "children": [
    { "kind": "input", "label": "Fatigue before rest", "value": 50, "unit": "points" },
    {
      "kind": "subtract",
      "label": "Daily recovery",
      "value": 46,
      "operand": 4,
      "before": 50,
      "after": 46,
      "children": [
        {
          "kind": "tunable",
          "label": "Daily recovery",
          "key": "condition.fatigueRecoveryPerDay",
          "value": 4,
          "defaultValue": 4,
          "overridden": false,
          "unit": "points/day",
          "docRef": "calculation-traces.md#worked-example"
        }
      ]
    },
    {
      "kind": "roll",
      "label": "Extra rest",
      "value": 1,
      "roll": {
        "stream": "condition.recovery",
        "kind": "int",
        "label": "Extra rest",
        "odds": 0.5,
        "min": 0,
        "max": 1,
        "result": 1
      },
      "children": [
        {
          "kind": "tunable",
          "label": "Most extra rest",
          "key": "condition.fatigueRecoveryBonusMax",
          "value": 1,
          "defaultValue": 1,
          "overridden": false,
          "unit": "points/day",
          "docRef": "calculation-traces.md#worked-example"
        }
      ]
    },
    {
      "kind": "subtract",
      "label": "Extra rest",
      "value": 45,
      "operand": 1,
      "before": 46,
      "after": 45
    },
    {
      "kind": "clamp",
      "label": "Kept between 0 and 100",
      "value": 45,
      "min": 0,
      "max": 100,
      "before": 45,
      "after": 45,
      "applied": false
    }
  ]
}
```

`replayTrace` starts from the input (50), applies the two subtractions and the
clamp, and gets 45. The tunable and roll nodes carry no arithmetic; their
effect is already in the operands of the steps that used them.

### How the "Why?" panel reads it

The panel turns the root and its steps into one sentence, then lets the player
open each step:

> **Fatigue after a day of rest: 45** = 50 − 4 (daily recovery, tunable) − 1
> (extra rest, rolled 0–1), checked against 0–100

- "50" is the input node, "Fatigue before rest".
- "− 4 (daily recovery, tunable)" is the first subtract step. Opening it shows
  the tunable, its default and whether the save overrides it. If the player
  had set it to 0, the line would read "− 0 (daily recovery, tunable, changed
  from 4)".
- "− 1 (extra rest, rolled 0–1)" comes from the roll node (its range and
  result) and the subtract step after it. Opening the roll shows the stream,
  the odds (1 in 2) and the bonus maximum it was rolled against.
- "checked against 0–100" is the clamp. It did not apply here, so the panel
  can hide it by default; for a person at 2 fatigue it applied (−3 → 0), and
  the line would read "kept at 0 (the lowest fatigue can go)".

### The phase, the event and the stored trace

`condition.fatigueRecovery` runs daily in the `housekeeping` group at order 10:

1. It walks the people table in ascending ID order, so the draws always happen
   in the same order.
2. A person already at 0 is skipped and draws nothing: no roll could change
   their result. Only roll when the outcome can matter, and decide that the
   same way every time, so the stream stays aligned. The stream itself is only
   fetched once someone needs it, so a day with nobody tired leaves it
   untouched.
3. Everyone else gets the formula's value written with
   `ctx.tx.update('people', personId, { fatigue })`.
4. The trace is recorded with `ctx.recordTrace({ kind: 'condition.fatigueRecovery', id: personId }, ctx.date, result)`.
   Recording the same ref again replaces the old trace, so each person has
   their latest recovery on file.
5. When fatigue goes from above 0 to 0, the phase publishes
   `condition.fatigueCleared` with `{ personId }`.

All of this happens inside the phase's own step. If a later phase throws, its
writes are rolled back and this phase's writes, traces and events stay. If this
phase throws, its writes, traces, events and draws are all rolled back together,
so the store never explains a number the world does not have.

### The query

`condition.fatigue` takes `{ personId }` and returns
`{ personId, fatigue, traceRef }`, or `null` for an unknown person. `traceRef`
is the ref above when a trace is stored, and `null` otherwise (a person who has
not recovered yet). A screen shows the number, and its "Why?" button calls
`trace.get` with the ref. Fatigue is not secret, so every viewer gets the same
answer; a system with private data would filter on `ctx.viewer` here.

### The tests

- `packages/engine/test/systems/condition/fatigueRecovery.test.ts` covers the
  formula at its edges: zero fatigue, the top of the scale, both sides of the
  clamp, each tunable at 0 and at its maximum, the roll's stream and range, and
  exactly one draw per call. Every numeric case goes through
  `expectTraceReplays`.
- `packages/engine/test/systems/condition/phase.test.ts` runs the system
  through `createEngine(...).advanceDays`: the values after a day, which people
  draw, the event, the stored traces, determinism for a seed, the query, and a
  failing phase later in the same group that leaves this phase's writes alone.
