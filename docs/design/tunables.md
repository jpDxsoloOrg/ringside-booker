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
| `attribute`            | A worker attribute (0–100) or a change to one       |
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
| `sim.traceBytesPerKind`                | integer | 500000  | 0–1e8    | count | Characters of full traces kept per kind of result before summarising      |
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

## Health tunables

In `systems/health/tunables.ts`, category `Health`: fatigue recovery, the
healing cap for a worker's age, weekly condition recovery and medical care.
Each key is explained in [health.md](health.md).

| Key                                         | Kind    | Default | Range | Unit       | What it does                                                                      |
| ------------------------------------------- | ------- | ------- | ----- | ---------- | --------------------------------------------------------------------------------- |
| `health.fatigue.recoveryPerDay`             | number  | 4       | 0–100 | points/day | Fatigue an average worker sheds each day, before stamina, age and traits          |
| `health.fatigue.recoveryBonusMax`           | integer | 1       | 0–10  | points/day | Largest random extra recovery per day; 0 turns the roll's effect off              |
| `health.fatigue.staminaWeight`              | number  | 0.4     | 0–1   | ratio      | How much stamina speeds up or slows down recovery; 0 ignores stamina              |
| `health.fatigue.ageFrom`                    | integer | 33      | 18–60 | years      | Age from which fatigue fades more slowly                                          |
| `health.fatigue.agePenaltyPerYear`          | number  | 0.02    | 0–0.2 | ratio      | Recovery lost for each year past that age; 0 turns the age effect off             |
| `health.fatigue.ageFactorMin`               | number  | 0.5     | 0–1   | multiplier | The least of the daily recovery age can leave                                     |
| `health.fatigue.workhorseMultiplier`        | number  | 1.2     | 0–3   | multiplier | Recovery for a workhorse, as a multiple of everyone else                          |
| `health.fatigue.coasterMultiplier`          | number  | 0.9     | 0–3   | multiplier | Recovery for a coaster, as a multiple of everyone else                            |
| `health.fatigue.workedPromoRecovery`        | number  | 0.5     | 0–1   | multiplier | Recovery after a show spent talking (a promo or angle, no match); 1 rests fully   |
| `health.condition.capAgeFrom`               | integer | 30      | 18–60 | years      | Age from which a body can no longer heal all the way back to 100                  |
| `health.condition.capDropPerYear`           | number  | 1.5     | 0–10  | points     | How far the healing cap falls for each year past that age; 0 keeps it at 100      |
| `health.condition.capFloor`                 | number  | 55      | 0–100 | points     | The lowest the healing cap goes, however old the worker                           |
| `health.condition.recoveryPerCheck`         | number  | 0.5     | 0–10  | points     | Condition a damaged body part gets back each week, before traits and medical care |
| `health.condition.durableMultiplier`        | number  | 1.25    | 0–3   | multiplier | Healing for a durable worker, as a multiple of everyone else                      |
| `health.condition.injuryProneMultiplier`    | number  | 0.75    | 0–3   | multiplier | Healing for an injury-prone worker, as a multiple of everyone else                |
| `health.medical.recoveryMultiplier.level0`  | number  | 0.8     | 0–3   | multiplier | Healing under medical care level 0 (none)                                         |
| `health.medical.recoveryMultiplier.level1`  | number  | 1       | 0–3   | multiplier | Healing under medical care level 1                                                |
| `health.medical.recoveryMultiplier.level2`  | number  | 1.15    | 0–3   | multiplier | Healing under medical care level 2                                                |
| `health.medical.recoveryMultiplier.level3`  | number  | 1.3     | 0–3   | multiplier | Healing under medical care level 3 (the best)                                     |
| `health.medical.freeAgentLevel`             | integer | 1       | 0–3   | count      | The medical care level (0 to 3) a worker with no employer gets                    |
| `health.medical.injuryMultiplier.level0`    | number  | 1.2     | 0–3   | multiplier | Injury time out under medical care level 0 (none)                                 |
| `health.medical.injuryMultiplier.level1`    | number  | 1       | 0–3   | multiplier | Injury time out under medical care level 1                                        |
| `health.medical.injuryMultiplier.level2`    | number  | 0.9     | 0–3   | multiplier | Injury time out under medical care level 2                                        |
| `health.medical.injuryMultiplier.level3`    | number  | 0.8     | 0–3   | multiplier | Injury time out under medical care level 3 (the best)                             |
| `health.injury.severityMultiplier.minor`    | number  | 0.6     | 0–3   | multiplier | Time out for a minor injury, as a multiple of the rolled days                     |
| `health.injury.severityMultiplier.moderate` | number  | 1       | 0–3   | multiplier | Time out for a moderate injury, as a multiple of the rolled days                  |
| `health.injury.severityMultiplier.severe`   | number  | 1.8     | 0–3   | multiplier | Time out for a severe injury, as a multiple of the rolled days                    |
| `health.injury.durableMultiplier`           | number  | 0.75    | 0–3   | multiplier | Time out for a durable worker, as a multiple of everyone else                     |
| `health.injury.injuryProneMultiplier`       | number  | 1.35    | 0–3   | multiplier | Time out for an injury-prone worker, as a multiple of everyone else               |
| `health.injury.maxDays`                     | integer | 540     | 1–730 | days       | The longest any injury keeps someone out                                          |
| `health.injury.conditionLossPerWeek`        | number  | 1       | 0–10  | points     | Condition the hurt body part loses for each week out; 0 turns the loss off        |

The foundation's `condition.fatigueRecoveryPerDay` and
`condition.fatigueRecoveryBonusMax` are gone (WRK6-02). A save that still
overrides them loads with those overrides dropped and listed in
`engine.loadIssues` as unknown keys.

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

