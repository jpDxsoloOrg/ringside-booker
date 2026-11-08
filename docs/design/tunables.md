# Tunables

Every balance number in the game lives in one typed registry. A tunable has a
key, a kind, a default, an allowed range, a unit, a category and a plain-English
description. Formulas read tunables through a typed reader, so a misspelt key is
a compile error. A save can override any tunable, and every override is
validated against its definition.

The code is in `packages/engine/src/core/tunables/`. The engine-wide set of
definitions is in `packages/engine/src/systems/tunables.ts`.

## The rules

1. **Formulas take a `TunableReader` and never read raw numbers.** A formula
   that needs a balance number gets the reader (or the values it read from it)
   as an input. No magic numbers inside formulas, and no reaching into a
   definition's `default` to skip the save's overrides.
2. **0 means 0.** An override of `0`, `false` or `''` is a real value, never
   "use the default". The resolver checks whether a key is present with
   `Object.hasOwn`, not whether its value is truthy, and the tests lock this in.
   A designer who sets a multiplier to 0 gets a multiplier of 0.
3. **Readers are immutable.** Changing a tunable makes a new reader. The step
   that is running keeps the reader it started with, so changing a tunable from
   the UI during a multi-day skip applies from the next day, never halfway
   through a step.
4. **A bad override never crashes a load.** It is dropped, the default applies,
   and the problem goes into the load report.

## Definition fields

Definitions are declared with `defineTunables`. Every definition has:

| Field         | Meaning                                                                        |
| ------------- | ------------------------------------------------------------------------------ |
| `kind`        | `number`, `integer`, `boolean` or `enum`                                       |
| `default`     | The value used when the save does not override it                              |
| `unit`        | What the value measures (see below)                                            |
| `category`    | Display group in the tunables editor, for example `Simulation`                 |
| `description` | What the number does in the game, in plain English. Must not be empty          |
| `docRef`      | Optional design doc anchor for the formula, for example `matches.md#crowd`     |
| `min`, `max`  | `number` and `integer` only: the inclusive allowed range                       |
| `step`        | `number` only, optional: slider step for the editor. A hint, not a rule        |
| `options`     | `enum` only: the allowed values. The value type is the union of these literals |

## Units

| Unit                   | Stored as                                           |
| ---------------------- | --------------------------------------------------- |
| `points`, `points/day` | Raw points on whatever scale the system uses        |
| `percent`              | 0–100, so `15` means 15%                            |
| `probability`          | 0–1, so `0.15` means a 15% chance                   |
| `ratio`, `multiplier`  | A plain factor; `1` means "unchanged"               |
| `days`, `months`       | Whole or fractional calendar time                   |
| `money`, `money/month` | Whole cents (`Cents`). Only allowed on `integer`    |
| `count`                | A number of things                                  |
| `flag`                 | The unit of every `boolean` tunable, and only those |
| `choice`               | The unit of every `enum` tunable, and only those    |

## What `defineTunables` checks

The checks run when the module that declares the tunables loads, so a bad
definition fails immediately, in every test run. All problems are reported at
once in a `TunableDefinitionError`.

- The key matches `^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$`:
  two or more dot-separated camelCase segments, each starting with a lowercase
  letter. The first segment is the owning system (`sim`, `matches`, `economy`,
  `ai`, ...). Examples: `sim.eventLogSize`, `matches.rating.topCompression`.
- `min <= default <= max`, and every number is finite.
- An `integer` tunable has whole-number `default`, `min` and `max`.
- A `money` or `money/month` unit is only used on an `integer` tunable.
- A `probability` range stays inside 0 to 1.
- `flag` goes with `boolean` and `choice` goes with `enum`, both ways round.
- An `enum` has at least one option, no duplicates, and its default is one of
  them.
- `description` and `category` are not empty.

## Adding a system's tunables

1. Create `packages/engine/src/systems/<name>/tunables.ts`:

   ```ts
   import { defineTunables } from '../../core/tunables/define';

   export const economyTunables = defineTunables({
     'economy.merchMarginPercent': {
       kind: 'number',
       default: 35,
       min: 0,
       max: 100,
       step: 0.5,
       unit: 'percent',
       category: 'Economy',
       description: 'Share of merch sales the promotion keeps after costs.',
       docRef: 'economy.md#merch',
     },
   });
   ```

2. Add the set to the `mergeTunables(...)` call in
   `packages/engine/src/systems/tunables.ts`. `mergeTunables` throws at module
   load if two sets define the same key; an object spread would quietly let the
   later one win.
