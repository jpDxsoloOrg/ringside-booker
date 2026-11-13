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

## Ring learning

Matches also teach (MTCH4-03). Every competitor picks up a little ring skill
each time they work: more in a long match, more next to someone better or a
`teacher`, more when a skilled producer lays the match out, and more again
when their mentor is on the same show. The gains are small on purpose
(hundredths of a point per match); the long career arc of growth and decline
belongs to WRK4. Talking segments teach nothing here.

The code: the attribute list in `physical/learning.ts`, the hidden gate in
`physical/learningRoom.ts`, the mentor lookup in `physical/mentor.ts`, the
per-segment collector `collectRingLearning` in `physical/collectLearning.ts`
and the formula in `formulas/ringLearning.ts`. MTCH4's show-night applier
writes the gains after each match; nothing here writes to the world.

### What a match teaches

`IN_MATCH_LEARNING` is a constant rule, not a tunable:

| Attribute    | Taught | Why                                                               |
| ------------ | ------ | ----------------------------------------------------------------- |
| `ringwork`   | yes    | Craft: learned by doing and from the people you work with         |
| `psychology` | yes    | Craft, as ring work                                               |
| `safety`     | yes    | Craft, as ring work                                               |
| `stamina`    | no     | Conditioning: comes only from doing the work; nobody can teach it |

Crew attributes (`officiating`, `producing`, `broadcasting`) are learned on the
job in other roles and `mic` in talking segments; WRK4 and MTCH5 own those and
can call the same formula with their own list (`taught` is an input).

### The maths

For one worker and one attribute, in attribute points:

```text
learning = base
         × duration.<class>                              "Long duration class"
         × taughtFactor           (taught; someone else in the match is better
                                   by at least teachGap)  "Learned from a better worker: <name>"
         × min(1 + teacherBonus × teachers, maxTeacherFactor)
                                  (taught; other competitors or the producer
                                   hold `teacher`)        "Worked with a teacher: <names>"
         × producerFactor         (ring work and psychology; the producer's
                                   producing ≥ producerMinSkill)  "Produced by <name>"
         × fastLearnerFactor or slowLearnerFactor        "Fast learner" / "Slow learner"
         × (1 + mentorBonus)      (the mentor is on the card)     "Mentor on the card: <name>"
         × room factor            (1 when open; slowing or closed) "Limited by potential"
clamped to 0..maxPerSegment
```

An untaught attribute (stamina) skips the better-worker and teacher steps and
records the line "Learned by doing" instead. The better worker is the best one
in the match, on either side. A teacher helps the others, not themselves: a
teacher alone in a match gets no teacher line. A producer who also wrestles in
the match counts once, as a competitor.

`computeRingLearningTotal` adds the attributes into one "Learning in this
match" number with one line per attribute ("Ring work +0.06") that opens to
that attribute's own Why?.

With the defaults, a standard match against an equal opponent teaches 0.03 per
attribute; a young wrestler in a long match next to a much better teacher, laid
out by a skilled producer, learns `0.03 × 1.4 × 2 × 1.5 × 1.2 ≈ 0.15` ring
work.

### Mentor on the card

`mentorOnCard(read, personId, cardPersonIds)` reads the foundation
`relationships` table: a row for the pair (stored in either order) with the
`mentorship` bond and `mentorId` set to the other person, who must be on the
card. On a show the card is everyone on it in any role, the producer included;
in the Match lab it is everyone in the lab segment. With two mentors on the
card, the lowest id wins. Until the social system creates relationship rows
the default world has none, so the mentor line never appears.

### The hidden gate

`learningRoom(person, attribute, tunables)` reads the hidden development fields
(the potential number and the attribute's ceiling, see
[data-model.md](data-model.md)) and returns only a label:

- `closed` when potential is below 0 or the attribute is at or above its
  ceiling;
- `slowing` when the attribute is within `match.learning.slowingBand` of its
  ceiling or potential is below `match.learning.lowPotential`;
