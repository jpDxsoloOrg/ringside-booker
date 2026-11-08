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

## Node kinds

| Kind                                    | Records                                                                    | Example                                                           |
| --------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `formula`                               | The root of a calculation. Children are the start value, then each step    | "Match rating" = 71                                               |
| `input`                                 | A named input value, optionally with `ref` to its entity                   | "Popularity of Rex Vance" = 64                                    |
| `constant`                              | A fixed number that is deliberately not tunable, with its `reason`         | "Percent scale" = 100, because percentages are stored as 0 to 100 |
| `tunable`                               | A balance number: `key`, `value`, `defaultValue` and `overridden`          | "Rest recovery per day" = 0 (default 12, overridden)              |
| `add`, `subtract`, `multiply`, `divide` | One arithmetic step: `operand`, `before`, `after` and an optional `reason` | "Hometown crowd" +5: 48 → 53                                      |
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

### Summaries

A summary keeps what a history screen needs to say what a number was and why:

| Field             | Kept from the full trace                                   |
| ----------------- | ---------------------------------------------------------- |
| `ref`, `date`     | What the result was for, and the game date it was recorded |
| `seq`             | Its place in the store's order (see below)                 |
| `label`, `value`  | The root's label and the result, such as "Match rating" 76 |
| `unit`            | The root's unit, when it has one                           |
| `topContributors` | The three steps that moved the value most, largest first   |

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

## Worked example: fatigue recovery

<!-- PLACEHOLDER (SIM-11): fill this section in from the fatigue recovery formula when it lands. -->

> **Placeholder.** This section will walk through the fatigue recovery formula
> end to end once it is built: its inputs type, the builder chain, the trace it
> produces for a sample worker, its design doc section and its test file. Until
> then, the examples in [Building a number](#building-a-number) and
> [Decision traces](#decision-traces) show the shape.