| Key                                       | Kind   | Default | Range  | Unit       | What it does                                                         |
| ----------------------------------------- | ------ | ------- | ------ | ---------- | -------------------------------------------------------------------- |
| `match.autoWinner.popularityWeight`       | number | 0.45    | 0–3    | multiplier | Points per point of a side's mean popularity in the show's region    |
| `match.autoWinner.momentumWeight`         | number | 0.15    | 0–1    | multiplier | Points per point of a side's mean momentum                           |
| `match.autoWinner.push.mainEvent`         | number | 24      | 0–100  | points     | Points for a main eventer                                            |
| `match.autoWinner.push.upperCard`         | number | 22      | 0–100  | points     | Points for an upper-card worker                                      |
| `match.autoWinner.push.midCard`           | number | 14      | 0–100  | points     | Points for a mid-card worker                                         |
| `match.autoWinner.push.lowerCard`         | number | 7       | 0–100  | points     | Points for a lower-card worker                                       |
| `match.autoWinner.push.enhancement`       | number | 0       | 0–100  | points     | Points for enhancement talent                                        |
| `match.autoWinner.push.none`              | number | 0       | 0–100  | points     | Points for someone with no push (or not employed here)               |
| `match.autoWinner.alignment.face`         | number | 2       | −20–20 | points     | Points for a face                                                    |
| `match.autoWinner.alignment.heel`         | number | 0       | −20–20 | points     | Points for a heel                                                    |
| `match.autoWinner.alignment.tweener`      | number | 1       | −20–20 | points     | Points for a tweener                                                 |
| `match.autoWinner.skillWeight`            | number | 0.5     | 0–3    | multiplier | Points per point of a side's mean ring skill (MTCH2-09)              |
| `match.autoWinner.staminaWeight`          | number | 0.5     | 0–3    | multiplier | Points per point of a side's mean stamina, before the length factor  |
| `match.autoWinner.staminaFactor.short`    | number | 0.5     | 0–5    | multiplier | How much stamina counts in a Short match                             |
| `match.autoWinner.staminaFactor.standard` | number | 1       | 0–5    | multiplier | How much stamina counts in a Standard match                          |
| `match.autoWinner.staminaFactor.long`     | number | 1.5     | 0–5    | multiplier | How much stamina counts in a Long match                              |
| `match.autoWinner.fatigueWeight`          | number | 0.2     | 0–3    | multiplier | Points lost per point of a side's mean fatigue                       |
| `match.autoWinner.conditionWeight`        | number | 0.2     | 0–3    | multiplier | Points lost per point of mean body wear (100 minus condition)        |
| `match.autoWinner.heatWeight`             | number | 0.1     | 0–3    | multiplier | Points per point of heat of a storyline the side is the face in      |
| `match.autoWinner.upsetNoteGap`           | number | 25      | 0–200  | points     | How far behind a winner must have been to be called an upset         |
| `match.autoWinner.randomness`             | number | 57.5    | 0–200  | points     | Most unpredictability per side; 0 = always the same winner           |
| `match.randomWinners.randomness`          | number | 60      | 1–1000 | points     | Unused since MTCH2-08 (Random winners is a coin flip); never below 1 |

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

### Physical toll tunables