- `open` otherwise. An attribute without a ceiling is gated on potential only.

Only the label enters the formula. Player text never shows potential or a
ceiling: when the room is not open the Why? reads the fixed line "Limited by
potential" and nothing more. `potential` and `ceilings` never become trace
inputs, constants or notes, and `slowingBand` and `lowPotential` are never read
inside a trace. A leak test builds traces in every room for people with
distinctive hidden numbers and fails if a label mentions potential or a ceiling
(other than the fixed line) or the numbers appear anywhere in the trace.
`learningRoom` is not exported from the engine's public index.

The room factor is the last step before the clamp and nothing adds learning
after it, so no bonus can get past the gate (a growth floor that bypassed the
potential gate was a known bug in the genre).

**Overshoot.** An attribute can pass its ceiling by at most one match's gain,
because the applier does not clamp to the ceiling: a clamp would let the player
work the ceiling out from the arithmetic. The next match is then `closed`.

### With WRK4's growth

WRK4's daily growth and this per-match learning add up: the applier adds a
match's learning to the attribute after the match, and WRK4's growth moves the
attribute on its own schedule. Both read the same gate: WRK4 treats a value at
or above the ceiling as no growth, so the one-match overshoot never compounds.
When WRK4 lands, its growth-headroom reading of potential and ceilings and
`learningRoom` should agree on when an attribute is capped (WRK4 can call
`learningRoom` or share its rule).

### Ring learning tunables

All in `systems/match/physical/learningTunables.ts`, category `Physical toll`.
Every key has a minimum of 0, so 0 means 0.

| Key                                 | Default | Range  | Unit       | What it does                                                    |
| ----------------------------------- | ------- | ------ | ---------- | --------------------------------------------------------------- |
| `match.learning.base`               | 0.03    | 0–1    | points     | Ring skill one match teaches per attribute before anything else |
| `match.learning.duration.short`     | 0.6     | 0–3    | multiplier | How much a short match teaches against a standard one           |
| `match.learning.duration.standard`  | 1       | 0–3    | multiplier | A standard match                                                |
| `match.learning.duration.long`      | 1.4     | 0–3    | multiplier | A long match                                                    |
| `match.learning.teachGap`           | 5       | 0–50   | points     | How much better someone must be to teach the worker             |
| `match.learning.taughtFactor`       | 2       | 0–3    | multiplier | Learning next to someone better                                 |
| `match.learning.teacherBonus`       | 0.5     | 0–2    | ratio      | Extra learning per teacher in the match                         |
| `match.learning.maxTeacherFactor`   | 2       | 0–3    | multiplier | Most teachers can multiply learning by                          |
| `match.learning.producerMinSkill`   | 60      | 0–100  | points     | Producing skill a producer needs to help                        |
| `match.learning.producerFactor`     | 1.2     | 0–3    | multiplier | Learning under a skilled producer (ring work and psychology)    |
| `match.learning.fastLearnerFactor`  | 1.5     | 0–3    | multiplier | Learning for a fast learner                                     |
| `match.learning.slowLearnerFactor`  | 0.6     | 0–3    | multiplier | Learning for a slow learner                                     |
| `match.learning.mentorBonus`        | 0.25    | 0–2    | ratio      | Extra learning when the worker's mentor is on the same show     |
| `match.learning.roomFactor.slowing` | 0.4     | 0–3    | multiplier | Learning for a worker near their limit                          |
| `match.learning.roomFactor.closed`  | 0       | 0–3    | multiplier | Learning for a worker at their limit                            |
| `match.learning.slowingBand`        | 5       | 0–50   | points     | How close to their limit a worker is before learning slows      |
| `match.learning.lowPotential`       | 200     | 0–1000 | points     | Below this hidden score (−1000..1000), learning slows           |
| `match.learning.maxPerSegment`      | 0.2     | 0–5    | points     | Most one match can teach per attribute                          |