3. Read the values through the reader in the system's formulas:
   `tunables.get('economy.merchMarginPercent')`. The key is checked by the
   compiler against `TunableKey`, the union of every key in `ALL_TUNABLES`.
4. Describe the formula in the system's design doc and point `docRef` at it.

The aggregate is built at compile time, not by registering tunables at runtime,
because the `TunableKey` union has to be known to the compiler for typo safety.
Core code stays independent of the systems: the resolver, validator and
describer are generic over whatever definition set they are given.

Per-world settings chosen at new game (level playing field, season length) are
not tunables. They live in the world's settings. Each rival-promotion shortcut
is its own `ai.*` tunable, and the level playing field setting makes the
formulas treat all of them as off, so the registry needs no special case.

## Overrides

A save stores overrides as `TunableOverrides`: a plain object from tunable key
to value. Only overridden keys are stored, sorted by key, so the same overrides
always serialise to the same JSON. An override equal to the default is still an
override; clearing it is a separate action. `tunableOverridesSchema` (zod) checks
the structure: string keys, and number, boolean or string values.

### Load-time validation

`loadTunables(defs, rawOverrides)` (and `loadEngineTunables`) never throws. Each
override is checked with `validateOverrides`:

| Problem       | When                                                 |
| ------------- | ---------------------------------------------------- |
| `unknownKey`  | No tunable has this key (for example it was removed) |
| `wrongType`   | The value is the wrong type for the tunable's kind   |
| `notFinite`   | A number tunable got `NaN` or an infinity            |
| `notInteger`  | An integer tunable got a fraction                    |
| `belowMin`    | Below the definition's `min`                         |
| `aboveMax`    | Above the definition's `max`                         |
| `notAnOption` | An enum tunable got a value outside its options      |

Valid overrides are kept. Invalid ones are dropped so the default applies, and
each comes back as a `TunableIssue` with the key, the value, the problem code
and a readable message for the load report. An old save that still carries a
removed tunable loads fine and reports the old key as `unknownKey`. Renaming a
tunable needs a save migration that rewrites the override key, or the player's
setting is lost (safely).

`createTunables(defs, overrides)` applies the same policy but leaves out the
issues, for callers that do not need a report.

### Live validation

- `withOverride(reader, key, value)` returns `{ ok: true, reader }` with a new
  reader, or `{ ok: false, issue }` with the same issue shape as a load.
- `withoutOverride(reader, key)` returns a new reader with the default restored.

The reader passed in is never changed.

## Reading tunables

A `TunableReader` gives:

- `get(key)`: the override if the save has one, otherwise the default, typed
  from the definition (`number`, `boolean`, or the enum's option union).
- `isOverridden(key)`: true only when the save stores this key.
- `defaultOf(key)`: the default, ignoring overrides.
- `def(key)`: the whole definition.
- `overrides`: the accepted overrides, sorted, ready to save.

`EngineTunables` is the reader type over every engine tunable, and
`createEngineTunables(overrides)` builds one.

## Listing tunables

`describeTunables(reader, filter?)` returns one plain row per tunable, sorted by
category and then key (plain code-unit order, so the order is the same on every
machine). A row holds the key, category, kind, unit, description, default,
current value, whether it is overridden, and `min`, `max`, `step`, `options`
and `docRef` where they apply. Rows are JSON-safe copies, so they can cross the
Web Worker boundary. The filter can narrow by `category`, `keyPrefix` or
`overriddenOnly`. This is the data source for the tunables list query and the
tunables editor.

## Engine tunables

The simulation core's own tunables, in `core/tunables/simTunables.ts`:

| Key                                    | Kind    | Default | Range    | Unit  | What it does                                                              |
| -------------------------------------- | ------- | ------- | -------- | ----- | ------------------------------------------------------------------------- |
| `sim.traceRetentionPerKind`            | integer | 200     | 0–5000   | count | Full calculation traces kept per kind of result before summarising        |
| `sim.traceSummaryLimit`                | integer | 5000    | 0–100000 | count | Trace summaries kept as history                                           |
| `sim.eventLogSize`                     | integer | 500     | 0–10000  | count | Recent domain events kept in the save                                     |
| `sim.maxEventCascadeDepth`             | integer | 8       | 1–32     | count | How deep a chain of events can go before the rest is stopped              |
| `sim.stopSkipAfterConsecutiveFailures` | integer | 3       | 1–365    | days  | A multi-day skip stops after the same phase fails this many days in a row |
| `sim.commandLogSize`                   | integer | 1000    | 0–100000 | count | Recent commands kept in the command log                                   |

Game systems add their own balance numbers as they are built.
