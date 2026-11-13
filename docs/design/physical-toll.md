# Physical toll

What a match costs the people who work it: the fatigue they pick up and the
body condition they lose (MTCH4). This page covers the two "load" formulas for
one worker in one match and the risk modifier seam (MTCH4-01), and the
in-match injury chance and roll (MTCH4-02). The show-night applier that writes the results (MTCH4-03)
and the Match lab's Why? panels (MTCH4-05) build on it. Recovery belongs to
the health system (WRK6), not here.

The code lives inside the `match` system: the inputs, tunables, stream and
seam in `packages/engine/src/systems/match/physical/`, and the formulas in
`packages/engine/src/systems/match/formulas/` (`fatigueGain.ts`,
`conditionWear.ts`, `wearByPart.ts`), following the
[formula module conventions](calculation-traces.md). Nothing here writes to
the world.

Like the rating, the physical toll never uses minutes or a match length
([D-10](design-decisions.md#d-10-cards-are-built-from-segment-slots-not-minutes-2026-11-07)):
it starts from the slot's **duration class** (short, standard or long, from
`durationClassOf` in [match-rating.md](match-rating.md#duration-class)), and
the first line of every fatigue and wear trace names it, for example "Long
duration class". A test walks every trace label and fails on "minute" or
"length".

## Who carries load

`collectPhysicalInputs(read, spec)` turns a `PhysicalSegmentSpec` (promotion,
event importance, segment kind, duration class, the sides as
`{ personId, role }` lists, the producer, keep-it-safe, optional lab fatigue
overrides and optional card position) into one entry per worker who carries
load. These are fixed rules, not tunables:

- **Only competitors carry load.** `ringside`, `interferer`, `speaker` and
  `subject` participants gain no fatigue and lose no condition.
- **Talking segments cost nothing.** An angle gives no entries at all: promos
  and other talking segments cost no stamina (owner rule).
- **Workload counts every competitor**, across every side, so a tag match is
  lighter per person than a singles match.
- **Opponents** are every competitor on another side (all of them in a triple
  threat).
- **Order is fixed**: side by side, and by person id within a side.
- **Lab overrides** replace the fatigue going in only in the returned inputs;
  the world is untouched.
- **Repeat matches.** With a card position (show, section and slot), each
  worker gets the number of matches they work as a competitor _earlier_ on
  that card (`earlierMatchesOnCard`). A lab draft without a position counts
  as everyone's first match.

## Fatigue gain

`computeFatigueGain(inputs, { tunables })`, in fatigue points:

1. Start at `match.fatigue.base.<class>` ("Long duration class").
2. When more than two people work the match, multiply by their share of the
   workload: 2 ÷ workers, never below `match.fatigue.minShare` and never above
   1 (the 2 is fixed: a one-on-one match is the full workload). The trace adds
   a "Shared workload (N workers)" line.
3. Multiply by the stamina factor `1 − (stamina − 50) × match.fatigue.staminaRelief`
   (50 is the middle of the scale: higher stamina eases fatigue, lower adds to
   it).
4. Multiply by `match.fatigue.style.<style>`.
5. Multiply by `match.fatigue.workhorseFactor` for a workhorse, or
   `match.fatigue.coasterFactor` for a coaster.
6. Multiply by `match.fatigue.houseShowFactor` at a house show.
7. Multiply by each risk contribution's `fatigueMultiplier`, one line per
   source ("Stipulation: Ladder").
8. **Working more than once on one card** (owner rule): multiply by
   `match.fatigue.repeatMatch` once for each earlier match that night, so it
   compounds: "Second match tonight ×1.5", "Third match tonight ×2.25".
9. Multiply by `match.fatigue.keepItSafeFactor` when keep-it-safe is on, from
   the booker or from a contribution (then the line names it).
10. Keep the result between 0 and `match.fatigue.maxPerSegment`.

With default numbers a singles main event costs an average worker 12, the same
match as the opener 7.

## Wear

`computeConditionWear(inputs, { tunables, rng })` is the wear load: condition
points lost at a part weight of 1.

1. Start at `match.wear.base.<class>` ("Long duration class").
2. Multiply by `match.wear.selfStyle.<style>`: how hard the worker's own style
   is on their body.
3. Multiply by the roughest opponent's `match.wear.opponentStyle.<style>`: the
   highest factor among the opponents, ties to the lower person id, shown as
   "Roughest opponent: Rex Hale (Brawler)".
4. Multiply by the opponents' safety factor
   `1 + (50 − average opponent safety) × match.wear.safetyWeight`, kept between
   `match.wear.minSafetyFactor` and `match.wear.maxSafetyFactor`, shown as
   "Opponents' safety 42".
5. Multiply by `match.wear.durableFactor` (durable) or
   `match.wear.injuryProneFactor` (injury prone).
6. Multiply by `match.wear.houseShowFactor` at a house show.
7. Multiply by each contribution's `wearMultiplier`.
8. Multiply by the same repeat-match factor as fatigue
   (`match.fatigue.repeatMatch` per earlier match tonight).
9. Multiply by `match.wear.keepItSafeFactor` when keep-it-safe is on.
10. Multiply by the roughness roll `1 + match.wear.spread × (2u − 1)`, where `u`
    is one draw from the `match.wear` stream ("How rough the match was").
11. Keep the result between 0 and `match.wear.maxPerSegment`.

The roll is drawn **exactly once per call**, even when the spread is 0, so
retuning never shifts the stream. One roll per worker, not one per body part.

`computeWearByPart(load, { tunables })` then spreads the load over the body in
`BODY_PARTS` order: each part loses the load × `match.wear.part.<part>`, and
each part's trace starts from the load's trace. A part weighted 0 takes no
wear.

Wear is small per match by design (a few tenths of a point per part). Until
WRK6 brings recovery, condition only goes down; if that bites in playtesting,
lower `match.wear.base.*` rather than adding recovery here.

## Risk modifiers

`registerRiskModifier({ id, order, contribute })` is the seam later features
(MTCH7's stipulations and production notes) use to make a segment, or one
worker in it, more or less tiring and dangerous without touching these files.
It follows the setup step registry: the id must look like `system.camelName`,
a duplicate id is refused, and the call returns an unregister function for
tests. Modifiers run by `order`, then id.

`contribute(ctx)` gets the segment spec plus a read view and returns
contributions:

| Field               | Meaning                                                       |
| ------------------- | ------------------------------------------------------------- |
| `source`            | Player text for the trace line, such as "Stipulation: Ladder" |
| `personIds`         | The workers it applies to, or null for every competitor       |
| `fatigueMultiplier` | Multiplies fatigue gain (0 or more)                           |
| `wearMultiplier`    | Multiplies the wear load (0 or more)                          |
| `injuryMultiplier`  | Multiplies the injury chance (MTCH4-02; 0 or more)            |
| `injuryAdd`         | Adds to the injury chance (MTCH4-02; 0 to 1)                  |
| `keepItSafe`        | Switches the keep-it-safe factors on for the workers it hits  |

`collectRiskContributions(ctx, personId)` validates every contribution and
returns those that reach the worker, in modifier order. A bad value (not a
finite number, a negative multiplier, an injury chance outside 0..1) throws a
`RegistryError` naming the modifier. With nothing registered there are no
contribution lines in the traces.

## Injury chance

`computeInjuryChance(inputs, { tunables })` in
`packages/engine/src/systems/match/formulas/injuryChance.ts` is the
probability (0..1) that one worker is hurt in one match. It reads the worker
**by the end of the match**: fatigue going in plus this match's fatigue gain,
and body condition after this match's wear. A long, hard match is riskier at
the end of it, and because the chance is built from those results, the roll
can only come after them.

1. Start at `match.injury.baseChance` (0.003).
2. Add **Fatigue by the end of the match** × `match.injury.perFatiguePoint`,
   where the fatigue is `min(100, fatigue going in + this match's gain)`.
3. Add (100 − the worst body part after this match's wear) ×
   `match.injury.perConditionPointLost`, labelled "Worst body part: Back 80".
   Ties go to the first part in `BODY_PARTS` order.
4. × `match.injury.duration.<class>` ("Long duration class"; short 0.7,
   standard 1, long 1.3).
5. × the least safe opponent's factor, labelled "Least safe opponent: <name>,
   safety <n>" (lowest safety, ties by id):
   `clamp(1 + (50 − safety) × opponentSafetyWeight, min, max)` with
   `minSafetyFactor` 0.5 and `maxSafetyFactor` 1.6. Wear uses the opponents'
   average safety; the injury chance uses the single least safe one, because
   one careless worker is enough to hurt someone.
6. × `match.injury.selfStyle.<own style>` (high flyer and hardcore 1.4).
7. × the riskiest opponent's `match.injury.opponentStyle.<style>` (highest
   factor, ties by id; hardcore 1.3, brawler and striker 1.2, powerhouse 1.15).
   With no opponents steps 5 and 7 are a "No opponents" note.
8. × `injuryProneFactor` (1.8) for an injury-prone worker, ×
   `durableFactor` (0.5) for a durable one.
9. \+ each risk contribution's `injuryAdd`, then × each `injuryMultiplier`,
   one line per contribution labelled by its `source`.
10. × `match.injury.repeatMatch` (1.4) once for each earlier match the worker
    works on the same card, compounding (owner rule: double-booking is
    allowed and raises the risk in each extra match). The line reads "Second
    match tonight ×1.4". Talking segments carry no load, so they never reach
    this formula and never count as an earlier match.
11. × `keepItSafeFactor` (0.5) when keep-it-safe applies (the booker or a
    contribution; the line names which).
12. Keep it between 0 and `match.injury.maxChance` (0.2).
13. The switches: × 0 with the branch "In-match injuries switched off" when
    `match.injury.enabled` is off, and × 0 with the branch "Rival rules: no
    in-match injuries" when the promotion's rating policy has
    `skipInMatchInjuries` ([D-01][d-01]). `injuryPolicyFor(read, tunables, id)`
    asks the one rating policy provider (AIP1's, from `ai.skipInMatchInjuries`)
    and returns the flag with a trace of the policy, which sits under that
    line. There is no promotion-kind branch anywhere: with no provider every
    promotion rolls like yours.

[d-01]: design-decisions.md#d-01-rival-promotions-use-simplified-rules-2026-11-07

Every key has a minimum of 0, so with the base and both per-point terms at 0
the chance is exactly 0.

Rough numbers with the defaults, so the Match lab's Run x100 owner test is not
a coin flip (the 0.3% and the 2–3% rows are checked by tests):

| Worker                                                                      | Chance |
| --------------------------------------------------------------------------- | ------ |
| Fresh all-rounder, standard match, ordinary opponent                        | 0.3%   |
| Fresh all-rounder, long match                                               | 0.4%   |
| Fresh high flyer against a hardcore opponent with safety 30                 | 0.7%   |
| Exhausted (fatigue 100 by the end), worst part 90, long, opponent safety 20 | 2.5%   |
| The same, opponent safety 0                                                 | 2.9%   |
| The same as the 2.5% worker, in their second match tonight                  | 3.5%   |

A long main event between two exhausted workers with careless opponents
injures someone in about 5 runs of 100.

## The injury roll

`rollSegmentInjuries(entries, { tunables, rng })` in
`packages/engine/src/systems/match/physical/injuries.ts` decides who, if
anyone, is hurt in one segment. Each entry is a worker with their chance, side,
entrance order and condition after wear.

- **It runs last.** Fatigue gain, wear and every risk contribution are worked
  out first and are part of the chance, so every line on the Why? panel took
  part in the roll. (A risk added after the roll would have no effect; a test
  registers a stand-in "major spot" modifier for one worker and checks the
  rolled odds include it.)
- **Fixed order:** side, then entrance order (workers without one after those
  with one), then person id.
- **One draw per worker** from the `match.injury` stream
  (`rollChance(rng, chance, 'Injury roll: <name>')`), even when the chance is
  0 or the segment's limit is already reached, so the stream stays aligned
  however things are tuned.
- **Per-segment limit:** at most `match.injury.maxPerSegment` (1) workers are
  hurt in one segment; 0 means nobody ever is. A later hit is not dropped: its
  trace carries the rule line "Already 1 injured in this segment (most per
  segment: 1)" and the result says `hit: true, injured: false`.
- Each result's `decision` is an "Injured in this match?" decision with the
  chance as a considered option, the roll, and the limit line when it applied.
  An injured worker also gets a `bodyPartHint`: the part with the lowest
  condition after this segment's wear (ties in `BODY_PARTS` order).

**Health belongs to WRK6.** MTCH4 rolls and hands each injury to the one
registered handler: `registerInjuryHandler({ id, apply(ctx, request) })`, where
`request` is `{ personId, segmentId, eventInstanceId, date, bodyPartHint,
chanceTrace }` and `ctx` is the phase context the segment result applier runs
in. The handler returns `{ injuryTraceRef }`. There is exactly one handler at a
time (a second registration throws a `RegistryError` naming both ids); the
call returns an unregister function and `getInjuryHandler()` returns it or
null. WRK6 registers `health.injure`, whose catalog roll decides the real
injury and may ignore the hint. With no handler nothing is written, and
callers can still read who would have been hurt from the results.

MTCH4 never touches morale: an injury inside a hot angle has no morale effect
from this feature (D-09; WRK8 owns morale).

The traces are stored under refs from `physical/traceRefs.ts`, all keyed
`<segmentId>:<personId>`: `match.fatigue`, `match.wear`, `match.learning`,
`match.injuryChance` and `match.injuryRoll` (the show-night applier, MTCH4-04,
stores them).

## Tunables

All in `systems/match/physical/tunables.ts`, category `Physical toll`. Every
key has a minimum of 0, so 0 means 0.

| Key                                | Default | Range  | Unit       | What it does                                                                                                                |
| ---------------------------------- | ------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `match.fatigue.base.short`         | 4       | 0–100  | points     | Fatigue a short match costs one worker before anything moves it                                                             |
| `match.fatigue.base.standard`      | 7       | 0–100  | points     | Fatigue a standard match costs                                                                                              |
| `match.fatigue.base.long`          | 12      | 0–100  | points     | Fatigue a long match costs                                                                                                  |
| `match.fatigue.minShare`           | 0.35    | 0–1    | ratio      | Smallest share of the workload in a crowded match; 1 turns sharing off                                                      |
| `match.fatigue.staminaRelief`      | 0.006   | 0–0.02 | ratio      | Fatigue eased per point of stamina above 50 (added per point below)                                                         |
| `match.fatigue.style.<style>`      | 1       | 0–3    | multiplier | How tiring a style finds a match: high flyer and hardcore 1.15, powerhouse 1.1, striker 1.05, showman 0.9, non-wrestler 0.8 |
| `match.fatigue.workhorseFactor`    | 1.15    | 0–3    | multiplier | Extra fatigue for a workhorse                                                                                               |
| `match.fatigue.coasterFactor`      | 0.85    | 0–3    | multiplier | Less fatigue for a coaster                                                                                                  |
| `match.fatigue.houseShowFactor`    | 0.6     | 0–3    | multiplier | Fatigue at a house show                                                                                                     |
| `match.fatigue.keepItSafeFactor`   | 0.8     | 0–3    | multiplier | Fatigue when told to keep it safe                                                                                           |
| `match.fatigue.repeatMatch`        | 1.5     | 0–3    | multiplier | Fatigue and wear for each match after the first on the same card, compounding                                               |
| `match.fatigue.maxPerSegment`      | 40      | 0–100  | points     | Most fatigue one match can add                                                                                              |
| `match.wear.base.short`            | 0.2     | 0–5    | points     | Wear a short match costs one worker before anything moves it                                                                |
| `match.wear.base.standard`         | 0.35    | 0–5    | points     | Wear a standard match costs                                                                                                 |
| `match.wear.base.long`             | 0.6     | 0–5    | points     | Wear a long match costs                                                                                                     |
| `match.wear.selfStyle.<style>`     | 1       | 0–3    | multiplier | How hard a worker's own style is on them: high flyer and hardcore 1.5, powerhouse 1.2, non-wrestler 0.5                     |
| `match.wear.opponentStyle.<style>` | 1       | 0–3    | multiplier | How rough an opponent's style is: striker and hardcore 1.3, brawler and powerhouse 1.2, technician 1.1, grappler 0.85       |
| `match.wear.safetyWeight`          | 0.008   | 0–0.05 | ratio      | Wear added per point the opponents' average safety is below 50 (taken off above)                                            |
| `match.wear.minSafetyFactor`       | 0.6     | 0–3    | multiplier | Least wear safe opponents can bring it to                                                                                   |
| `match.wear.maxSafetyFactor`       | 1.4     | 0–3    | multiplier | Most wear careless opponents can bring it to                                                                                |
| `match.wear.durableFactor`         | 0.7     | 0–3    | multiplier | Wear for a durable worker                                                                                                   |
| `match.wear.injuryProneFactor`     | 1.3     | 0–3    | multiplier | Wear for an injury-prone worker                                                                                             |
| `match.wear.houseShowFactor`       | 0.6     | 0–3    | multiplier | Wear at a house show                                                                                                        |
| `match.wear.keepItSafeFactor`      | 0.5     | 0–3    | multiplier | Wear when told to keep it safe                                                                                              |
| `match.wear.spread`                | 0.5     | 0–1    | ratio      | How far the roughness roll moves wear either way; 0 means no randomness                                                     |
| `match.wear.maxPerSegment`         | 5       | 0–100  | points     | Most wear one match can cost, before it is spread over the body                                                             |
| `match.wear.part.<part>`           | 1       | 0–3    | multiplier | Share of the wear a body part takes: head 0.6, neck 0.8, back 1, arms 0.9, torso 0.8, legs 1                                |

`<style>` is each of the ten ring styles and `<part>` each of the six body
parts; the defaults not listed in a row are 1.
| `match.injury.enabled` | true | on/off | flag | Workers can get hurt in a match; off, nobody is ever injured in one |
| `match.injury.baseChance` | 0.003 | 0–0.2 | probability | Injury chance for a fresh worker in a standard match before anything moves it |
| `match.injury.perFatiguePoint` | 0.0001 | 0–0.01 | probability | Added per point of fatigue by the end of the match |
| `match.injury.perConditionPointLost` | 0.0001 | 0–0.01 | probability | Added per point the worst body part is below 100 |
| `match.injury.duration.<class>` | 1 | 0–3 | multiplier | Injury chance by duration class: short 0.7, standard 1, long 1.3 |
| `match.injury.opponentSafetyWeight` | 0.012 | 0–0.05 | ratio | Added per point the least safe opponent is below 50 safety (taken off above) |
| `match.injury.minSafetyFactor` | 0.5 | 0–3 | multiplier | Least a safe opponent can bring the chance to |
| `match.injury.maxSafetyFactor` | 1.6 | 0–3 | multiplier | Most a careless opponent can bring the chance to |
| `match.injury.selfStyle.<style>` | 1 | 0–3 | multiplier | How much a worker's own style raises their chance: high flyer and hardcore 1.4 |
| `match.injury.opponentStyle.<style>` | 1 | 0–3 | multiplier | How much an opponent's style raises it: hardcore 1.3, brawler and striker 1.2, powerhouse 1.15 |
| `match.injury.injuryProneFactor` | 1.8 | 0–3 | multiplier | Injury chance for an injury-prone worker |
| `match.injury.durableFactor` | 0.5 | 0–3 | multiplier | Injury chance for a durable worker |
| `match.injury.keepItSafeFactor` | 0.5 | 0–3 | multiplier | Injury chance when told to keep it safe |
| `match.injury.repeatMatch` | 1.4 | 0–3 | multiplier | Injury chance for each match after the first on the same card, compounding |
| `match.injury.maxChance` | 0.2 | 0–1 | probability | Highest injury chance one worker can have in one match |
| `match.injury.maxPerSegment` | 1 | 0–10 | count | Most workers injured in one segment; 0 means nobody is ever hurt |
