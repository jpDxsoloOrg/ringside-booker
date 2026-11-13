# Physical toll

What a match costs the people who work it: the fatigue they pick up and the
body condition they lose (MTCH4). This page covers the two "load" formulas for
one worker in one match and the risk modifier seam (MTCH4-01). The injury
chance (MTCH4-02), the show-night applier that writes the results (MTCH4-03)
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