How much fatigue one worker gains in one match and how much body condition they
lose (MTCH4-01), and the in-match injury chance (MTCH4-02), in
`systems/match/physical/tunables.ts`, category `Physical toll`. Every key has a minimum of 0. The full table, with every
style and body part default, is in
[physical-toll.md](physical-toll.md#tunables).

| Family                                          | Kind    | Unit              | What it does                                                                          |
| ----------------------------------------------- | ------- | ----------------- | ------------------------------------------------------------------------------------- |
| `match.fatigue.base.<class>`                    | number  | points            | Fatigue a short (4), standard (7) or long (12) match costs one worker                 |
| `match.fatigue.minShare`                        | number  | ratio             | Smallest share of the workload in a crowded match (0.35)                              |
| `match.fatigue.staminaRelief`                   | number  | ratio             | Fatigue eased per point of stamina above 50 (0.006)                                   |
| `match.fatigue.style.<style>`                   | number  | multiplier        | How tiring each ring style finds a match                                              |
| `match.fatigue.*Factor`                         | number  | multiplier        | Workhorse 1.15, coaster 0.85, house show 0.6, keep it safe 0.8                        |
| `match.fatigue.repeatMatch`                     | number  | multiplier        | Fatigue and wear for each match after the first on the same card, compounding (1.5)   |
| `match.fatigue.maxPerSegment`                   | number  | points            | Most fatigue one match can add (40)                                                   |
| `match.wear.base.<class>`                       | number  | points            | Wear a short (0.2), standard (0.35) or long (0.6) match costs one worker              |
| `match.wear.selfStyle.<style>`                  | number  | multiplier        | How hard each ring style is on its own worker's body                                  |
| `match.wear.opponentStyle.<style>`              | number  | multiplier        | How rough each ring style is on an opponent                                           |
| `match.wear.safetyWeight` and min/max           | number  | ratio, multiplier | The opponents' safety factor (0.008 per point, kept within 0.6–1.4)                   |
| `match.wear.*Factor`                            | number  | multiplier        | Durable 0.7, injury prone 1.3, house show 0.6, keep it safe 0.5                       |
| `match.wear.spread`                             | number  | ratio             | How far the roughness roll moves wear either way (0.5; 0 means no randomness)         |
| `match.wear.maxPerSegment`                      | number  | points            | Most wear one match can cost (5)                                                      |
| `match.wear.part.<part>`                        | number  | multiplier        | Share of the wear each body part takes                                                |
| `match.injury.enabled`                          | boolean | flag              | Workers can get hurt in a match (on)                                                  |
| `match.injury.baseChance`                       | number  | probability       | Injury chance for a fresh worker in a standard match (0.003)                          |
| `match.injury.per*Point*`                       | number  | probability       | Added per point of end-of-match fatigue and of the worst body part below 100 (0.0001) |
| `match.injury.duration.<class>`                 | number  | multiplier        | Short 0.7, standard 1, long 1.3                                                       |
| `match.injury.opponentSafetyWeight` and min/max | number  | ratio, multiplier | The least safe opponent's factor (0.012 per point, kept within 0.5–1.6)               |
| `match.injury.selfStyle.<style>`                | number  | multiplier        | How much a worker's own style raises their injury chance                              |
| `match.injury.opponentStyle.<style>`            | number  | multiplier        | How much an opponent's style raises the injury chance                                 |
| `match.injury.*Factor`                          | number  | multiplier        | Injury prone 1.8, durable 0.5, keep it safe 0.5                                       |
| `match.injury.repeatMatch`                      | number  | multiplier        | Injury chance for each match after the first on the same card, compounding (1.4)      |
| `match.injury.maxChance`                        | number  | probability       | Highest injury chance one worker can have in one match (0.2)                          |
| `match.injury.maxPerSegment`                    | integer | count             | Most workers injured in one segment (1; 0 means nobody)                               |

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

## Production tunables

EVT4-02's production ceiling and bonus slot, in `systems/cardFlow/tunables.ts`,
category `Production`. See [card-flow.md](card-flow.md). ECO7 owns the
production levels and their costs, not these formulas.

| Key                                 | Kind   | Default | Range | Unit   | What it does                                                               |
| ----------------------------------- | ------ | ------- | ----- | ------ | -------------------------------------------------------------------------- |
| `production.ceilingBase`            | number | 40      | 0–100 | points | Ceiling with every area at level 0                                         |
| `production.ceilingWeight.stage`    | number | 1.5     | 0–10  | points | Ceiling points each stage level adds                                       |
| `production.ceilingWeight.camera`   | number | 2       | 0–10  | points | Ceiling points each camera level adds                                      |
| `production.ceilingWeight.editing`  | number | 1.5     | 0–10  | points | Ceiling points each editing level adds                                     |
| `production.ceilingWeight.pyro`     | number | 1       | 0–10  | points | Ceiling points each pyro level adds                                        |
| `production.bonusSlotThreshold`     | number | 90      | 0–100 | points | Ceiling a promotion needs for its shows to get one extra main slot         |
| `production.bonusSlotMinImportance` | enum   | regular |       | choice | The smallest show (house, minor, regular, major, flagship) that can get it |

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

| Key                                   | Kind   | Default | Range | Unit       | What it does                                                                            |
| ------------------------------------- | ------ | ------- | ----- | ---------- | --------------------------------------------------------------------------------------- |
| `promoPop.neighbourReach`             | number | 0.5     | 0–1   | ratio      | How much of a show a neighbouring region sees (0 = neighbours not reached)              |
| `promoPop.tvReach.tier0`              | number | 0.1     | 0–1   | ratio      | How much of a show a region sees on a reach tier 0 network (0 = not reached that way)   |
| `promoPop.tvReach.tier1`              | number | 0.2     | 0–1   | ratio      | Same, reach tier 1                                                                      |
| `promoPop.tvReach.tier2`              | number | 0.3     | 0–1   | ratio      | Same, reach tier 2                                                                      |
| `promoPop.tvReach.tier3`              | number | 0.45    | 0–1   | ratio      | Same, reach tier 3                                                                      |
| `promoPop.tvReach.tier4`              | number | 0.6     | 0–1   | ratio      | Same, reach tier 4                                                                      |
| `promoPop.expect.popularityWeight`    | number | 0.6     | 0–2   | ratio      | Expected score per point of popularity in the region                                    |
| `promoPop.expect.prestigeWeight`      | number | 0.2     | 0–1   | ratio      | Expected score per point of prestige                                                    |
| `promoPop.expect.importance.house`    | number | 0.8     | 0–3   | multiplier | Event size factor on the popularity part of the expectation, house show                 |
| `promoPop.expect.importance.minor`    | number | 0.9     | 0–3   | multiplier | Same, minor show                                                                        |
| `promoPop.expect.importance.regular`  | number | 1       | 0–3   | multiplier | Same, regular show                                                                      |
| `promoPop.expect.importance.major`    | number | 1.15    | 0–3   | multiplier | Same, major show                                                                        |
| `promoPop.expect.importance.flagship` | number | 1.3     | 0–3   | multiplier | Same, flagship show                                                                     |
| `promoPop.deadZone`                   | number | 3       | 0–20  | points     | Score margin either way that changes nothing (0 = any margin counts)                    |
| `promoPop.blowoutMargin`              | number | 25      | 0–100 | points     | Score margin that earns the full gain or loss                                           |
| `promoPop.maxGainPerShow`             | number | 3       | 0–10  | points     | Most popularity one show can win in a region before shaping (0 = no gains)              |
| `promoPop.maxLossPerShow`             | number | 2.5     | 0–10  | points     | Most popularity one show can lose in a region before shaping (0 = no losses)            |
| `promoPop.impact.house`               | number | 0.4     | 0–3   | multiplier | How much a house show moves popularity (0 = nothing)                                    |
| `promoPop.impact.minor`               | number | 0.7     | 0–3   | multiplier | Same, minor show                                                                        |
| `promoPop.impact.regular`             | number | 1       | 0–3   | multiplier | Same, regular show                                                                      |
| `promoPop.impact.major`               | number | 1.3     | 0–3   | multiplier | Same, major show                                                                        |
| `promoPop.impact.flagship`            | number | 1.6     | 0–3   | multiplier | Same, flagship show                                                                     |
| `promoPop.diminishingPower`           | number | 1.5     | 0–5   | ratio      | How sharply gains shrink as popularity rises (0 = no diminishing)                       |
| `promoPop.lossFullFrom`               | number | 25      | 0–100 | points     | Popularity from which a bad show costs its full loss (0 = losses never scaled down)     |
| `promoPop.monthlyGainCap`             | number | 3       | 0–100 | points     | Most popularity shows can win in one region in one calendar month (0 = no gains at all) |

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
headline scope points at `office.md#headline-popularity`, DAY2-03's morale key
at `office.md#kpis-and-deltas`).

| Key                              | Kind    | Default | Range | Unit  | Meaning                                                                          |
| -------------------------------- | ------- | ------- | ----- | ----- | -------------------------------------------------------------------------------- |
| `office.history.fullDetailWeeks` | integer | 52      | 4–520 | count | Weeks kept at full weekly detail before older weeks are thinned to one per month |
| `office.trend.weeks`             | integer | 8       | 2–52  | count | Weeks shown in a KPI sparkline                                                   |
| `office.delta.lookbackDays`      | integer | 7       | 1–90  | days  | How far back a KPI delta compares                                                |

## Rival desk tunables

The rival desk's numbers (AIP), in `systems/aip/tunables.ts`, category
`Rival desk`, each with a docRef into [rival-desk.md](rival-desk.md). The style
taste defaults (AIP1-04) are category `Rival taste`.

