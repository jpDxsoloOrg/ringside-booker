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
| `stars`                | A star rating, 0–5 in quarter steps (a star cap)    |

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

## Match tunables

The slot numbers of D-10, in `systems/match/tunables.ts`, category
`Match: slots`. See [match-rating.md](match-rating.md#slots).

| Key                                 | Kind    | Default  | Range               | Unit       | What it does                                                         |
| ----------------------------------- | ------- | -------- | ------------------- | ---------- | -------------------------------------------------------------------- |
| `match.slot.weight.preShow`         | number  | 0.4      | 0–5                 | multiplier | How much a pre-show segment counts toward the show score             |
| `match.slot.weight.opener`          | number  | 0.9      | 0–5                 | multiplier | How much the opener counts toward the show score                     |
| `match.slot.weight.midcard`         | number  | 1        | 0–5                 | multiplier | How much a midcard segment counts toward the show score              |
| `match.slot.weight.semiMain`        | number  | 1.25     | 0–5                 | multiplier | How much the semi-main counts toward the show score                  |
| `match.slot.weight.mainEvent`       | number  | 1.75     | 0–5                 | multiplier | How much the main event counts; never less than another slot         |
| `match.slot.durationClass.preShow`  | enum    | short    | short/standard/long | choice     | Duration class of a pre-show segment before its match type shifts it |
| `match.slot.durationClass.opener`   | enum    | standard | short/standard/long | choice     | Duration class of the opener before its match type shifts it         |
| `match.slot.durationClass.midcard`  | enum    | standard | short/standard/long | choice     | Duration class of a midcard segment before its match type shifts it  |
| `match.slot.durationClass.semiMain` | enum    | standard | short/standard/long | choice     | Duration class of the semi-main before its match type shifts it      |
| `match.slot.semiMainFromSlots`      | integer | 4        | 3–12                | count      | Smallest main card that has a semi-main                              |

These are the first `enum` tunables in the engine. A table of keys a formula
reads as numbers is typed `NumberTunableKey` (from `systems/tunables.ts`)
rather than `TunableKey`, which also covers enum and boolean keys.

### Match performance and work rate tunables

The in-ring formulas of MTCH1-03, in the same file: category `Match:
performance` for the worker performance weights, bonuses and penalties and the
side decays, `Match: work rate` for the work rate checks. See
[match-rating.md](match-rating.md#worker-performance) for what each does.

| Key                                        | Kind   | Default | Range | Unit       | What it does                                                |
| ------------------------------------------ | ------ | ------- | ----- | ---------- | ----------------------------------------------------------- |
| `match.perf.inRing.ringwork`               | number | 0.5     | 0–1   | ratio      | Weight of ringwork in in-ring performance                   |
| `match.perf.inRing.psychology`             | number | 0.2     | 0–1   | ratio      | Weight of psychology in in-ring performance                 |
| `match.perf.inRing.athleticism`            | number | 0.2     | 0–1   | ratio      | Weight of athleticism in in-ring performance                |
| `match.perf.inRing.safety`                 | number | 0.1     | 0–1   | ratio      | Weight of safety in in-ring performance                     |
| `match.perf.entertainment.charisma`        | number | 0.5     | 0–1   | ratio      | Weight of charisma in entertainment performance             |
| `match.perf.entertainment.presence`        | number | 0.3     | 0–1   | ratio      | Weight of presence in entertainment performance             |
| `match.perf.entertainment.mic`             | number | 0.2     | 0–1   | ratio      | Weight of mic skill in entertainment performance            |
| `match.perf.styleAffinityBonus`            | number | 3       | 0–50  | points     | Bonus when the style suits the match type                   |
| `match.perf.nonWrestlerPenalty`            | number | 20      | 0–50  | points     | Penalty for a non-wrestler in the ring                      |
| `match.perf.injuredPenalty`                | number | 25      | 0–50  | points     | Penalty for working hurt                                    |
| `match.perf.fatiguePenaltyPerPoint`        | number | 0.15    | 0–1   | ratio      | Performance lost per point of fatigue                       |
| `match.side.depthDecay`                    | number | 0.55    | 0–1   | ratio      | How much each next-best worker on a side counts             |
| `match.sides.depthDecay`                   | number | 0.7     | 0–1   | ratio      | How much each next-best side counts                         |
| `match.workRate.staminaNeed.short`         | number | 0       | 0–100 | points     | Stamina a short singles match asks of each worker           |
| `match.workRate.staminaNeed.standard`      | number | 40      | 0–100 | points     | Stamina a standard singles match asks of each worker        |
| `match.workRate.staminaNeed.long`          | number | 65      | 0–100 | points     | Stamina a long singles match asks of each worker            |
| `match.workRate.sharedLoadExponent`        | number | 0.5     | 0–2   | ratio      | How much bigger matches share the load; 0 means no sharing  |
| `match.workRate.staminaPenaltyPerPoint`    | number | 0.4     | 0–2   | ratio      | Performance lost per point of stamina short                 |
| `match.workRate.psychologyNeed.short`      | number | 20      | 0–100 | points     | Psychology the leader of a short match needs                |
| `match.workRate.psychologyNeed.standard`   | number | 45      | 0–100 | points     | Psychology the leader of a standard match needs             |
| `match.workRate.psychologyNeed.long`       | number | 70      | 0–100 | points     | Psychology the leader of a long match needs                 |
| `match.workRate.psychologyPenaltyPerPoint` | number | 0.5     | 0–2   | ratio      | Work rate lost per point of psychology the leader is short  |
| `match.workRate.spread.short`              | number | 0.8     | 0–2   | multiplier | How far a short match can stray from 50                     |
| `match.workRate.spread.standard`           | number | 1       | 0–2   | multiplier | How far a standard match can stray from 50                  |
| `match.workRate.spread.long`               | number | 1.15    | 0–2   | multiplier | How far a long match can stray from 50                      |
| `match.workRate.varianceSd`                | number | 4       | 0–20  | points     | Spread of the night-to-night work rate roll; 0 turns it off |

### Match crowd, scoring, stars and talking segment tunables

The crowd and scoring formulas of MTCH1-04, in the same file: category `Match:
crowd` for star power, expectation and the crowd score, `Match: scoring` for
soft compression and the segment score blend, `Match: stars` for star ratings
and `Match: talking segments` for the simple talk score. See
[match-rating.md](match-rating.md#star-power) for what each does.

| Key                                       | Kind   | Default | Range  | Unit   | What it does                                                  |
| ----------------------------------------- | ------ | ------- | ------ | ------ | ------------------------------------------------------------- |
| `match.starPower.depthDecay`              | number | 0.5     | 0–1    | ratio  | How much each next-most-popular worker adds to star power     |
| `match.starPower.curve`                   | number | 0.8     | 0–1    | ratio  | Diminishing returns at the top of star power; 0 is linear     |
| `match.expectation.base`                  | number | 25      | 0–100  | points | What a crowd expects before star power, momentum and the slot |
| `match.expectation.starWeight`            | number | 0.5     | 0–1    | ratio  | How much star power raises the expectation                    |
| `match.expectation.momentumWeight`        | number | 0.1     | 0–1    | ratio  | How much momentum moves the expectation                       |
| `match.expectation.slot.preShow`          | number | −8      | −30–30 | points | Expectation change on the pre-show                            |
| `match.expectation.slot.opener`           | number | −3      | −30–30 | points | Expectation change for the opener                             |
| `match.expectation.slot.midcard`          | number | 0       | −30–30 | points | Expectation change in the midcard                             |
| `match.expectation.slot.semiMain`         | number | 4       | −30–30 | points | Expectation change for the semi-main                          |
| `match.expectation.slot.mainEvent`        | number | 8       | −30–30 | points | Expectation change for the main event                         |
| `match.expectation.importance.house`      | number | −6      | −30–30 | points | Expectation change at a house show                            |
| `match.expectation.importance.minor`      | number | −3      | −30–30 | points | Expectation change at a minor event                           |
| `match.expectation.importance.regular`    | number | 0       | −30–30 | points | Expectation change at a regular event                         |
| `match.expectation.importance.major`      | number | 4       | −30–30 | points | Expectation change at a major event                           |
| `match.expectation.importance.flagship`   | number | 8       | −30–30 | points | Expectation change at a flagship event                        |
| `match.expectation.televised`             | number | 2       | −30–30 | points | Expectation change when the show is on TV                     |
| `match.crowd.performanceWeight`           | number | 0.55    | 0–1    | ratio  | Weight of work rate (or talk) in what was delivered           |
| `match.crowd.entertainmentWeight`         | number | 0.25    | 0–1    | ratio  | Weight of entertainment in what was delivered                 |
| `match.crowd.starWeight`                  | number | 0.2     | 0–1    | ratio  | Weight of star power in what was delivered                    |
| `match.crowd.surpriseWeight`              | number | 0.5     | 0–1    | ratio  | How much beating or missing expectation moves the crowd       |
| `match.crowd.varianceSd`                  | number | 3       | 0–20   | points | Spread of the crowd-on-the-night roll; 0 turns it off         |
| `match.compression.knee`                  | number | 85      | 50–100 | points | Where soft compression starts; 100 turns it off               |
| `match.compression.factor`                | number | 0.4     | 0–1    | ratio  | Share of each point above the knee that is kept               |
| `match.blend.workRateShare.mainstream`    | number | 0.45    | 0–1    | ratio  | Work rate share of a match's score, mainstream promotion      |
| `match.blend.workRateShare.traditional`   | number | 0.5     | 0–1    | ratio  | Work rate share of a match's score, traditional promotion     |
| `match.blend.workRateShare.technical`     | number | 0.65    | 0–1    | ratio  | Work rate share of a match's score, technical promotion       |
| `match.blend.workRateShare.hardHitting`   | number | 0.6     | 0–1    | ratio  | Work rate share of a match's score, hard-hitting promotion    |
| `match.blend.workRateShare.hardcore`      | number | 0.5     | 0–1    | ratio  | Work rate share of a match's score, hardcore promotion        |
| `match.blend.workRateShare.highFlying`    | number | 0.6     | 0–1    | ratio  | Work rate share of a match's score, high-flying promotion     |
| `match.blend.workRateShare.entertainment` | number | 0.3     | 0–1    | ratio  | Work rate share of a match's score, entertainment promotion   |
| `match.stars.performanceShare`            | number | 0.7     | 0–1    | ratio  | Share of work rate (or talk) in a star rating                 |
| `match.stars.zeroAt`                      | number | 15      | 0–80   | points | The blended score worth no stars                              |
| `match.stars.pointsPerStar`               | number | 15      | 0–30   | points | Points above the zero for each star; 0 gives the cap          |
| `match.stars.cap.short`                   | number | 3.5     | 0–5    | stars  | The most stars a short match can get                          |
| `match.stars.cap.standard`                | number | 4.75    | 0–5    | stars  | The most stars a standard match can get                       |
| `match.stars.cap.long`                    | number | 5       | 0–5    | stars  | The most stars a long match can get                           |
| `match.stars.cap.angle`                   | number | 4       | 0–5    | stars  | The most stars a talking segment can get                      |
| `match.angle.talkShare`                   | number | 0.35    | 0–1    | ratio  | Share of talk in a talking segment's score                    |
| `match.angle.varianceSd`                  | number | 4       | 0–20   | points | Spread of the how-the-promo-landed roll; 0 turns it off       |

### Match result tunables

How a finish changes a resolved match's rating and how the finish decided on
the night is picked (MTCH2-02), in the same file, category `Match results`.
See [match-finishes.md](match-finishes.md#finish-effects) for what each does.

| Key                                   | Kind   | Default | Range | Unit       | What it does                                                 |
| ------------------------------------- | ------ | ------- | ----- | ---------- | ------------------------------------------------------------ |
| `match.finish.effectScale`            | number | 1       | 0–3   | multiplier | How strongly a finish changes work rate and crowd; 0 is none |
| `match.finish.drawCrowdPenalty`       | number | 2       | 0–20  | points     | Crowd lost when a match ends without a winner                |
| `match.autoFinish.heelCheatingFactor` | number | 2       | 0–10  | multiplier | How much more often a heel winner's finish is a cheating one |

The auto-winner and Random winners (MTCH2-03) add to the same category. See
[match-finishes.md](match-finishes.md#auto-winner).

| Key                                  | Kind   | Default | Range  | Unit       | What it does                                                         |
| ------------------------------------ | ------ | ------- | ------ | ---------- | -------------------------------------------------------------------- |
| `match.autoWinner.popularityWeight`  | number | 0.6     | 0–3    | multiplier | Points per point of a side's mean popularity in the show's region    |
| `match.autoWinner.momentumWeight`    | number | 0.15    | 0–1    | multiplier | Points per point of a side's mean momentum                           |
| `match.autoWinner.push.mainEvent`    | number | 30      | 0–100  | points     | Points for a main eventer                                            |
| `match.autoWinner.push.upperCard`    | number | 22      | 0–100  | points     | Points for an upper-card worker                                      |
| `match.autoWinner.push.midCard`      | number | 14      | 0–100  | points     | Points for a mid-card worker                                         |
| `match.autoWinner.push.lowerCard`    | number | 7       | 0–100  | points     | Points for a lower-card worker                                       |
| `match.autoWinner.push.enhancement`  | number | 0       | 0–100  | points     | Points for enhancement talent                                        |
| `match.autoWinner.push.none`         | number | 0       | 0–100  | points     | Points for someone with no push (or not employed here)               |
| `match.autoWinner.alignment.face`    | number | 2       | −20–20 | points     | Points for a face                                                    |
| `match.autoWinner.alignment.heel`    | number | 0       | −20–20 | points     | Points for a heel                                                    |
| `match.autoWinner.alignment.tweener` | number | 1       | −20–20 | points     | Points for a tweener                                                 |
| `match.autoWinner.randomness`        | number | 5       | 0–200  | points     | Most unpredictability per side; 0 = always the same winner           |
| `match.randomWinners.randomness`     | number | 60      | 1–1000 | points     | Most unpredictability per side in Random winners mode; never below 1 |

### Aftermath momentum tunables

How much one match result moves a competitor's momentum (MTCH3-02), in
`systems/match/aftermath/momentumTunables.ts`, category `Aftermath`. See
[match-aftermath.md](match-aftermath.md#momentum-gain) for what each does.

| Key                                       | Kind   | Default | Range | Unit   | What it does                                             |
| ----------------------------------------- | ------ | ------- | ----- | ------ | -------------------------------------------------------- |
| `match.momentum.winBase`                  | number | 5       | 0–50  | points | Momentum a win is worth                                  |
| `match.momentum.winGapPerPoint`           | number | 0.2     | 0–2   | ratio  | Extra momentum per point the beaten opponent was hotter  |
| `match.momentum.winMax`                   | number | 15      | 0–50  | points | Most momentum one win can give                           |
| `match.momentum.lossBase`                 | number | 5       | 0–50  | points | Momentum a loss costs                                    |
| `match.momentum.lossGapPerPoint`          | number | 0.2     | 0–2   | ratio  | Extra momentum lost per point the winner was colder      |
| `match.momentum.lossMax`                  | number | 15      | 0–50  | points | Most momentum one loss can cost                          |
| `match.momentum.draw`                     | number | 2       | 0–50  | points | Momentum a draw costs                                    |
| `match.momentum.multiSideWinPerExtraSide` | number | 1       | 0–10  | points | Extra momentum for winning, per side beyond two          |
| `match.momentum.multiSideLossShare`       | number | 0.35    | 0–1   | ratio  | Smallest share of a loss kept in a match with many sides |
| `match.momentum.greatMatchFrom`           | number | 85      | 0–100 | points | Segment score from which a match counts as great         |
| `match.momentum.greatMatchBonus`          | number | 2       | 0–20  | points | Momentum everyone in a great match gains                 |
| `match.momentum.maxPerSegment`            | number | 15      | 0–50  | points | Most momentum one match can give or take                 |

The weekly drift back toward a resting point (MTCH3-07) is in the same file
and category. See [match-aftermath.md](match-aftermath.md#momentum-drift).

| Key                               | Kind   | Default | Range    | Unit   | What it does                                                                         |
| --------------------------------- | ------ | ------- | -------- | ------ | ------------------------------------------------------------------------------------ |
| `match.momentum.weeklyDrift`      | number | 0.12    | 0–1      | ratio  | Share of the way back to the resting point momentum moves each week (0 turns it off) |
| `match.momentum.activeDriftShare` | number | 0.5     | 0–1      | ratio  | Share of the weekly cooling off a worker who wrestled that week still gets           |
| `match.momentum.driftTarget`      | number | 0       | −100–100 | points | The momentum everyone drifts back toward each week                                   |

### Aftermath spread and storage tunables

Where a match's popularity change spreads and how many stored aftermaths each
worker keeps (MTCH3-03), appended to `systems/match/aftermath/tunables.ts`,
category `Aftermath`. See
[match-aftermath.md](match-aftermath.md#regional-spread).

| Key                               | Kind    | Default | Range | Unit  | What it does                                                                                           |
| --------------------------------- | ------- | ------- | ----- | ----- | ------------------------------------------------------------------------------------------------------ |
| `match.popularity.neighbourSpill` | number  | 0.4     | 0–1   | ratio | Share of a match's popularity change each neighbour region gets                                        |
| `match.aftermath.keepPerPerson`   | integer | 10      | 1–100 | count | How many recent match aftermaths are kept for each worker                                              |
| `match.popularity.tvSpill`        | number  | 0.3     | 0–1   | ratio | Share of the show's TV reach a match's popularity change gets in TV regions (MTCH3-05); 0 turns it off |

## Shows tunables

Show night's numbers (EVT3), in `systems/shows/tunables.ts`, category `Shows`.
See [show-night.md](show-night.md) for what each does. EVT3 never writes
morale, momentum or popularity, so nothing here tunes them.

| Key                                   | Kind    | Default | Range  | Unit       | What it does                                                            |
| ------------------------------------- | ------- | ------- | ------ | ---------- | ----------------------------------------------------------------------- |
| `shows.score.preShowFactor`           | number  | 0       | 0–2    | multiplier | How much pre-show segments count toward the show score (0 = not at all) |
| `shows.emptySlotPenalty`              | number  | 5       | 0–50   | points     | Show score lost for each empty main-card slot                           |
| `shows.offscreen.base`                | number  | 12      | 0–100  | points     | Starting score of a show run off-screen                                 |
| `shows.offscreen.prestigeWeight`      | number  | 0.3     | 0–2    | multiplier | Points per point of the promotion's prestige                            |
| `shows.offscreen.popularityWeight`    | number  | 0.35    | 0–2    | multiplier | Points per point of the roster's popularity                             |
| `shows.offscreen.importance.house`    | number  | −6      | −30–30 | points     | Points for an off-screen house show                                     |
| `shows.offscreen.importance.minor`    | number  | −3      | −30–30 | points     | Points for an off-screen minor show                                     |
| `shows.offscreen.importance.regular`  | number  | 0       | −30–30 | points     | Points for an off-screen regular show                                   |
| `shows.offscreen.importance.major`    | number  | 4       | −30–30 | points     | Points for an off-screen major show                                     |
| `shows.offscreen.importance.flagship` | number  | 8       | −30–30 | points     | Points for an off-screen flagship show                                  |
| `shows.offscreen.spread`              | number  | 8       | 0–50   | points     | Largest random swing either way (0 = no randomness)                     |
| `shows.titles.drawCountsAsDefence`    | boolean | true    |        | flag       | A drawn title match counts as a successful defence                      |
| `shows.stars.zeroAt`                  | number  | 35      | 0–80   | points     | Show score that earns zero stars                                        |
| `shows.stars.pointsPerStar`           | number  | 12      | 0–30   | points     | Show score points per star (0 = any score above zero-stars earns 5)     |

## Booking tunables

The thresholds a card is held to before it can be locked (EVT2-04), in
`systems/booking/tunables.ts`, category `Booking`. See
[booking.md](booking.md#validation).

| Key                                  | Kind    | Default | Range | Unit  | What it does                                                                             |
| ------------------------------------ | ------- | ------- | ----- | ----- | ---------------------------------------------------------------------------------------- |
| `booking.maxAppearancesPerShow`      | integer | 4       | 1–6   | count | Most segments of any kind one person may appear in on one show                           |
| `booking.maxMatchesPerPersonPerShow` | integer | 3       | 1–4   | count | Most matches one person may wrestle on one show (each match past the first is a warning) |
| `booking.minFilledMainShare`         | number  | 0.5     | 0–1   | ratio | Share of main-card slots that must be filled to lock (0 = no minimum)                    |
| `booking.requireMainEvent`           | boolean | true    |       | flag  | The last main-card slot must be filled to lock                                           |

## Promotion popularity tunables

How one show moves a promotion's popularity in each region it reached (EVT5),
in `systems/promoPop/tunables.ts`, category `Promotion popularity`. See
[promotion-popularity.md](promotion-popularity.md). Every one is 0-means-0.

| Key                                   | Kind    | Default | Range  | Unit       | What it does                                                                                 |
| ------------------------------------- | ------- | ------- | ------ | ---------- | -------------------------------------------------------------------------------------------- |
| `promoPop.neighbourReach`             | number  | 0.5     | 0–1    | ratio      | How much of a show a neighbouring region sees (0 = neighbours not reached)                   |
| `promoPop.tvReach.tier0`              | number  | 0.1     | 0–1    | ratio      | How much of a show a region sees on a reach tier 0 network (0 = not reached that way)        |
| `promoPop.tvReach.tier1`              | number  | 0.2     | 0–1    | ratio      | Same, reach tier 1                                                                           |
| `promoPop.tvReach.tier2`              | number  | 0.3     | 0–1    | ratio      | Same, reach tier 2                                                                           |
| `promoPop.tvReach.tier3`              | number  | 0.45    | 0–1    | ratio      | Same, reach tier 3                                                                           |
| `promoPop.tvReach.tier4`              | number  | 0.6     | 0–1    | ratio      | Same, reach tier 4                                                                           |
| `promoPop.expect.popularityWeight`    | number  | 0.6     | 0–2    | ratio      | Expected score per point of popularity in the region                                         |
| `promoPop.expect.prestigeWeight`      | number  | 0.2     | 0–1    | ratio      | Expected score per point of prestige                                                         |
| `promoPop.expect.importance.house`    | number  | 0.8     | 0–3    | multiplier | Event size factor on the popularity part of the expectation, house show                      |
| `promoPop.expect.importance.minor`    | number  | 0.9     | 0–3    | multiplier | Same, minor show                                                                             |
| `promoPop.expect.importance.regular`  | number  | 1       | 0–3    | multiplier | Same, regular show                                                                           |
| `promoPop.expect.importance.major`    | number  | 1.15    | 0–3    | multiplier | Same, major show                                                                             |
| `promoPop.expect.importance.flagship` | number  | 1.3     | 0–3    | multiplier | Same, flagship show                                                                          |
| `promoPop.deadZone`                   | number  | 3       | 0–20   | points     | Score margin either way that changes nothing (0 = any margin counts)                         |
| `promoPop.blowoutMargin`              | number  | 25      | 0–100  | points     | Score margin that earns the full gain or loss                                                |
| `promoPop.maxGainPerShow`             | number  | 3       | 0–10   | points     | Most popularity one show can win in a region before shaping (0 = no gains)                   |
| `promoPop.maxLossPerShow`             | number  | 2.5     | 0–10   | points     | Most popularity one show can lose in a region before shaping (0 = no losses)                 |
| `promoPop.impact.house`               | number  | 0.4     | 0–3    | multiplier | How much a house show moves popularity (0 = nothing)                                         |
| `promoPop.impact.minor`               | number  | 0.7     | 0–3    | multiplier | Same, minor show                                                                             |
| `promoPop.impact.regular`             | number  | 1       | 0–3    | multiplier | Same, regular show                                                                           |
| `promoPop.impact.major`               | number  | 1.3     | 0–3    | multiplier | Same, major show                                                                             |
| `promoPop.impact.flagship`            | number  | 1.6     | 0–3    | multiplier | Same, flagship show                                                                          |
| `promoPop.diminishingPower`           | number  | 1.5     | 0–5    | ratio      | How sharply gains shrink as popularity rises (0 = no diminishing)                            |
| `promoPop.lossFullFrom`               | number  | 25      | 0–100  | points     | Popularity from which a bad show costs its full loss (0 = losses never scaled down)          |
| `promoPop.monthlyGainCap`             | number  | 3       | 0–100  | points     | Most popularity shows can win in one region in one calendar month (0 = no gains at all)      |
| `promoPop.keepShowChangesDays`        | integer | 365     | 0–3650 | days       | How long each show's popularity record is kept for the results page (0 = cleared on the 1st) |

## Finance tunables

The economy's numbers (ECO1), in `systems/finance/tunables.ts`, category
`Finances`, each with a docRef into [finances.md](finances.md). The set starts
empty: ECO1-02 adds reach and size, ECO1-03 wages and medical, and ECO1-04 show
costs and importance, each in its own block.

### Reach and size tunables

How big a company is (ECO1-02). See
[finances.md](finances.md#reach-and-size). Every weight is 0-means-0.

| Key                                  | Kind   | Default | Range | Unit   | What it does                                                                               |
| ------------------------------------ | ------ | ------- | ----- | ------ | ------------------------------------------------------------------------------------------ |
| `finance.reach.weight.homeRegion`    | number | 1       | 0–10  | ratio  | How much popularity in the home region counts towards reach; 0 = this level does not count |
| `finance.reach.weight.homeCountry`   | number | 3       | 0–10  | ratio  | Same, home country                                                                         |
| `finance.reach.weight.homeContinent` | number | 2       | 0–10  | ratio  | Same, home continent                                                                       |
| `finance.reach.weight.world`         | number | 2       | 0–10  | ratio  | Same, whole world                                                                          |
| `finance.size.regionalAt`            | number | 6       | 0–100 | points | Reach at which a company counts as Regional                                                |
| `finance.size.nationalAt`            | number | 25      | 0–100 | points | Reach at which a company counts as National                                                |
| `finance.size.continentalAt`         | number | 45      | 0–100 | points | Reach at which a company counts as Continental                                             |
| `finance.size.globalAt`              | number | 70      | 0–100 | points | Reach at which a company counts as Global                                                  |

Wages and medical (ECO1-03), amounts in cents:

| Key                                  | Kind    | Default | Range        | Unit        | Meaning                                                             |
| ------------------------------------ | ------- | ------- | ------------ | ----------- | ------------------------------------------------------------------- |
| `finance.payOwnerAndBooker`          | boolean | false   |              | flag        | Pay the owner's and booker's contracts a wage too                   |
| `finance.wages.multiplier`           | number  | 1       | 0–5          | multiplier  | Every monthly wage is multiplied by this (0 = nobody is paid)       |
| `finance.medical.perContract.level0` | integer | 0       | 0–10,000,000 | money/month | Medical cost per person under contract each month at policy level 0 |
| `finance.medical.perContract.level1` | integer | 15,000  | 0–10,000,000 | money/month | Same, policy level 1                                                |
| `finance.medical.perContract.level2` | integer | 60,000  | 0–10,000,000 | money/month | Same, policy level 2                                                |
| `finance.medical.perContract.level3` | integer | 150,000 | 0–10,000,000 | money/month | Same, policy level 3                                                |

### Show costs and policy tunables

Show costs and the policy preview (ECO1-04), amounts in cents. See
[finances.md](finances.md#show-costs):

| Key                                    | Kind    | Default | Range        | Unit       | Meaning                                                                     |
| -------------------------------------- | ------- | ------- | ------------ | ---------- | --------------------------------------------------------------------------- |
| `finance.travel.perWorker.level0`      | integer | 0       | 0–10,000,000 | money      | Travel cost per paid worker per show at travel policy level 0               |
| `finance.travel.perWorker.level1`      | integer | 5,000   | 0–10,000,000 | money      | Same, level 1                                                               |
| `finance.travel.perWorker.level2`      | integer | 20,000  | 0–10,000,000 | money      | Same, level 2                                                               |
| `finance.travel.perWorker.level3`      | integer | 50,000  | 0–10,000,000 | money      | Same, level 3                                                               |
| `finance.catering.perShow.level0`      | integer | 0       | 0–10,000,000 | money      | Catering cost per show at catering policy level 0                           |
| `finance.catering.perShow.level1`      | integer | 25,000  | 0–10,000,000 | money      | Same, level 1                                                               |
| `finance.catering.perShow.level2`      | integer | 80,000  | 0–10,000,000 | money      | Same, level 2                                                               |
| `finance.catering.perShow.level3`      | integer | 250,000 | 0–10,000,000 | money      | Same, level 3                                                               |
| `finance.travel.domesticMultiplier`    | number  | 1.5     | 0–10         | multiplier | Travel × this for a show in the home country, outside the home region       |
| `finance.travel.abroadMultiplier`      | number  | 3       | 0–10         | multiplier | Travel × this for a show in another country                                 |
| `finance.show.importance.house`        | number  | 0.5     | 0–10         | multiplier | Travel and catering × this for a house show                                 |
| `finance.show.importance.minor`        | number  | 0.75    | 0–10         | multiplier | Same, minor show                                                            |
| `finance.show.importance.regular`      | number  | 1       | 0–10         | multiplier | Same, regular show                                                          |
| `finance.show.importance.major`        | number  | 1.5     | 0–10         | multiplier | Same, major show                                                            |
| `finance.show.importance.flagship`     | number  | 2.5     | 0–10         | multiplier | Same, flagship show                                                         |
| `finance.show.offscreenWorkersPerSlot` | integer | 2       | 0–6          | count      | Workers counted per main-card slot when a show has no card booked in detail |
| `finance.travel.coveredLevel`          | integer | 3       | 0–3          | count      | The travel level a contract with the travel perk is always paid at          |
| `finance.preview.recentShows`          | integer | 5       | 1–20         | count      | Recent shows the policy preview averages to guess how many work a show      |

## Box office tunables

The crowd forecast (EVT6-01) and the show-day money (EVT6-04), in
`systems/boxOffice/tunables.ts`, category `Box office`. See
[box-office.md](box-office.md#forecast). Every one is 0-means-0, and money is
in whole cents.

| Key                                    | Kind    | Default | Range     | Unit       | Meaning                                                                                             |
| -------------------------------------- | ------- | ------- | --------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `boxOffice.draw.atFullPopularity`      | integer | 30,000  | 0–200,000 | count      | Crowd a show draws at popularity 100, before the other lines                                        |
| `boxOffice.draw.curve`                 | number  | 3       | 1–6       | ratio      | How sharply crowds grow with popularity; higher means small companies draw less                     |
| `boxOffice.draw.walkUp`                | integer | 80      | 0–5,000   | count      | People who turn up to any show, however unknown the company                                         |
| `boxOffice.marketing.perLevel`         | number  | 0.04    | 0–0.5     | ratio      | Crowd added per marketing level (×(1 + level × this))                                               |
| `boxOffice.importance.house`           | number  | 0.35    | 0–5       | multiplier | Crowd × this for a house show                                                                       |
| `boxOffice.importance.minor`           | number  | 0.7     | 0–5       | multiplier | Same, minor show                                                                                    |
| `boxOffice.importance.regular`         | number  | 1       | 0–5       | multiplier | Same, regular show                                                                                  |
| `boxOffice.importance.major`           | number  | 1.5     | 0–5       | multiplier | Same, major show                                                                                    |
| `boxOffice.importance.flagship`        | number  | 2.2     | 0–5       | multiplier | Same, flagship show                                                                                 |
| `boxOffice.recentForm.windowDays`      | integer | 120     | 0–730     | days       | How far back recent form looks for completed shows ([recent form](box-office.md#recent-form))       |
| `boxOffice.recentForm.minShows`        | integer | 3       | 0–20      | count      | Recent shows needed before recent form moves the crowd                                              |
| `boxOffice.recentForm.par`             | number  | 50      | 0–100     | points     | A show score that neither helps nor hurts the draw                                                  |
| `boxOffice.recentForm.fullSwingPoints` | number  | 25      | 1–100     | points     | Average score above or below par that gives the full swing                                          |
| `boxOffice.recentForm.maxSwing`        | number  | 0.15    | 0–0.5     | ratio      | Most recent form can add to or take from the crowd (0 = recent form off)                            |
| `boxOffice.recentForm.countHouseShows` | boolean | false   |           | flag       | Count house shows in recent form                                                                    |
| `boxOffice.fatigue.windowDays`         | integer | 28      | 0–365     | days       | How far back big-show fatigue looks for other big shows ([fatigue](box-office.md#big-show-fatigue)) |
| `boxOffice.fatigue.freeShows`          | integer | 1       | 0–10      | count      | Other big shows in the window that cost nothing                                                     |
| `boxOffice.fatigue.perExtraShow`       | number  | 0.2     | 0–1       | ratio      | Crowd lost for each other big show beyond the free ones (0 = no fatigue)                            |
| `boxOffice.fatigue.floor`              | number  | 0.25    | 0–1       | multiplier | The least of the crowd fatigue can leave                                                            |
| `boxOffice.crowd.spread`               | number  | 0.1     | 0–0.5     | ratio      | How far the real crowd can land from the forecast, either way; also the width of the forecast range |

## Office tunables

The Office's numbers (DAY2), in `systems/office/tunables.ts`, category
`Office`, each with a docRef into [office.md](office.md#history) (DAY2-02's
headline scope points at `office.md#headline-popularity`). DAY2-03 adds its own
keys to the same file.

| Key                              | Kind    | Default | Range | Unit  | Meaning                                                                          |
| -------------------------------- | ------- | ------- | ----- | ----- | -------------------------------------------------------------------------------- |
| `office.history.fullDetailWeeks` | integer | 52      | 4–520 | count | Weeks kept at full weekly detail before older weeks are thinned to one per month |
| `office.trend.weeks`             | integer | 8       | 2–52  | count | Weeks shown in a KPI sparkline                                                   |
| `office.delta.lookbackDays`      | integer | 7       | 1–90  | days  | How far back a KPI delta compares                                                |

| Key                                    | Kind    | Default | Range        | Unit       | Meaning                                                                                             |
| -------------------------------------- | ------- | ------- | ------------ | ---------- | --------------------------------------------------------------------------------------------------- |
| `boxOffice.draw.atFullPopularity`      | integer | 30,000  | 0–200,000    | count      | Crowd a show draws at popularity 100, before the other lines                                        |
| `boxOffice.draw.curve`                 | number  | 3       | 1–6          | ratio      | How sharply crowds grow with popularity; higher means small companies draw less                     |
| `boxOffice.draw.walkUp`                | integer | 80      | 0–5,000      | count      | People who turn up to any show, however unknown the company                                         |
| `boxOffice.marketing.perLevel`         | number  | 0.04    | 0–0.5        | ratio      | Crowd added per marketing level (×(1 + level × this))                                               |
| `boxOffice.importance.house`           | number  | 0.35    | 0–5          | multiplier | Crowd × this for a house show                                                                       |
| `boxOffice.importance.minor`           | number  | 0.7     | 0–5          | multiplier | Same, minor show                                                                                    |
| `boxOffice.importance.regular`         | number  | 1       | 0–5          | multiplier | Same, regular show                                                                                  |
| `boxOffice.importance.major`           | number  | 1.5     | 0–5          | multiplier | Same, major show                                                                                    |
| `boxOffice.importance.flagship`        | number  | 2.2     | 0–5          | multiplier | Same, flagship show                                                                                 |
| `boxOffice.recentForm.windowDays`      | integer | 120     | 0–730        | days       | How far back recent form looks for completed shows ([recent form](box-office.md#recent-form))       |
| `boxOffice.recentForm.minShows`        | integer | 3       | 0–20         | count      | Recent shows needed before recent form moves the crowd                                              |
| `boxOffice.recentForm.par`             | number  | 50      | 0–100        | points     | A show score that neither helps nor hurts the draw                                                  |
| `boxOffice.recentForm.fullSwingPoints` | number  | 25      | 1–100        | points     | Average score above or below par that gives the full swing                                          |
| `boxOffice.recentForm.maxSwing`        | number  | 0.15    | 0–0.5        | ratio      | Most recent form can add to or take from the crowd (0 = recent form off)                            |
| `boxOffice.recentForm.countHouseShows` | boolean | false   |              | flag       | Count house shows in recent form                                                                    |
| `boxOffice.fatigue.windowDays`         | integer | 28      | 0–365        | days       | How far back big-show fatigue looks for other big shows ([fatigue](box-office.md#big-show-fatigue)) |
| `boxOffice.fatigue.freeShows`          | integer | 1       | 0–10         | count      | Other big shows in the window that cost nothing                                                     |
| `boxOffice.fatigue.perExtraShow`       | number  | 0.2     | 0–1          | ratio      | Crowd lost for each other big show beyond the free ones (0 = no fatigue)                            |
| `boxOffice.fatigue.floor`              | number  | 0.25    | 0–1          | multiplier | The least of the crowd fatigue can leave                                                            |
| `boxOffice.crowd.spread`               | number  | 0.1     | 0–0.5        | ratio      | How far the real crowd can land from the forecast, either way; also the width of the forecast range |
| `boxOffice.ticket.base`                | integer | 1,000   | 0–100,000    | money      | Ticket price every show starts from, $10 ([ticket price](box-office.md#ticket-price))               |
| `boxOffice.ticket.perReachPoint`       | integer | 60      | 0–10,000     | money      | Ticket price added per point of the company's reach                                                 |
| `boxOffice.ticket.importance.house`    | number  | 0.8     | 0–5          | multiplier | Ticket price × this for a house show                                                                |
| `boxOffice.ticket.importance.minor`    | number  | 0.9     | 0–5          | multiplier | Same, minor show                                                                                    |
| `boxOffice.ticket.importance.regular`  | number  | 1       | 0–5          | multiplier | Same, regular show                                                                                  |
| `boxOffice.ticket.importance.major`    | number  | 1.5     | 0–5          | multiplier | Same, major show                                                                                    |
| `boxOffice.ticket.importance.flagship` | number  | 2       | 0–5          | multiplier | Same, flagship show                                                                                 |
| `boxOffice.rent.base`                  | integer | 25,000  | 0–10,000,000 | money      | Rent every venue charges for a show, $250 ([venue rent](box-office.md#venue-rent))                  |
| `boxOffice.rent.perSeat`               | integer | 350     | 0–100,000    | money      | Rent per seat of capacity, sold or not                                                              |
| `boxOffice.rent.kind.hall`             | number  | 1       | 0–5          | multiplier | Seat rent × this in a hall                                                                          |
| `boxOffice.rent.kind.theatre`          | number  | 1.1     | 0–5          | multiplier | Same, theatre                                                                                       |
| `boxOffice.rent.kind.arena`            | number  | 1.25    | 0–5          | multiplier | Same, arena                                                                                         |
| `boxOffice.rent.kind.stadium`          | number  | 3.5     | 0–5          | multiplier | Same, stadium                                                                                       |
| `boxOffice.rent.kind.studio`           | number  | 0.6     | 0–5          | multiplier | Same, studio                                                                                        |
| `boxOffice.rent.kind.outdoor`          | number  | 1.2     | 0–5          | multiplier | Same, outdoor venue                                                                                 |
| `boxOffice.rent.ownVenueFactor`        | number  | 0.25    | 0–1          | ratio      | Share of the rent paid in a venue that belongs to the company                                       |
| `boxOffice.merch.perHead`              | integer | 500     | 0–100,000    | money      | Merch each fan buys at an average show, $5 ([live merch](box-office.md#live-merch))                 |
| `boxOffice.merch.qualityLow`           | number  | 0.8     | 0–3          | multiplier | Merch × this after a show scoring 0                                                                 |
| `boxOffice.merch.qualityHigh`          | number  | 1.2     | 0–3          | multiplier | Merch × this after a show scoring 100                                                               |
| `boxOffice.merch.spread`               | number  | 0.05    | 0–0.5        | ratio      | How far merch sales can swing on the night, either way                                              |
| `boxOffice.gate.workerShareCap`        | number  | 0.5     | 0–1          | ratio      | Most of the ticket money worker shares can take ([worker shares](box-office.md#worker-shares))      |
| `boxOffice.merch.workerShareCap`       | number  | 0.5     | 0–1          | ratio      | Most of the merch money worker shares can take                                                      |

The crowd forecast (EVT6-01), in `systems/boxOffice/tunables.ts`, category
`Box office`. See [box-office.md](box-office.md#forecast). Every one is
0-means-0. The venue numbers (EVT6-02) are in
`systems/boxOffice/venueTunables.ts`, spread into the same set.

| Key                                     | Kind    | Default | Range     | Unit       | Meaning                                                                                                        |
| --------------------------------------- | ------- | ------- | --------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `boxOffice.draw.atFullPopularity`       | integer | 30,000  | 0–200,000 | count      | Crowd a show draws at popularity 100, before the other lines                                                   |
| `boxOffice.draw.curve`                  | number  | 3       | 1–6       | ratio      | How sharply crowds grow with popularity; higher means small companies draw less                                |
| `boxOffice.draw.walkUp`                 | integer | 80      | 0–5,000   | count      | People who turn up to any show, however unknown the company                                                    |
| `boxOffice.marketing.perLevel`          | number  | 0.04    | 0–0.5     | ratio      | Crowd added per marketing level (×(1 + level × this))                                                          |
| `boxOffice.importance.house`            | number  | 0.35    | 0–5       | multiplier | Crowd × this for a house show                                                                                  |
| `boxOffice.importance.minor`            | number  | 0.7     | 0–5       | multiplier | Same, minor show                                                                                               |
| `boxOffice.importance.regular`          | number  | 1       | 0–5       | multiplier | Same, regular show                                                                                             |
| `boxOffice.importance.major`            | number  | 1.5     | 0–5       | multiplier | Same, major show                                                                                               |
| `boxOffice.importance.flagship`         | number  | 2.2     | 0–5       | multiplier | Same, flagship show                                                                                            |
| `boxOffice.recentForm.windowDays`       | integer | 120     | 0–730     | days       | How far back recent form looks for completed shows ([recent form](box-office.md#recent-form))                  |
| `boxOffice.recentForm.minShows`         | integer | 3       | 0–20      | count      | Recent shows needed before recent form moves the crowd                                                         |
| `boxOffice.recentForm.par`              | number  | 50      | 0–100     | points     | A show score that neither helps nor hurts the draw                                                             |
| `boxOffice.recentForm.fullSwingPoints`  | number  | 25      | 1–100     | points     | Average score above or below par that gives the full swing                                                     |
| `boxOffice.recentForm.maxSwing`         | number  | 0.15    | 0–0.5     | ratio      | Most recent form can add to or take from the crowd (0 = recent form off)                                       |
| `boxOffice.recentForm.countHouseShows`  | boolean | false   |           | flag       | Count house shows in recent form                                                                               |
| `boxOffice.fatigue.windowDays`          | integer | 28      | 0–365     | days       | How far back big-show fatigue looks for other big shows ([fatigue](box-office.md#big-show-fatigue))            |
| `boxOffice.fatigue.freeShows`           | integer | 1       | 0–10      | count      | Other big shows in the window that cost nothing                                                                |
| `boxOffice.fatigue.perExtraShow`        | number  | 0.2     | 0–1       | ratio      | Crowd lost for each other big show beyond the free ones (0 = no fatigue)                                       |
| `boxOffice.fatigue.floor`               | number  | 0.25    | 0–1       | multiplier | The least of the crowd fatigue can leave                                                                       |
| `boxOffice.crowd.spread`                | number  | 0.1     | 0–0.5     | ratio      | How far the real crowd can land from the forecast, either way; also the width of the forecast range            |
| `boxOffice.generic.room.capacity`       | integer | 150     | 1–200,000 | count      | People a local room holds ([generic venues](box-office.md#generic-venues))                                     |
| `boxOffice.generic.smallHall.capacity`  | integer | 500     | 1–200,000 | count      | People a local small hall holds                                                                                |
| `boxOffice.generic.hall.capacity`       | integer | 1,200   | 1–200,000 | count      | People a local hall holds                                                                                      |
| `boxOffice.generic.largeHall.capacity`  | integer | 3,000   | 1–200,000 | count      | People a local large hall holds                                                                                |
| `boxOffice.generic.smallArena.capacity` | integer | 6,000   | 1–200,000 | count      | People a local small arena holds                                                                               |
| `boxOffice.generic.arena.capacity`      | integer | 12,000  | 1–200,000 | count      | People a local arena holds                                                                                     |
| `boxOffice.generic.largeArena.capacity` | integer | 20,000  | 1–200,000 | count      | People a local large arena holds                                                                               |
| `boxOffice.generic.stadium.capacity`    | integer | 45,000  | 1–200,000 | count      | People a local stadium holds                                                                                   |
| `boxOffice.fit.sellOutAt`               | number  | 1       | 0.5–1.5   | ratio      | Expected crowd, as a share of capacity, at which a venue is a likely sell-out ([venues](box-office.md#venues)) |
| `boxOffice.fit.emptyAt`                 | number  | 3       | 1–10      | multiplier | Capacity, as a multiple of the expected crowd, at which a venue will look empty                                |
| `boxOffice.pick.headroom`               | number  | 1.1     | 1–3       | multiplier | Room left for a good night when sizing a venue ([pick](box-office.md#pick))                                    |

| Key                               | Kind    | Default       | Range                                                 | Unit   | Meaning                                                                                                                       |
| --------------------------------- | ------- | ------------- | ----------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `office.history.fullDetailWeeks`  | integer | 52            | 4–520                                                 | count  | Weeks kept at full weekly detail before older weeks are thinned to one per month                                              |
| `office.trend.weeks`              | integer | 8             | 2–52                                                  | count  | Weeks shown in a KPI sparkline                                                                                                |
| `office.delta.lookbackDays`       | integer | 7             | 1–90                                                  | days   | How far back a KPI delta compares                                                                                             |
| `office.popularity.headlineScope` | enum    | `homeCountry` | `homeRegion`, `homeCountry`, `homeContinent`, `world` | choice | Which D-03 roll-up the Office and the top bar show as the promotion's popularity ([office.md](office.md#headline-popularity)) |
