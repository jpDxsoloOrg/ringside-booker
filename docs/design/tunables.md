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
| `years`                | Whole or fractional years, such as an age           |
| `money`, `money/month` | Whole cents (`Cents`). Only allowed on `integer`    |
| `count`                | A number of things                                  |
| `kilograms`            | A body weight or a weight limit, in kilograms       |
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

Game systems add their own balance numbers as they are built, each in its own
`systems/<name>/tunables.ts`. World generation's are in
`systems/world/tunables.ts`; the name generator's `worldgen.names.*` tunables
are listed in [names.md](names.md#tunables) and the people generator's
`worldgen.people.*` tunables in
[world-generation.md](world-generation.md#tunables).

## Condition tunables

The reference system's placeholders, in `systems/condition/tunables.ts`. See
[the worked example](calculation-traces.md#worked-example).

| Key                                 | Kind    | Default | Range | Unit       | What it does                                                         |
| ----------------------------------- | ------- | ------- | ----- | ---------- | -------------------------------------------------------------------- |
| `condition.fatigueRecoveryPerDay`   | number  | 4       | 0–100 | points/day | Fatigue every person sheds each day before any bonus                 |
| `condition.fatigueRecoveryBonusMax` | integer | 1       | 0–10  | points/day | Largest random extra recovery per day; 0 turns the roll's effect off |

## Workers tunables

In `systems/workers/tunables.ts`: the weight class limits (see
[workers.md](workers.md#weight-class)), the expected push numbers (see
[workers.md](workers.md#expected-push)) and the numbers the doors use (see
[workers.md](workers.md#doors)).

| Key                                         | Kind    | Default | Range  | Unit       | What it does                                                                                                              |
| ------------------------------------------- | ------- | ------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `workers.weightClass.lightweightMaxKg`      | integer | 70      | 40–250 | kilograms  | Heaviest weight that still counts as a lightweight                                                                        |
| `workers.weightClass.cruiserweightMaxKg`    | integer | 93      | 40–250 | kilograms  | Heaviest weight that still counts as a cruiserweight                                                                      |
| `workers.weightClass.lightHeavyweightMaxKg` | integer | 105     | 40–250 | kilograms  | Heaviest weight that still counts as a light heavyweight                                                                  |
| `workers.weightClass.heavyweightMaxKg`      | integer | 130     | 40–250 | kilograms  | Heaviest weight that still counts as a heavyweight; anyone over it is a super heavyweight                                 |
| `workers.expectedPush.footprintMinPop`      | number  | 10      | 0–100  | points     | Lowest popularity a promotion needs in a region for the region to count as part of its fan base                           |
| `workers.expectedPush.minPromotionPop`      | number  | 5       | 0–100  | points     | Lowest promotion popularity a worker's popularity is measured against                                                     |
| `workers.expectedPush.starPop`              | number  | 75      | 0–100  | points     | Popularity among a promotion's fans at which a worker expects the main event anywhere; 100 effectively turns the rule off |
| `workers.expectedPush.mainEventRatio`       | number  | 0.85    | 0–3    | ratio      | Standing against the promotion at which a worker expects the main event                                                   |
| `workers.expectedPush.upperCardRatio`       | number  | 0.65    | 0–3    | ratio      | Standing at which a worker expects the upper card                                                                         |
| `workers.expectedPush.midCardRatio`         | number  | 0.45    | 0–3    | ratio      | Standing at which a worker expects the mid card                                                                           |
| `workers.expectedPush.lowerCardRatio`       | number  | 0.25    | 0–3    | ratio      | Standing at which a worker expects the lower card; anyone below it expects enhancement work                               |
| `workers.popularity.anchorFromCharisma`     | number  | 1       | 0–2    | multiplier | How much of a person's charisma sets their popularity anchor; 0 puts every anchor at 0                                    |
| `workers.popularity.taperSpan`              | number  | 40      | 0–100  | points     | Points above the anchor over which a popularity gain shrinks to nothing; 0 applies the taper floor straight away          |
| `workers.popularity.taperFloor`             | number  | 0.25    | 0–1    | ratio      | Smallest share of a popularity gain that still lands above the anchor; 0 lets gains stop completely                       |
| `workers.popularity.dropBelow`              | number  | 0       | 0–10   | points     | A regional popularity that a change leaves below this is removed; 0 removes only exact zeros                              |
| `workers.momentum.initialPopFactor`         | number  | 1       | 0–2    | multiplier | Share of home-region popularity a first appearance starts momentum from; 0 starts everyone at 0                           |

### Worker rating weights

One weight per role and attribute, generated in
`systems/workers/ratingWeights.ts`: `workers.rating.<role>.<attribute>`, 84
keys in all. Every one is a `number`, range 0–10, step 0.5, unit `ratio`,
category `Worker ratings`, and says how much the attribute counts toward that
role's rating. 0 leaves the attribute out. See
[workers.md](workers.md#role-ratings).

The key segments are the role (`wrestler`, `manager`, `presenter`,
`announcer`, `referee`, `producer`, `booker`) and the attribute (`ringwork`,
`psychology`, `stamina`, `safety`, `athleticism`, `mic`, `charisma`,
`presence`, `officiating`, `broadcasting`, `producing`, `booking`). Defaults,
with a blank cell meaning 0:

| Attribute      | wrestler | manager | presenter | announcer | referee | producer | booker |
| -------------- | -------- | ------- | --------- | --------- | ------- | -------- | ------ |
| `ringwork`     | 3        |         |           |           |         |          |        |
| `psychology`   | 2        | 1       |           | 1         | 1       | 2        | 1.5    |
| `stamina`      | 1        |         |           |           | 0.5     |          |        |
| `safety`       | 1        |         |           |           |         |          |        |
| `athleticism`  | 1.5      |         |           |           |         |          |        |
| `mic`          | 1        | 3       | 2         | 1.5       |         |          |        |
| `charisma`     | 1.5      | 2       | 2         | 0.5       |         |          |        |
| `presence`     | 1        | 1.5     | 2         |           |         |          |        |
| `officiating`  |          |         |           |           | 4       |          |        |
| `broadcasting` |          |         | 1         | 3         |         |          |        |
| `producing`    |          |         |           |           |         | 4        | 1      |
| `booking`      |          |         |           |           |         | 1        | 4      |

## Calendar tunables

How far ahead shows are kept, in `systems/calendar/tunables.ts`. See
[calendar.md](calendar.md#horizon).

| Key                            | Kind    | Default | Range  | Unit | What it does                                                           |
| ------------------------------ | ------- | ------- | ------ | ---- | ---------------------------------------------------------------------- |
| `calendar.scheduleHorizonDays` | integer | 90      | 0–730  | days | How far past today shows are stored; 0 stores only today's shows       |
| `calendar.projectionMaxDays`   | integer | 400     | 0–1100 | days | How far past today the calendar projects shows; 0 turns projection off |