One default per promotion style and taste axis, generated in
`systems/aip/tasteTunables.ts`: `aip.styleTaste.<style>.<axis>`, 56 keys in
all. Every one is a `number`, range 0–100, step 5, unit `points`, category
`Rival taste`, docRef `rival-desk.md#taste`, and is the axis of a promotion of
that style until its booker sets a taste (AIP2). The defaults are the table in
[rival-desk.md](rival-desk.md#taste). The key segments are the style
(`mainstream`, `traditional`, `technical`, `hardHitting`, `hardcore`,
`highFlying`, `entertainment`) and the axis (`wrestlingFocus`,
`entertainmentFocus`, `athleticFocus`, `starFocus`, `talkShare`,
`titleFocus`, `youthFocus`, `riskAppetite`).

| Key                                    | Kind    | Default | Range | Unit       | Meaning                                                                                                       |
| -------------------------------------- | ------- | ------- | ----- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `aip.cardValue.marketMinPop`           | number  | 10      | 0–100 | points     | Popularity a promotion needs in a region for it to count as a market ([card value](rival-desk.md#card-value)) |
| `aip.cardValue.popularityWeight`       | number  | 1       | 0–5   | ratio      | How much popularity in the promotion's markets counts toward card value                                       |
| `aip.cardValue.abilityWeight`          | number  | 1       | 0–5   | ratio      | How much the taste-weighted ability blend counts toward card value                                            |
| `aip.cardValue.momentumFactor`         | number  | 0.1     | 0–1   | ratio      | Card value added per point of momentum; 0 leaves momentum out                                                 |
| `aip.cardValue.declineAge`             | number  | 36      | 18–60 | years      | Age after which card value starts to fall                                                                     |
| `aip.cardValue.declinePerYear`         | number  | 0.04    | 0–0.2 | ratio      | Share of card value lost per year past the decline age; 0 turns the decline off                               |
| `aip.cardValue.ageFloor`               | number  | 0.5     | 0–1   | multiplier | The least of their card value age can leave a veteran                                                         |
| `aip.cardValue.youthAge`               | number  | 26      | 16–40 | years      | Workers younger than this get the youth bonus                                                                 |
| `aip.cardValue.youthBonus`             | number  | 6       | 0–20  | points     | Card value a young worker gains at youth focus 100; 0 turns it off                                            |
| `aip.needs.workersPerSlot`             | number  | 2       | 0–6   | ratio      | Wrestlers wanted per slot of the largest show ([needs](rival-desk.md#needs))                                  |
| `aip.needs.defaultSlots`               | integer | 6       | 0–12  | count      | Slots counted for a unit with no active shows                                                                 |
| `aip.needs.bandShare.mainEvent`        | number  | 0.12    | 0–1   | ratio      | Share of the wanted roster in the main event                                                                  |
| `aip.needs.bandShare.upperCard`        | number  | 0.2     | 0–1   | ratio      | Same, upper card                                                                                              |
| `aip.needs.bandShare.midCard`          | number  | 0.33    | 0–1   | ratio      | Same, mid card                                                                                                |
| `aip.needs.bandShare.lowerCard`        | number  | 0.2     | 0–1   | ratio      | Same, lower card                                                                                              |
| `aip.needs.bandShare.enhancement`      | number  | 0.15    | 0–1   | ratio      | Same, enhancement                                                                                             |
| `aip.needs.maxAlignmentGap`            | integer | 3       | 0–20  | count      | Most faces over heels (or heels over faces) before it is a need                                               |
| `aip.needs.alignmentSeverityPerWorker` | number  | 15      | 0–100 | points     | How pressing each worker past the allowed gap is                                                              |
| `aip.needs.minPerGenderDivision`       | integer | 4       | 0–20  | count      | Fewest available wrestlers a division with a title wants; 0 never makes a need                                |
| `aip.needs.contractEndingDays`         | integer | 60      | 0–365 | days       | How soon a champion's contract must end to be a need                                                          |
| `aip.needs.championUnfitSeverity`      | number  | 80      | 0–100 | points     | How pressing a champion who cannot defend is                                                                  |
| `aip.needs.championEndingSeverity`     | number  | 60      | 0–100 | points     | How pressing a champion whose contract is ending is                                                           |
| `aip.needs.minReferees`                | integer | 2       | 0–10  | count      | Fewest referees wanted; 0 never makes a need                                                                  |
| `aip.needs.minAnnouncers`              | integer | 1       | 0–10  | count      | Fewest announcers wanted; 0 never makes a need                                                                |
| `aip.needs.minProducers`               | integer | 0       | 0–10  | count      | Fewest producers wanted; 0 never makes a need                                                                 |
| `aip.needs.minSeverity`                | number  | 10      | 0–100 | points     | Needs less pressing than this are dropped                                                                     |

The Rival rules shortcuts (D-01, AIP1-02), in `systems/aip/shortcuts.ts`,
category `Rival rules`, docRef [rival-desk.md#shortcuts](rival-desk.md#shortcuts).
Systems read them only through `aiShortcut`, which reads each as off (false or 0) for a promotion a player runs and for every promotion under the level
playing field.

| Key                      | Kind    | Default | Range           | Unit   | Meaning                                                                                        |
| ------------------------ | ------- | ------- | --------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `ai.skipInMatchInjuries` | boolean | true    |                 | flag   | Rivals' matches cause no in-match injuries; their injuries come from daily world events        |
| `ai.skipResultMorale`    | boolean | true    |                 | flag   | Rival workers' morale does not move with match results; small off-screen morale events instead |
| `ai.scoreBonus`          | number  | 3       | 0–20 (step 0.5) | points | Points added to every rival segment score                                                      |
| `ai.simpleBookingInputs` | boolean | true    |                 | flag   | Rival bookings skip production notes and match plans                                           |
| `ai.skipMediaRequests`   | boolean | true    |                 | flag   | Rivals receive no media requests                                                               |
| `ai.skipWorkerRequests`  | boolean | true    |                 | flag   | Rival workers make no requests of their bosses                                                 |

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
| `boxOffice.rivalVenueLeadDays`          | integer | 14      | 0–90      | days       | How far ahead rival shows are given a venue ([automatic picks](box-office.md#automatic-picks))                 |

| Key                               | Kind    | Default       | Range                                                 | Unit   | Meaning                                                                                                                       |
| --------------------------------- | ------- | ------------- | ----------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `office.history.fullDetailWeeks`  | integer | 52            | 4–520                                                 | count  | Weeks kept at full weekly detail before older weeks are thinned to one per month                                              |
| `office.trend.weeks`              | integer | 8             | 2–52                                                  | count  | Weeks shown in a KPI sparkline                                                                                                |
| `office.delta.lookbackDays`       | integer | 7             | 1–90                                                  | days   | How far back a KPI delta compares                                                                                             |
| `office.popularity.headlineScope` | enum    | `homeCountry` | `homeRegion`, `homeCountry`, `homeContinent`, `world` | choice | Which D-03 roll-up the Office and the top bar show as the promotion's popularity ([office.md](office.md#headline-popularity)) |
| `office.morale.namedInWhy`        | integer | 3             | 0–10                                                  | count  | Lowest-morale people named in the average morale's Why? ([office.md](office.md#kpis-and-deltas))                              |

## Roster tunables

The roster's one number (WRK2), in `systems/roster/tunables.ts`, category
`Roster`, docRef [roster.md](roster.md#push-verdict).

| Key                       | Kind    | Default | Range | Unit  | Meaning                                                                                                                                    |
| ------------------------- | ------- | ------- | ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `roster.expectsMoreSteps` | integer | 1       | 1–4   | count | Card positions below the push they expect before the roster marks a worker as expecting more (and above it, as pushed beyond expectations) |

## Rival booking tunables

The card planner's numbers (AIP4), in `systems/aip/card/tunables.ts`,
category `Rival booking`, each with a docRef into
[rival-booking.md](rival-booking.md). They count slots, people and title
matches only; none sets a length (D-10).

| Key                                   | Kind    | Default | Range  | Unit        | Meaning                                                                                                                                                                |
| ------------------------------------- | ------- | ------- | ------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aip.card.maxFatigue`                 | number  | 75      | 0–100  | points      | Fatigue above which a rival only books a worker as a last resort ([card pool](rival-booking.md#card-pool))                                                             |
| `aip.card.minWorkers`                 | integer | 5       | 0–30   | count       | A rival cancels a show with fewer wrestlers fit to work than this (0 never)                                                                                            |
| `aip.card.mixedGender`                | boolean | false   |        | flag        | Whether a rival may book men and women against each other outside title matches                                                                                        |
| `aip.card.talkShare.house`            | number  | 0       | 0–1    | ratio       | Share of main-card slots given to talking segments on a house show ([card shape](rival-booking.md#card-shape))                                                         |
| `aip.card.talkShare.minor`            | number  | 0.15    | 0–1    | ratio       | Same, minor show                                                                                                                                                       |
| `aip.card.talkShare.regular`          | number  | 0.3     | 0–1    | ratio       | Same, regular weekly show                                                                                                                                              |
| `aip.card.talkShare.major`            | number  | 0.2     | 0–1    | ratio       | Same, major show                                                                                                                                                       |
| `aip.card.talkShare.flagship`         | number  | 0.15    | 0–1    | ratio       | Same, flagship show                                                                                                                                                    |
| `aip.card.talkTasteSwing`             | number  | 0.5     | 0–1    | ratio       | How far the booker's taste for talking moves the share                                                                                                                 |
| `aip.card.maxTalkShare`               | number  | 0.5     | 0–1    | ratio       | The largest share of main-card slots a rival gives to talking segments                                                                                                 |
| `aip.card.fillPreShow`                | boolean | true    |        | flag        | Whether a rival fills its shows' pre-show slots                                                                                                                        |
| `aip.titles.maxPerShow.house`         | integer | 1       | 0–12   | count       | Most title matches a rival books on a house show ([title matches](rival-booking.md#title-matches))                                                                     |
| `aip.titles.maxPerShow.minor`         | integer | 1       | 0–12   | count       | Same, minor show                                                                                                                                                       |
| `aip.titles.maxPerShow.regular`       | integer | 2       | 0–12   | count       | Same, regular weekly show                                                                                                                                              |
| `aip.titles.maxPerShow.major`         | integer | 4       | 0–12   | count       | Same, major show                                                                                                                                                       |
| `aip.titles.maxPerShow.flagship`      | integer | 6       | 0–12   | count       | Same, flagship show                                                                                                                                                    |
| `aip.titles.defenceIntervalDays`      | number  | 28      | 1–365  | days        | Usual gap between defences of a title at middling title taste ([title picture](rival-booking.md#title-picture))                                                        |
| `aip.titles.tempoSwing`               | number  | 0.5     | 0–1    | ratio       | How far the booker's title taste moves the usual gap                                                                                                                   |
| `aip.titles.prestigeWeight`           | number  | 0.5     | 0–5    | points      | Urgency a title gains per 100 prestige                                                                                                                                 |
| `aip.titles.importanceBonus.house`    | number  | 0       | 0–5    | points      | Urgency a house show adds to every title                                                                                                                               |
| `aip.titles.importanceBonus.minor`    | number  | 0       | 0–5    | points      | Same, minor show                                                                                                                                                       |
| `aip.titles.importanceBonus.regular`  | number  | 0       | 0–5    | points      | Same, regular weekly show                                                                                                                                              |
| `aip.titles.importanceBonus.major`    | number  | 1       | 0–5    | points      | Same, major show                                                                                                                                                       |
| `aip.titles.importanceBonus.flagship` | number  | 2       | 0–5    | points      | Same, flagship show                                                                                                                                                    |
| `aip.titles.dueThreshold`             | number  | 1       | 0–10   | points      | Urgency at which a title is due a defence tonight                                                                                                                      |
| `aip.titles.recentChallengers`        | integer | 2       | 0–10   | count       | Latest challengers who rest before challenging again (0 never) ([challengers](rival-booking.md#challengers))                                                           |
| `aip.titles.challengerPool`           | integer | 3       | 1–10   | count       | Best eligible contenders the challenger is picked from                                                                                                                 |
| `aip.titles.excludeOtherChampions`    | boolean | true    |        | flag        | Whether a champion is kept out of challenging for another title                                                                                                        |
| `aip.card.maxStorylineSegments`       | integer | 2       | 0–6    | count       | Most storyline segments a rival puts on one show ([storylines](rival-booking.md#storylines))                                                                           |
| `aip.card.storylineMinHeat`           | number  | 0       | 0–100  | points      | Heat a storyline needs before a rival gives it a segment (0: every active one)                                                                                         |
| `aip.card.storylineMatchChance`       | number  | 0.5     | 0–1    | probability | Chance a storyline with a fit face and heel gets a match rather than a talking segment                                                                                 |
| `aip.card.typeWeight.oneOnOne`        | number  | 100     | 0–1000 | points      | How often a rival picks a one-on-one match type ([match types](rival-booking.md#match-types))                                                                          |
| `aip.card.typeWeight.tag`             | number  | 35      | 0–1000 | points      | Same, two-on-two tag types                                                                                                                                             |
| `aip.card.typeWeight.multiWay`        | number  | 10      | 0–1000 | points      | Same, three or more singles sides                                                                                                                                      |
| `aip.card.typeWeight.trios`           | number  | 6       | 0–1000 | points      | Same, three-on-three types                                                                                                                                             |
| `aip.card.typeWeight.other`           | number  | 2       | 0–1000 | points      | Same, any other shape (handicap, battle royal)                                                                                                                         |
| `aip.card.variantShare`               | number  | 0.2     | 0–1    | ratio       | Share of a match family's weight its variants split (Endurance and Sprint for one-on-one); the plain type keeps the rest ([match types](rival-booking.md#match-types)) |
| `aip.card.poolComfort`                | number  | 2       | 1–5    | multiplier  | Times the wrestlers a match needs must be free before its type gets full weight                                                                                        |
| `aip.card.noTeamFactor`               | number  | 0.25    | 0–1    | multiplier  | Weight left to a tag or trios type when fewer than two teams are free                                                                                                  |
| `aip.card.pickWindow`                 | integer | 5       | 1–20   | count       | Best free workers each place on the card is chosen from ([fallback chain](rival-booking.md#fallback-chain))                                                            |
| `aip.card.secondSpeakerChance`        | number  | 0.5     | 0–1    | probability | Chance a talking segment gets a second speaker ([talking segments](rival-booking.md#talking-segments))                                                                 |
| `aip.card.order.titleWeight`          | number  | 0.3     | 0–2    | points      | Card score a title on the line adds per prestige point ([card score](rival-booking.md#card-score))                                                                     |
| `aip.card.order.heatWeight`           | number  | 0.2     | 0–2    | points      | Card score a storyline adds per heat point (the hottest one counts)                                                                                                    |
| `aip.card.order.aceBoost`             | number  | 12      | 0–50   | points      | Card score added to a segment with the promotion's ace in it                                                                                                           |
| `aip.card.order.prospectBoost`        | number  | 6       | 0–50   | points      | Card score added to a segment with one of the promotion's prospects in it                                                                                              |
| `aip.card.order.talkFactor`           | number  | 0.8     | 0–2    | multiplier  | How much of its speakers' card value a talking segment scores                                                                                                          |
| `aip.card.order.hotOpener`            | boolean | true    |        | flag        | Whether the second-best match opens the show ([ordering](rival-booking.md#ordering))                                                                                   |

## Rival results tunables

The rival results' numbers (AIP5), in `systems/aip/results/tunables.ts`,
category `Rival booking`, with a docRef to
[winners](rival-booking.md#winners) or
[title changes](rival-booking.md#title-changes). A squash is a push gap, never
a short match; nothing here sets a length (D-10).

| Key                                          | Kind    | Default                   | Range       | Unit        | Meaning                                                                                                                                                     |
| -------------------------------------------- | ------- | ------------------------- | ----------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aip.winner.jitter`                          | number  | 0.1                       | 0–0.5       | ratio       | Largest random swing on each side's value, either way (0 = none)                                                                                            |
| `aip.winner.drawChance`                      | number  | 0                         | 0–1         | probability | Chance a two-sided non-squash match is booked as a draw (0 = never)                                                                                         |
| `aip.winner.squash.pushGap`                  | integer | 3                         | 1–5         | count       | Push bands between the sides before a match counts as a squash                                                                                              |
| `aip.winner.squash.chance`                   | number  | 0.92                      | 0–1         | probability | Chance the higher-pushed side wins a squash                                                                                                                 |
| `aip.winner.protect.ace`                     | number  | 0.6                       | 0–1         | probability | Chance the booker protects its ace: the ace's side wins outright                                                                                            |
| `aip.winner.protect.prospect`                | number  | 0.75                      | 0–1         | probability | Chance the booker protects a prospect                                                                                                                       |
| `aip.winner.finale.faceChance`               | number  | 0.7                       | 0–1         | probability | Chance the faces win a storyline's finale                                                                                                                   |
| `aip.winner.finale.minAgeDays`               | integer | 56                        | 7–365       | days        | Without a finale flag, a storyline this old counts as reaching its finale                                                                                   |
| `aip.winner.method.nonTitleWeight`           | number  | 0.15                      | 0–5         | multiplier  | Weight of methods that can't change titles (count-out, disqualification) when picking a method, in a save without finishes                                  |
| `aip.results.fullTraces`                     | integer | 600                       | 0–20000     | count       | Full explanations kept for rival winners, and apart for rival title decisions, before the oldest are summarised (the detail window usually ends them first) |
| `aip.results.fullTraceChars`                 | integer | 1500000                   | 0–100000000 | count       | Characters of full explanation kept for rival winners, and apart for rival title decisions, before the oldest are summarised                                |
| `aip.titles.band1.maxDays` … `band6.maxDays` | integer | 14, 45, 90, 150, 240, 365 | 1–3650      | days        | Longest reign in each band; the days must increase                                                                                                          |
| `aip.titles.band1.chance` … `band6.chance`   | number  | 0, 2, 6, 12, 18, 26       | 0–100       | percent     | Base chance a title changes hands while the reign is in that band                                                                                           |
| `aip.titles.bandBeyond.chance`               | number  | 34                        | 0–100       | percent     | Base chance once the reign is longer than the last band                                                                                                     |
| `aip.titles.prestigePivot`                   | number  | 60                        | 0–100       | points      | Prestige at which a title neither gains nor loses change chance                                                                                             |
| `aip.titles.changePrestigeWeight`            | number  | 0.25                      | 0–2         | multiplier  | Titles below the pivot change more often, above it less                                                                                                     |
| `aip.titles.tempoWeight`                     | number  | 0.3                       | 0–2         | multiplier  | How much the booker's title taste moves the chance                                                                                                          |
| `aip.titles.houseShowsRetain`                | boolean | true                      |             | flag        | Titles never change on house shows                                                                                                                          |
| `aip.titles.importance.house`                | number  | −20                       | −100–100    | percent     | What a house show adds to the change chance                                                                                                                 |
| `aip.titles.importance.minor`                | number  | −12                       | −100–100    | percent     | Same, minor show                                                                                                                                            |
| `aip.titles.importance.regular`              | number  | −8                        | −100–100    | percent     | Same, regular weekly show                                                                                                                                   |
| `aip.titles.importance.major`                | number  | 6                         | −100–100    | percent     | Same, major show                                                                                                                                            |
| `aip.titles.importance.flagship`             | number  | 15                        | −100–100    | percent     | Same, flagship show                                                                                                                                         |
| `aip.titles.hotShot.weeks`                   | integer | 3                         | 2–12        | count       | Weekly popularity readings that must each fall                                                                                                              |
| `aip.titles.hotShot.bonus`                   | number  | 10                        | 0–100       | percent     | Change chance added while the promotion's popularity keeps falling                                                                                          |
| `aip.titles.overdueDays`                     | integer | 400                       | 30–3650     | days        | A reign this long is overdue to end                                                                                                                         |
| `aip.titles.expiringDays`                    | integer | 28                        | 0–365       | days        | A champion whose contract ends within this many days drops the title                                                                                        |
| `aip.titles.challengerMinContractDays`       | integer | 60                        | 0–365       | days        | A challenger needs at least this many contract days left to win a title                                                                                     |
| `aip.titles.maxChance`                       | number  | 90                        | 0–100       | percent     | The highest change chance any title match can reach                                                                                                         |
| `aip.titles.valid.gap`                       | number  | 30                        | 0–100       | points      | How far below the title's prestige a valid challenger's market popularity may be                                                                            |
| `aip.titles.valid.floor`                     | number  | 40                        | 0–100       | points      | Least market popularity a valid challenger needs, however low the prestige                                                                                  |
| `aip.titles.strong.gap`                      | number  | 12                        | 0–100       | points      | How far below the title's prestige a strong challenger's market popularity may be                                                                           |
| `aip.titles.strong.floor`                    | number  | 62                        | 0–100       | points      | Least market popularity a strong challenger needs, however low the prestige                                                                                 |

## History tunables

POL4-08, see [save-format.md](save-format.md#history-retention). One knob for
every history prune: the weekly roll-up, the rival decision log and the rival
card Why? demotion.

| Key                      | Kind    | Default | Range  | Unit | Meaning                                                                                                            |
| ------------------------ | ------- | ------- | ------ | ---- | ------------------------------------------------------------------------------------------------------------------ |
| `history.keepDetailDays` | integer | 28      | 0–3650 | days | How many days of shows, cards, money rows and rival decisions are kept in full; older ones as totals and summaries |

| `aip.titles.valid.gap` | number | 50 | 0–100 | points | How far below the title's prestige a valid challenger's market popularity may be |
| `aip.titles.valid.floor` | number | 12 | 0–100 | points | Least market popularity a valid challenger needs, however low the prestige |
| `aip.titles.strong.gap` | number | 35 | 0–100 | points | How far below the title's prestige a strong challenger's market popularity may be |
| `aip.titles.strong.floor` | number | 25 | 0–100 | points | Least market popularity a strong challenger needs, however low the prestige |

## Production tunables

ECO7-01, in `systems/production/tunables.ts`, category `Production`. See
[production.md](production.md). Every one is 0-means-0, and money is in whole
cents. EVT4's show-quality ceiling keys share the `production.` prefix
(`production.ceilingBase`, `production.ceilingWeight.*`,
`production.bonusSlotThreshold`, `production.bonusSlotMinImportance`) and are
listed with EVT4's work.

| Key                                               | Kind    | Default     | Range            | Unit        | Meaning                                                                                                  |
| ------------------------------------------------- | ------- | ----------- | ---------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `production.costCurve`                            | number  | 3           | 1–5              | ratio       | How steeply production costs rise with level; 1 is a straight line                                       |
| `production.showCost.stage`                       | integer | 12,000,000  | 0–10,000,000,000 | money       | What stage at level 10 costs for one regular show                                                        |
| `production.showCost.camera`                      | integer | 15,000,000  | 0–10,000,000,000 | money       | Same, camera                                                                                             |
| `production.showCost.editing`                     | integer | 10,000,000  | 0–10,000,000,000 | money       | Same, editing                                                                                            |
| `production.showCost.pyro`                        | integer | 6,000,000   | 0–10,000,000,000 | money       | Same, pyro                                                                                               |
| `production.monthlyCost.music`                    | integer | 50,000,000  | 0–10,000,000,000 | money/month | What music at level 10 costs each month                                                                  |
| `production.monthlyCost.writing`                  | integer | 25,000,000  | 0–10,000,000,000 | money/month | Same, writing                                                                                            |
| `production.monthlyCost.marketing`                | integer | 120,000,000 | 0–10,000,000,000 | money/month | Same, marketing                                                                                          |
| `production.monthlyCost.backOffice`               | integer | 100,000,000 | 0–10,000,000,000 | money/month | Same, back office                                                                                        |
| `production.upgradeFee.stage`                     | integer | 60,000,000  | 0–10,000,000,000 | money       | One-time fee for raising stage all the way from level 0 to 10                                            |
| `production.upgradeFee.camera`                    | integer | 50,000,000  | 0–10,000,000,000 | money       | Same, camera                                                                                             |
| `production.upgradeFee.editing`                   | integer | 40,000,000  | 0–10,000,000,000 | money       | Same, editing                                                                                            |
| `production.upgradeFee.pyro`                      | integer | 25,000,000  | 0–10,000,000,000 | money       | Same, pyro                                                                                               |
| `production.upgradeFee.music`                     | integer | 30,000,000  | 0–10,000,000,000 | money       | Same, music                                                                                              |
| `production.upgradeFee.writing`                   | integer | 20,000,000  | 0–10,000,000,000 | money       | Same, writing                                                                                            |
| `production.upgradeFee.marketing`                 | integer | 15,000,000  | 0–10,000,000,000 | money       | Same, marketing                                                                                          |
| `production.upgradeFee.backOffice`                | integer | 15,000,000  | 0–10,000,000,000 | money       | Same, back office                                                                                        |
| `production.showCostMultiplier.house`             | number  | 0.25        | 0–10             | multiplier  | Stage, camera, editing and pyro costs are multiplied by this, house show                                 |
| `production.showCostMultiplier.minor`             | number  | 0.5         | 0–10             | multiplier  | Same, minor show                                                                                         |
| `production.showCostMultiplier.regular`           | number  | 1           | 0–10             | multiplier  | Same, regular show                                                                                       |
| `production.showCostMultiplier.major`             | number  | 1.5         | 0–10             | multiplier  | Same, major show                                                                                         |
| `production.showCostMultiplier.flagship`          | number  | 2.5         | 0–10             | multiplier  | Same, flagship show                                                                                      |
| `production.popularityCeiling.base`               | number  | 20          | 0–100            | points      | Popularity ceiling with no marketing and no back office                                                  |
| `production.popularityCeiling.perMarketingLevel`  | number  | 5           | 0–20             | points      | Popularity ceiling added by each level of marketing                                                      |
| `production.popularityCeiling.perBackOfficeLevel` | number  | 5           | 0–20             | points      | Popularity ceiling added by each level of back office                                                    |
| `production.popularityDrag.fractionPerDay`        | number  | 0.02        | 0–1              | ratio       | Share of the popularity above the ceiling lost each day                                                  |
| `production.popularityDrag.minPerDay`             | number  | 0.05        | 0–10             | points/day  | Least popularity lost each day while above the ceiling (0 = no floor)                                    |
| `production.tvDealMinCamera`                      | integer | 1           | 0–10             | points      | Lowest camera level allowed while the promotion has a TV deal                                            |
| `production.feeNeedsCash`                         | boolean | true        |                  | flag        | An upgrade fee must be covered by cash in hand                                                           |
| `production.forecastDays`                         | integer | 28          | 1–90             | days        | How many days ahead the production screen adds up the coming shows                                       |
| `production.rivalBudget.lowerBelowMonths`         | number  | 12          | 0–60             | months      | Temporary rival rule (until AIP8): cut production when cash covers fewer months of its costs (0 = never) |
| `production.rivalBudget.deepCutBelowMonths`       | number  | 6           | 0–60             | months      | Temporary rival rule: below this, also cut levels that lower a ceiling in use (0 = never)                |
| `production.rivalBudget.raiseAboveMonths`         | number  | 24          | 0–120            | months      | Temporary rival rule: raise one held-back level a month above this many months of costs (0 = never)      |
| `production.rivalBudget.headroom`                 | number  | 5           | 0–100            | points      | Temporary rival rule: room kept between the best recent show or region and its ceiling                   |
| `production.rivalBudget.lookbackDays`             | integer | 28          | 1–365            | days        | Temporary rival rule: how far back the best show is looked for                                           |
| `production.runway.lookbackDays`                  | integer | 28          | 7–28             | days        | Recent days of ticket sales and other show money the cash runway averages                                |
| `production.runway.minDaysPlayed`                 | integer | 7           | 1–28             | days        | Days of play before the cash runway counts show money                                                    |
| `production.runway.warnBelowMonths`               | number  | 6           | 0–36             | months      | The cash runway warns "Running out of cash" below this many months (0 = never)                           |

## Contracts tunables

ECO4-01, see [contracts.md](contracts.md#simple-renewals). The simple rival
renewal, a D-01 stopgap until the rival labour market (ECO6). ECO4-02 added
[severance](contracts.md#severance), the
[expiring-soon](contracts.md#expiring-soon) notices and the player's temporary
[automatic renewal](contracts.md#player-renewals) (until ECO5). ECO4-03 added
[unhappy workers](contracts.md#unhappy-workers) and
[walk-outs](contracts.md#walk-outs).

| Key                                       | Kind    | Default     | Range    | Unit        | Meaning                                                                                                                 |
| ----------------------------------------- | ------- | ----------- | -------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ai.contracts.simpleRenewals`             | boolean | true        |          | flag        | Rival promotions renew contracts by a simple rule until the rival labour market exists; off under a level playing field |
| `contracts.ai.keepPushAtOrAbove`          | enum    | `upperCard` | push     | choice      | A rival always renews workers pushed at this card position or higher                                                    |
| `contracts.ai.keepChampions`              | boolean | true        |          | flag        | A rival always renews a worker who holds one of its titles                                                              |
| `contracts.ai.renewChance`                | number  | 0.6         | 0–1      | probability | Chance a rival renews any other worker whose contract runs out                                                          |
| `contracts.ai.renewMinDays`               | integer | 365         | 1–3650   | days        | Shortest new contract a rival renewal gives                                                                             |
| `contracts.ai.renewMaxDays`               | integer | 1095        | 1–3650   | days        | Longest new contract a rival renewal gives (if below the shortest, the two swap)                                        |
| `contracts.severance.fullMonths`          | integer | 3           | 0–60     | months      | Months still owed that are paid in full                                                                                 |
| `contracts.severance.tailRate`            | number  | 0.35        | 0–1      | ratio       | Share paid for each owed month beyond the full months                                                                   |
| `contracts.severance.capMonths`           | integer | 18          | 0–120    | months      | Owed months beyond this are not paid at all                                                                             |
| `contracts.severance.openEndedMonths`     | integer | 6           | 0–60     | months      | Months treated as owed on an open-ended deal                                                                            |
| `contracts.severance.appearancesPerMonth` | integer | 4           | 0–31     | count       | Monthly value of a per-appearance deal, in appearances                                                                  |
| `contracts.severance.ironCladMultiplier`  | number  | 2           | 0–10     | multiplier  | Severance on an iron-clad contract is multiplied by this                                                                |
| `contracts.severance.mutualMorale`        | integer | −50         | −100–100 | points      | At or below this morale the worker is glad to go                                                                        |
| `contracts.severance.mutualDiscount`      | number  | 0.5         | 0–1      | ratio       | Share of the severance a worker who is glad to go gives up                                                              |
| `contracts.severance.unstartedFactor`     | number  | 0.5         | 0–1      | ratio       | Share due when calling off a deal that hasn't started                                                                   |
| `contracts.expiring.windowDays`           | integer | 60          | 1–365    | days        | Contracts ending within this many days are listed as expiring                                                           |
| `contracts.expiringSoon.days`             | integer | 30          | 0–365    | days        | Raise a notice when one of your contracts ends within this many days (0 = no notices)                                   |
| `contracts.expiringSoon.minPush`          | enum    | `midCard`   | push     | choice      | Notices only for workers at or above this push                                                                          |
| `contracts.expiringSoon.stopSkip`         | boolean | true        |          | flag        | A new expiry notice stops a skip until you mark it as seen                                                              |
| `contracts.autoRenewPlayer`               | boolean | true        |          | flag        | Temporary: your contracts renew on the same terms when they run out, until you can renew them yourself (until ECO5)     |
| `contracts.autoRenewPlayerDays`           | integer | 365         | 1–3650   | days        | Temporary: how long each automatic renewal of your contracts adds                                                       |
| `contracts.quit.threshold`                | integer | −40         | −100–100 | points      | At or below this morale the unhappy clock runs                                                                          |
| `contracts.quit.days`                     | integer | 14          | 0–365    | days        | Days in a row at or below the threshold before asking to leave; 0 = at once                                             |
| `contracts.quit.severanceShare`           | number  | 0.5         | 0–1      | ratio       | Share of normal severance paid when you grant a request                                                                 |
| `contracts.quit.storyShieldHeat`          | integer | 70          | 0–100    | points      | Storyline heat at which the clock and walk-out rolls pause (D-09)                                                       |
| `contracts.releaseRequest.answerDays`     | integer | 7           | 1–60     | days        | Days you have to answer a release request before it counts as refused                                                   |
| `contracts.releaseRequest.stopSkip`       | boolean | false       |          | flag        | A new release request stops a skip until you answer it (off until ECO4-04's Contracts screen)                           |
| `contracts.refuse.moralePenalty`          | integer | 10          | 0–100    | points      | Morale a worker loses when their release request is refused                                                             |
| `contracts.walkout.chancePerDay`          | number  | 0.02        | 0–1      | probability | Daily chance a refused worker walks out                                                                                 |
| `contracts.walkout.extraPerPoint`         | number  | 0.001       | 0–0.1    | probability | Extra daily walk-out chance per morale point below the threshold                                                        |
| `contracts.walkout.maxPerDay`             | number  | 0.1         | 0–1      | probability | Highest daily walk-out chance                                                                                           |
| `contracts.walkout.recoverMargin`         | integer | 10          | 0–100    | points      | Morale this far above the threshold ends the walk-out risk                                                              |
