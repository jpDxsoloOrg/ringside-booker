# Match rating

How a single segment on a card is judged: where it sits, how long it runs
without minutes, how much it counts, and (in later MTCH1 sections) how its
rating is worked out. The `match` system
(`packages/engine/src/systems/match/`) owns all of it; the match types, angle
types and win methods it reads are the runtime catalogs described in
[data-packs.md](data-packs.md#match-and-segment-catalogs).

Nothing here is stored. Every value is derived from the card when it is asked
for, so moving a segment can never leave a stale role or class behind.

## D-10 in short

[D-10](design-decisions.md#d-10-cards-are-built-from-segment-slots-not-minutes-2026-11-07)
says you never set minutes. A show has a number of segment slots, and a
segment's position decides its **role**. The role implies a **duration class**
(short, standard or long) and a **weight** (how much it counts toward the show
score). The main event is always the long, heaviest slot. A match type can move
the duration class one step up or down.

## Slots

Three pure functions in `systems/match/slots.ts`, each returning a traced value
so a "Why?" panel can show the rule that decided it. All three are exported
from `@ringside/engine`.

| Question                     | Function                                     | Returns                 |
| ---------------------------- | -------------------------------------------- | ----------------------- |
| Which role does a slot have? | `slotRoleOf({ slot, slots, preShow }, deps)` | `Traced<SlotRole>`      |
| How long does it run?        | `durationClassOf({ role, matchType }, deps)` | `Traced<DurationClass>` |
| How much does it count?      | `slotWeightOf({ role }, deps)`               | `Traced<number>`        |

`deps` is `{ tunables }`. Slots are 1-based and counted separately on the
pre-show and the main card.

### Slot role

Rules, checked in this order; the first that holds decides:

| Rule                                                                         | Role       |
| ---------------------------------------------------------------------------- | ---------- |
| The slot is on the pre-show                                                  | Pre-show   |
| Last slot of the main card                                                   | Main event |
| The slot before the main event, on a card of `match.slot.semiMainFromSlots`+ | Semi-main  |
| First slot of the main card                                                  | Opener     |
| Anything else                                                                | Midcard    |

So every main card has exactly one main event, its last slot. A 3-slot card
reads Opener, Midcard, Main event; a 6-slot card reads Opener, Midcard,
Midcard, Midcard, Semi-main, Main event. A slot outside the card throws a
`RangeError`; callers check their input first.

### Duration class

The role gives the base class: `match.slot.durationClass.<role>` for the
pre-show, opener, midcard and semi-main. The main event has no tunable: it is
always long ("D-10: the main event is always the long slot").

The segment's match type then moves the class by its `durationShift` (-1, 0 or
1), never past short or long. In the main event a downward shift is ignored
("Main event stays long"). A talking segment has no match type and is never
shifted. Trace lines read like "Midcard → Standard" and "Battle Royal pushes it
up a step → Long".

### Slot weight

The weight is the tunable `match.slot.weight.<role>`. For the main event it is
the larger of its own weight and every other role's weight ("The main event
never weighs less than another slot"), so no override can make another slot
heavier. A weight of 0 makes that role count for nothing. EVT3 and EVT4 use the
weight for the show score; the Match lab shows it as a chip.

### Tunables

Category `Match: slots`, in `systems/match/tunables.ts`:

| Key                                 | Kind    | Default  | Range               | Unit       |
| ----------------------------------- | ------- | -------- | ------------------- | ---------- |
| `match.slot.weight.preShow`         | number  | 0.4      | 0–5, step 0.05      | multiplier |
| `match.slot.weight.opener`          | number  | 0.9      | 0–5, step 0.05      | multiplier |
| `match.slot.weight.midcard`         | number  | 1        | 0–5, step 0.05      | multiplier |
| `match.slot.weight.semiMain`        | number  | 1.25     | 0–5, step 0.05      | multiplier |
| `match.slot.weight.mainEvent`       | number  | 1.75     | 0–5, step 0.05      | multiplier |
| `match.slot.durationClass.preShow`  | enum    | short    | short/standard/long | choice     |
| `match.slot.durationClass.opener`   | enum    | standard | short/standard/long | choice     |
| `match.slot.durationClass.midcard`  | enum    | standard | short/standard/long | choice     |
| `match.slot.durationClass.semiMain` | enum    | standard | short/standard/long | choice     |
| `match.slot.semiMainFromSlots`      | integer | 4        | 3–12                | count      |

### Worked example: a 6-slot show with one pre-show slot

Default tunables, with a sprint opening, a battle royal in slot 3 and a sprint
in the main event:

| Slot     | Segment      | Role       | Duration class                | Weight |
| -------- | ------------ | ---------- | ----------------------------- | ------ |
| Pre-show | Promo        | Pre-show   | Short (talking, no shift)     | 0.4    |
| 1        | Sprint       | Opener     | Standard, pulled down → Short | 0.9    |
| 2        | Singles      | Midcard    | Standard                      | 1      |
| 3        | Battle Royal | Midcard    | Standard, pushed up → Long    | 1      |
| 4        | Tag Team     | Midcard    | Standard                      | 1      |
| 5        | Singles      | Semi-main  | Standard                      | 1.25   |
| 6        | Sprint       | Main event | Long (main event stays long)  | 1.75   |

Override `match.slot.weight.mainEvent` to 0.5 and the main event still weighs
1.25, the semi-main's weight.

## Queries

Both are open to every viewer and return plain JSON.

- **`match.catalog`** `{ includeHidden? }` → `{ matchTypes, angleTypes,
methods, available }`. The options are the catalog entries in display order
  (hidden ones only when asked), with key, name, short name (the name when the
  entry has none), order, side and size limits, `durationShift`,
  `allowsTitles` and, for methods, `changesTitles`. On a world with no match
  types (a save from before catalogs) every list is empty and `available` is
  false, so a screen can say why.
- **`match.slotRoles`** `{ slots: 3–12, preShowSlots: 0–3, matchTypeKeys? }` →
  one row per slot, pre-show first: `{ slot, preShow, role, roleLabel,
durationClass, durationLabel, weight, roleTrace, durationTrace, weightTrace }`.
  `matchTypeKeys` has one entry per slot (null for a talking segment or an empty
  slot). An unknown key comes back as an `invalidArgs` reason naming its index,
  such as `matchTypeKeys[2]`. The card builder (EVT2) calls this after every
  reorder instead of working roles out itself.

## Worker performance

`systems/match/formulas/workerPerformance.ts`:
`workerPerformance(inputs, { tunables })` → `Traced<number>`, 0–100. How well
one worker performs tonight on one axis. The rater (MTCH1-05) reads the person
and passes plain values in; the formula never reads the world. The trace is
titled "<name>: <axis>", such as "Kade Morrow: In-ring".

In words:

1. **Weighted mean** of the axis's attributes: `Σ(weight × attribute) ÷ Σ
weight`. A weight of 0 leaves its attribute out; when every weight is 0 the
   mean is 0, with the note "All weights are 0".
   - **In-ring**: ringwork, psychology, athleticism and safety, weighted by the
     `match.perf.inRing.*` tunables.
   - **Entertainment**: charisma, presence and mic, weighted by
     `match.perf.entertainment.*`.
   - **Talk**: mic, charisma and presence, weighted by the angle type's
     `speakerWeights` from the catalog. These are not tunables; each line says
     "Weight set by <angle type>".
2. **Style** (in-ring only): `+ match.perf.styleAffinityBonus` when the worker's
   style is in the match type's `styleAffinity` ("Suits this match type");
   `− match.perf.nonWrestlerPenalty` for the `nonWrestler` style.
3. **Fatigue** (in-ring and entertainment): `− fatigue ×
match.perf.fatiguePenaltyPerPoint`.
4. **Working hurt** (in-ring only): `− match.perf.injuredPenalty` when the
   worker is injured. In MTCH1 that is a plain flag the rater works out from the
   stored injury.
5. Kept between 0 and 100. Not rounded.

Popularity, momentum, morale and chemistry are not here. Popularity and
momentum belong to the crowd side (D-02); the rest are later rating modifiers.

| Key                                 | Default | Range          | Unit   |
| ----------------------------------- | ------- | -------------- | ------ |
| `match.perf.inRing.ringwork`        | 0.5     | 0–1, step 0.05 | ratio  |
| `match.perf.inRing.psychology`      | 0.2     | 0–1, step 0.05 | ratio  |
| `match.perf.inRing.athleticism`     | 0.2     | 0–1, step 0.05 | ratio  |
| `match.perf.inRing.safety`          | 0.1     | 0–1, step 0.05 | ratio  |
| `match.perf.entertainment.charisma` | 0.5     | 0–1, step 0.05 | ratio  |
| `match.perf.entertainment.presence` | 0.3     | 0–1, step 0.05 | ratio  |
| `match.perf.entertainment.mic`      | 0.2     | 0–1, step 0.05 | ratio  |
| `match.perf.styleAffinityBonus`     | 3       | 0–50           | points |
| `match.perf.nonWrestlerPenalty`     | 20      | 0–50           | points |
| `match.perf.injuredPenalty`         | 25      | 0–50           | points |
| `match.perf.fatiguePenaltyPerPoint` | 0.15    | 0–1, step 0.05 | ratio  |

Category `Match: performance`. Every bonus and penalty at 0 turns that rule off.

### Worked example: in-ring

Ringwork 80, psychology 60, athleticism 70 and safety 50, rested and healthy,
in a match type that does not suit the style:

```
80 × 0.5 + 60 × 0.2 + 70 × 0.2 + 50 × 0.1 = 71, ÷ total weight 1 = 71
```

At fatigue 100 the same worker would lose `100 × 0.15 = 15`; working hurt
would cost another 25. (`workerPerformance.test.ts`: "is the weighted mean of
the in-ring attributes" and the fatigue and injury cases.)

## Sides

`systems/match/formulas/sideAggregate.ts`:
`sideAggregate({ label, members, decayKey }, { tunables })` → `Traced<number>`.
One number for a group from its members' numbers. Work rate uses it twice:
workers into a side (`match.side.depthDecay`), then sides into the match
(`match.sides.depthDecay`). MTCH1-04 adds `match.starPower.depthDecay` for star
power.

1. Rank the members by value, **numerically**, highest first; equal values by
   id, ascending. Never the default string sort, which would put 9 above 55.5.
2. Weights `w_i = decay^i` for rank i from 0, divided by their sum so they add
   up to 1 (`aggregateWeights(count, decay)`). Decay 0 counts only the best member
   (`0^0` is 1); decay 1 is a plain mean.
3. Result: `Σ value_i × w_i`. Each member is one line of the trace, such as
   "Kade Morrow (best on side) × 0.65" or "Side 2 (2nd side) × 0.41".

`aggregateWeights` throws a `RangeError` naming the input when `count` is not a
whole number of at least 1, when `decay` is not a number from 0 to 1, or when
the weights would not be finite or sum to 1 within 1e-9. An empty member list
throws too; the rater refuses an empty side before it gets here.

| Key                      | Default | Range          | Unit  |
| ------------------------ | ------- | -------------- | ----- |
| `match.side.depthDecay`  | 0.55    | 0–1, step 0.05 | ratio |
| `match.sides.depthDecay` | 0.7     | 0–1, step 0.05 | ratio |

Category `Match: performance`.

### Worked example: three workers on a side

Values 9, 100 and 55.5 at the default decay 0.55. Ranked: 100, 55.5, 9. Raw
weights 1, 0.55 and 0.3025 sum to 1.8525, so the weights are 0.54, 0.30 and
0.16:

```
100 × 0.5398 + 55.5 × 0.2969 + 9 × 0.1633 = 71.93
```

(`sideAggregate.test.ts`: "ranks numerically, never by string".)

## Work rate

`systems/match/formulas/workRate.ts`:
`workRate(inputs, { tunables, rng? })` → `Traced<number>`, at least 0. The
in-ring half of a match rating. D-10: a main event is a real test of stamina
and psychology; an opener isn't. So every check is keyed by the slot's
duration class (short, standard or long), never by minutes.

Inputs: the duration class and its label ("Main event (long)"), the sides with
each worker's in-ring performance and stamina, the worker count, the match
leader (highest psychology, ties by id; `matchLeaderOf` picks one) and the
match type's name and `workRateFactor`.

1. **Stamina check**, per worker:
   `need = staminaNeed.<class> × (2 ÷ max(2, workerCount)) ^ sharedLoadExponent`.
   The need is set for a singles match; in bigger matches people share the
   load (exponent 0 means everyone carries the full need). The worker loses
   `max(0, need − stamina) × staminaPenaltyPerPoint`. The line reads
   "Main event (long): stamina check failed for Kade Morrow, −6" or "...
   passed for Kade Morrow".
2. **Sides**: the side aggregate per side with `match.side.depthDecay`, then
   across the sides with `match.sides.depthDecay`.
3. **Psychology check** on the leader: lose `max(0, psychologyNeed.<class> −
leader psychology) × psychologyPenaltyPerPoint`, with the line "Nobody to
   lead a long match: best psychology 52 (Kade Morrow), needs 70" (or "Kade
   Morrow can lead a long match: ...").
4. **Showcase spread**, how much a great or terrible match can show:
   `50 + (value − 50) × spread.<class>`. Long matches stretch further from 50,
   short ones less.
5. **Match type**: `× workRateFactor`, a catalog constant labelled with the
   match type.
6. **Variance**: with an rng (the rater passes `match.rating`),
   `+ rollNormal(0, varianceSd)`, "Night-to-night variance". Without one the
   trace says "No variance roll". At sd 0 the roll is 0, so the value matches
   the no-rng value.
7. **At least 0.** There is no upper clamp here: MTCH1-04's soft compression and
   the rater's clamp finish it.

Popularity and momentum never enter work rate (D-02). Morale, chemistry, crew,
finishes, gimmicks and stipulations plug in later as rating modifiers.

| Key                                        | Default | Range          | Unit       |
| ------------------------------------------ | ------- | -------------- | ---------- |
| `match.workRate.staminaNeed.short`         | 0       | 0–100          | points     |
| `match.workRate.staminaNeed.standard`      | 40      | 0–100          | points     |
| `match.workRate.staminaNeed.long`          | 65      | 0–100          | points     |
| `match.workRate.sharedLoadExponent`        | 0.5     | 0–2, step 0.05 | ratio      |
| `match.workRate.staminaPenaltyPerPoint`    | 0.4     | 0–2, step 0.05 | ratio      |
| `match.workRate.psychologyNeed.short`      | 20      | 0–100          | points     |
| `match.workRate.psychologyNeed.standard`   | 45      | 0–100          | points     |
| `match.workRate.psychologyNeed.long`       | 70      | 0–100          | points     |
| `match.workRate.psychologyPenaltyPerPoint` | 0.5     | 0–2, step 0.05 | ratio      |
| `match.workRate.spread.short`              | 0.8     | 0–2, step 0.05 | multiplier |
| `match.workRate.spread.standard`           | 1       | 0–2, step 0.05 | multiplier |
| `match.workRate.spread.long`               | 1.15    | 0–2, step 0.05 | multiplier |
| `match.workRate.varianceSd`                | 4       | 0–20, step 0.5 | points     |

Category `Match: work rate`. Every number here is a first pass, to be tuned
with the Match lab's Run x100 (MTCH1-07). A penalty rate of 0 turns its check
off; a spread of 0 makes every match of that class a 50.

### Worked example: two 70s, midcard then main event

Two workers with every in-ring attribute at 70 (performance 70 each), stamina
70, leader psychology 70, a Singles match (factor 1), no variance roll.

- **Midcard (standard)**: need `40 × (2 ÷ 2)^0.5 = 40`, both pass. Each side
  is 70, across sides 70. The leader needs 45 and has 70. Spread
  `50 + 20 × 1 = 70`. **Work rate 70.**
- **Main event (long)**, stamina 50 instead: need 65, each is 15 short and
  loses `15 × 0.4 = 6`, so each side is 64. The leader needs 70 and has 70.
  Spread `50 + 14 × 1.15 = 66.1`. **Work rate 66.1.**

With psychology 52 the leader would be 18 short and cost `18 × 0.5 = 9`. In a
tag match of four, the need falls to `65 × (2 ÷ 4)^0.5 ≈ 46`. (`workRate.test.ts`:
"worked examples", "costs 9 when the leader has 52", "shares the load between
four workers".)

## Star power

`systems/match/formulas/starPower.ts`:
`starPower({ regionName, members }, { tunables })` → `Traced<number>`, 0–100,
titled "Star power in <region>". How much drawing power the people in a segment
bring in the show's region. D-02: popularity enters a rating **once**, here,
and star power then feeds both what the crowd thinks was delivered and what it
expected. Each member's `popularity` is their `regionalPop[regionId]` for the
show's region, 0 when they have none there (D-03).

1. **Aggregate** everyone in the segment, across every side, with the side
   aggregate and `match.starPower.depthDecay`: the biggest star counts most
   ("Kade Morrow (best draw) × 0.67", "Rex Vallor (2nd draw) × 0.33").
2. **Diminishing returns**: `sp = agg × (1 + curve × (100 − agg) ÷ 100)`.
   Curve 0 is plain popularity; at the default 0.8, 50 → 70, 80 → 92.8 and
   100 → 100, so a midcarder gains a lot from a bump in popularity and a top
   star very little.
3. Kept between 0 and 100.

| Key                          | Default | Range          | Unit  |
| ---------------------------- | ------- | -------------- | ----- |
| `match.starPower.depthDecay` | 0.5     | 0–1, step 0.05 | ratio |
| `match.starPower.curve`      | 0.8     | 0–1, step 0.05 | ratio |

Category `Match: crowd`.

### Worked example: a 90 and a 30

Ranked 90 then 30; weights 1 and 0.5 shared to 0.67 and 0.33, so the aggregate
is `90 × 2/3 + 30 × 1/3 = 70`. Bent: `70 × (1 + 0.8 × 30 ÷ 100) = 86.8`.
(`starPower.test.ts`: "weights the biggest star most" and "bends 50 to 70".)

## Crowd and expectation (D-02)

A crowd judges a segment against what it **expects** from those workers in that
slot, not mostly by how popular they are
([D-02](design-decisions.md#d-02-crowds-react-to-expectation-popularity-drives-money-hype-links-them-2026-11-07)). Two formulas do that: one for the expectation,
one for the reaction.

### Expectation

`systems/match/formulas/crowdExpectation.ts`:
`crowdExpectation(inputs, { tunables })` → `Traced<number>`, 0–100, titled
"Expected". Inputs: the segment's star power, the mean of the participants'
employment momentum with the promoting promotion (−100..100, a null momentum
counts as 0), the slot role and its label, the event's importance and whether
the show is televised.

```
expected = base + starPower × starWeight + momentum × momentumWeight
         + slot.<role> + importance.<importance> + (televised ? televised : 0)
```

kept between 0 and 100. Each term is exactly one line: "Base expectation +25",
"Star power 92.8 × 0.5", "Momentum +0 × 0.1", "Card position: Main event +8",
"Event size: Regular +0" and "On TV +2" (or "Not on TV +0"). Star power is one
flat line here; its own story is shown where it is delivered.

### Crowd score

`systems/match/formulas/crowdScore.ts`:
`crowdScore(inputs, { tunables, rng? })` → `Traced<number>`, at least 0,
titled "Crowd". Inputs: the performance (work rate for a match, talk for a
talking segment) and its label, the side-aggregated entertainment axis, star
power, the expectation, and the match or angle type's `crowdFactor` and name.

1. **Delivered**: `(performance × performanceWeight + entertainment ×
entertainmentWeight + starPower × starWeight) ÷ the sum of the three
weights`. When the weights add up to 0, delivered is 0 with the note "All
   crowd weights are 0". The line reads "Delivered 69.91".
2. **Surprise**: `(delivered − expected) × surpriseWeight`, read as "Below
   expectation −5.74", "Above expectation +5" or "Met expectation +0". Inside
   it are the lines "Delivered 69.91" and "Expected 81.4", so the "Why?" panel
   reads delivered against expected.
3. **Type**: `× crowdFactor`, labelled "<type> crowd factor".
4. **Variance**: with an rng (`match.rating`), `+ rollNormal(0, varianceSd)`,
   "Crowd on the night"; without one the note "No variance roll".
5. **At least 0.** Soft compression and the final clamp happen in the rater.

Popularity appears in a rating twice and only twice: through star power in
delivered, and through star power in the expectation. A hot act that
underdelivers therefore gets a flat reaction, and an unknown who overdelivers
gets noticed. The performance is read as one flat line ("Work rate 66.1"):
work rate has its own section and its trace is too deep to nest.

| Key                                     | Default | Range          | Unit   |
| --------------------------------------- | ------- | -------------- | ------ |
| `match.expectation.base`                | 25      | 0–100          | points |
| `match.expectation.starWeight`          | 0.5     | 0–1, step 0.05 | ratio  |
| `match.expectation.momentumWeight`      | 0.1     | 0–1, step 0.05 | ratio  |
| `match.expectation.slot.preShow`        | −8      | −30–30         | points |
| `match.expectation.slot.opener`         | −3      | −30–30         | points |
| `match.expectation.slot.midcard`        | 0       | −30–30         | points |
| `match.expectation.slot.semiMain`       | 4       | −30–30         | points |
| `match.expectation.slot.mainEvent`      | 8       | −30–30         | points |
| `match.expectation.importance.house`    | −6      | −30–30         | points |
| `match.expectation.importance.minor`    | −3      | −30–30         | points |
| `match.expectation.importance.regular`  | 0       | −30–30         | points |
| `match.expectation.importance.major`    | 4       | −30–30         | points |
| `match.expectation.importance.flagship` | 8       | −30–30         | points |
| `match.expectation.televised`           | 2       | −30–30         | points |
| `match.crowd.performanceWeight`         | 0.55    | 0–1, step 0.05 | ratio  |
| `match.crowd.entertainmentWeight`       | 0.25    | 0–1, step 0.05 | ratio  |
| `match.crowd.starWeight`                | 0.2     | 0–1, step 0.05 | ratio  |
| `match.crowd.surpriseWeight`            | 0.5     | 0–1, step 0.05 | ratio  |
| `match.crowd.varianceSd`                | 3       | 0–20, step 0.5 | points |

Category `Match: crowd`. Surprise weight 0 ignores expectation altogether.
Hype (ECO3), storyline heat and title stakes (MTCH8) and finishes (MTCH2) will
arrive as rating modifiers; nothing here assumes them.

### Worked example: the same two stars, opener and main event

Two workers with popularity 80 each: star power `80 × (1 + 0.8 × 0.2) = 92.8`.
Momentum 0, a regular televised show.

- **Opener**: `25 + 92.8 × 0.5 + 0 − 3 + 0 + 2 = 70.4`.
- **Main event**: `25 + 46.4 + 0 + 8 + 0 + 2 = 81.4`, **11 points higher** for
  the same two workers. That is D-02 at work.

They deliver a work rate of 66.1 (the long match above) with entertainment 60:
`66.1 × 0.55 + 60 × 0.25 + 92.8 × 0.2 = 69.915`.

- In the main event: `(69.915 − 81.4) × 0.5 = −5.74`, crowd **64.17**.
- As the opener: `(69.915 − 70.4) × 0.5 = −0.24`, crowd **69.67**.

(`crowdExpectation.test.ts`: "expects 11 points more of the same two stars in
the main event"; `crowdScore.test.ts`: "reads delivered, expected and the
surprise as separate lines" and "reacts better to the same match as an
opener".)

## Soft compression

`systems/match/formulas/softCompression.ts`:
`softCompression({ value, label }, { tunables })` → `Traced<number>`, 0–100.
Values near the top of the scale are squeezed instead of re-rolled:

```
value > knee ? knee + (value − knee) × factor : value
```

then at most 100 and at least 0. A branch node "Above the knee at 85" says
whether the knee was crossed. Nothing here is random, and how far above the
knee a value was still matters: a 120 still beats a 95. The rater compresses
work rate (or talk) and the crowd before the final clamp.

When the value's trace is a formula (work rate, the crowd), the compression
steps continue that formula under the new title instead of wrapping it, so a
work rate trace already at the depth limit loses nothing.

| Key                        | Default | Range          | Unit   |
| -------------------------- | ------- | -------------- | ------ |
| `match.compression.knee`   | 85      | 50–100         | points |
| `match.compression.factor` | 0.4     | 0–1, step 0.05 | ratio  |

Category `Match: scoring`. Factor 0 flattens everything above the knee to the
knee; knee 100 turns compression off inside the scale.

### Worked example

At the defaults, 85 stays 85, `95 → 85 + 10 × 0.4 = 89` and
`120 → 85 + 35 × 0.4 = 99`. (`softCompression.test.ts`: "maps 95 to 89 and
120 to 99 at the defaults".)

## Segment score

`systems/match/formulas/segmentScore.ts`:
`segmentScore(inputs, { tunables })` → `Traced<number>`, a whole number 0–100,
titled "Segment score". The number a segment adds to the show.

```
score = performance × share + crowd × (1 − share) + policyBonus
```

rounded to the nearest whole number and kept between 0 and 100. For a match the
share is `match.blend.workRateShare.<promotion style>`: a technical promotion
leans on work rate, an entertainment one on the crowd. A talking segment uses
`match.angle.talkShare` whatever the style. The policy line reads "Same rules
for every promotion +0" until a promotion's policies can change a score; a
provider passes its own label and traced bonus. Performance and crowd are each
one flat line, as they have their own sections.

| Key                                       | Default | Range          | Unit  |
| ----------------------------------------- | ------- | -------------- | ----- |
| `match.blend.workRateShare.mainstream`    | 0.45    | 0–1, step 0.05 | ratio |
| `match.blend.workRateShare.traditional`   | 0.5     | 0–1, step 0.05 | ratio |
| `match.blend.workRateShare.technical`     | 0.65    | 0–1, step 0.05 | ratio |
| `match.blend.workRateShare.hardHitting`   | 0.6     | 0–1, step 0.05 | ratio |
| `match.blend.workRateShare.hardcore`      | 0.5     | 0–1, step 0.05 | ratio |
| `match.blend.workRateShare.highFlying`    | 0.6     | 0–1, step 0.05 | ratio |
| `match.blend.workRateShare.entertainment` | 0.3     | 0–1, step 0.05 | ratio |

Category `Match: scoring`. `match.angle.talkShare` is listed under
[Talking segments](#talking-segments-simple).

### Worked example

The main event above at a mainstream promotion: `66.1 × 0.45 + 64.17 × 0.55 =
65.04`, **65**. (`segmentScore.test.ts`: "blends work rate and crowd at a
mainstream promotion and rounds".)

## Star ratings

`systems/match/formulas/starRating.ts`:
`starRating({ kind, performance, crowd, durationClass, durationLabel }, { tunables })`
→ `Traced<number>` in unit `stars`, 0–5 in quarter steps (the segment schema's
rule), titled "Stars".

1. **Blend**: `base = performance × performanceShare + crowd × (1 −
performanceShare)`, lines "Work rate × 0.7" and "Crowd × 0.3" ("Talk × 0.7"
   for a talking segment). Stars lean on the performance but not entirely, so a
   great match in front of a dead crowd rates well but not perfectly.
2. **Scale**: `(base − zeroAt) ÷ pointsPerStar`. When `pointsPerStar` is 0, a
   base above `zeroAt` gets the cap and anything else 0, with the note "Points
   per star is 0".
3. **Cap** by duration class: `match.stars.cap.<class>` for a match,
   `match.stars.cap.angle` for a talking segment, with the line "Midcard
   (standard): at most 4.75 stars". Kept between 0 and the cap.
4. **Nearest quarter star**: `× 4`, round, `÷ 4`.

| Key                            | Default | Range          | Unit   |
| ------------------------------ | ------- | -------------- | ------ |
| `match.stars.performanceShare` | 0.7     | 0–1, step 0.05 | ratio  |
| `match.stars.zeroAt`           | 35      | 0–80           | points |
| `match.stars.pointsPerStar`    | 12      | 0–30, step 0.5 | points |
| `match.stars.cap.short`        | 3.5     | 0–5, step 0.25 | stars  |
| `match.stars.cap.standard`     | 4.75    | 0–5, step 0.25 | stars  |
| `match.stars.cap.long`         | 5       | 0–5, step 0.25 | stars  |
| `match.stars.cap.angle`        | 4       | 0–5, step 0.25 | stars  |

Category `Match: stars`. `stars` is a tunable unit as well as a trace unit.

### Worked example

The main event above: `66.1 × 0.7 + 64.17 × 0.3 = 65.52`, `(65.52 − 35) ÷ 12
= 2.54`, **2.5 stars**. A base of 35 is 0 stars; a base of 95 is `60 ÷ 12 = 5`
stars in a long match, but 4.75 in a standard one and 3.5 in a short one.
(`starRating.test.ts`: "names the blend and rounds to the nearest quarter
star" and "gives base 95 five stars long".)

## Talking segments (simple)

`systems/match/formulas/speakerScore.ts`:
`speakerScore({ angleType, sides }, { tunables, rng? })` → `Traced<number>`,
0–100, titled "Talk: <angle type>". A talking segment has no work rate; this
**talk** value takes its place in the crowd score, the segment score and the
stars (the Match lab shows "Talk" instead of "Work rate"). MTCH5's beat scores
replace it behind the same rater.

1. Each speaker's talk is `workerPerformance` on the talk axis with the angle
   type's speaker weights (a note names them).
2. The side aggregate per side (`match.side.depthDecay`), then across sides
   (`match.sides.depthDecay`), as in work rate.
3. **Variance**: with an rng, `+ rollNormal(0, match.angle.varianceSd)`, "How
   the promo landed"; without one the note "No variance roll".
4. Kept between 0 and 100.

| Key                      | Default | Range          | Unit   |
| ------------------------ | ------- | -------------- | ------ |
| `match.angle.talkShare`  | 0.35    | 0–1, step 0.05 | ratio  |
| `match.angle.varianceSd` | 4       | 0–20, step 0.5 | points |

Category `Match: talking segments`. `talkShare` is the share of talk in a
talking segment's [segment score](#segment-score).

### Worked example

One speaker with talk 72 scores 72. Two speakers on side 1 with 80 and 40 make
`80 × 0.65 + 40 × 0.35 = 65.81`; against a side of 50 the segment's talk is
`65.81 × 0.59 + 50 × 0.41 = 59.3`. (`speakerScore.test.ts`: "equals the
speaker's talk with one speaker" and "side-aggregates each side, then across
sides".)

All numbers in these sections are a first pass, to be tuned with the Match
lab's Run x100 (MTCH1-07); any change is recorded here. Three choices are
deliberate: the crowd is driven by expectation rather than popularity, high
scores are compressed rather than re-rolled, and stars blend work rate with the
crowd rather than reading match quality alone.

## Pipeline and seams

`systems/match/rating/` turns the formulas above into one pipeline that every
later feature plugs into instead of editing. One entry point rates a segment
from plain input:

```ts
rateSegment(input, { read, tunables, mode?, seed?, rng? })
  → { ok: true, data: SegmentRatingResult } | { ok: false, reasons }
```

`input` is a `SegmentRatingInput`: the kind (`match` or `angle`), the match or
angle type key, the sides (stored 0-based side numbers and person ids), the
slot (a role given outright, as the Match lab does, or a slot position on a
card), the show (importance, region, televised, date) and the promotion running
it. It is an object so later features add optional fields (MTCH2's resolution,
MTCH8's titles, storylines and crew) without breaking callers.

The result is plain JSON: the score (whole, 0–100), the stars (quarter steps,
0–5), work rate (null for a talking segment) or talk (null for a match), crowd,
expectation and star power, each with its trace; the slot's role, duration
class and weight with their rules; one line per worker; the warnings; and the
policy used. `rateSegment` never writes and never touches the world's RNG: the
only stream it rolls on is the one passed in (a detached one in the lab, the
world's `match.rating` stream when EVT3 runs a show). Without one the traces
say "No variance roll".

It refuses, with a reason the player can read, an unknown kind or type key
(`unknownType`), no sides or a side with nobody on it (`emptySide`), a person
the world does not have (`unknownPerson`), a side number outside 0–29 or listed
twice (`invalidSide`), a slot past the end of the card (`invalidSlot`) and an
unknown promotion (`unknownPromotion`). Anything that can still be rated, such
as a third side in a Singles match, is a [warning](#warnings) instead.

### Stages

Every number passes through a **stage**. A stage continues the formula's own
trace (it adds no level, so the deep work rate trace stays inside the limit),
runs the rating modifiers registered for it, then finishes:

```
per worker   workerPerformance ─► performance ─┐   (in-ring + entertainment, or talk + entertainment)
per side     sideAggregate     ─► side ────────┤
match        workRate          ─► workRate ────┤   soft compression
angle        speakerScore      ─► talk ────────┤   soft compression
             starPower, crowdExpectation ─► expectation   kept 0–100
             crowdScore                  ─► crowd         soft compression (0–100)
             segmentScore + policy bonus ─► score         rounded, kept 0–100
             starRating                  ─► stars         to the cap, quarter steps
```

The work rate, talk and crowd stages always end in
[soft compression](#soft-compression). The formulas already finish the other
values themselves, so the expectation (0–100), score (rounded, 0–100), a
performance (0–100) and the stars (their cap, quarter steps) are finished again
only when a modifier ran; an untouched trace gains no lines.

The score and stars traces carry two notes at the top, right after their
starting value: "<Role> (<duration class>)", such as "Main event (long)", and
"Slot weight ×1.75". The Why? panel therefore always shows the slot role and
duration class, and never minutes.

The built-in **match rater** gathers each worker's own inputs from the world
(attributes, style, fatigue, an injury not yet healed on the show date,
popularity in the show's region, momentum on an active contract with the
promotion, else 0 with "Not under contract here"; the name is the ring name
with that promotion). Every per-worker number comes from that worker's own row,
so no value can leak from one worker to the next. It picks the match leader by
psychology, passes the duration label and worker count to work rate and rolls on
the stream it was given. Entertainment is side-aggregated across everyone in the
segment. The built-in **angle rater** does the same with talk (the angle type's
speaker weights) in place of in-ring performance and `speakerScore` in place of
work rate; angle types have no crowd factor, so it is 1. An injured worker may
talk; [warnings](#warnings) flag one whose injury rules out talking segments.

### Rating modifiers

```ts
registerRatingModifier({ id, stage, order, detail?, applies, apply }) → unregister
```

- `id` is `system.camelName` (`mtch2.finishEffects`) and unique; a duplicate
  throws `RegistryError`.
- `stage` is one of `performance`, `side`, `workRate`, `talk`, `expectation`,
  `crowd`, `score` and `stars`.
- `order` is a whole number from 1 to 99. Lower runs first; equal orders run in
  id order, so packs built in parallel never collide. Use `RATING_ORDER`
  (`early` 10, `normal` 50, `late` 90) rather than guessing.
- `applies(ctx, subject?)` says whether the effect applies; `apply(calc, ctx,
subject?)` adds its steps to the stage's calc. On the `performance` stage the
  subject is the worker (`{ kind: 'worker', personId, side, axis }`), on the
  `side` stage the side (`{ kind: 'side', side, personIds }`).
- `detail: true` marks a booking detail the rival shortcut may skip (see the
  policy door below).

A modifier **may** add, subtract, multiply, clamp, note and branch through the
calc it is handed, read the context (`ctx.read`, `ctx.input`, `ctx.matchType`,
`ctx.angleType`, `ctx.role`, `ctx.durationClass`, `ctx.policy`, `ctx.tunables`)
and roll on `ctx.rng` when it is not null. It **may not** replace the value
wholesale (the calc has no "set"), write to the world, keep state between calls
or roll on any other stream. One effect is one labelled line, such as "Clean
finish +3" or "Tag team experience +2".

`ratingModifiersFor(stage)` lists a stage's modifiers in the order they run.

### Adding a rater

```ts
registerSegmentRater(kind, rater, { replace? }) → unregister
```

A rater is `(ctx: RatingContext) => SegmentRatingResult`. MTCH1 registers
`match` and the simple `angle` rater from `systems/match/index.ts` at module
load. Replacing a kind needs `{ replace: true }`, so MTCH5's beat-based angle
rater is an explicit swap; the function it returns restores the rater it
replaced. A rater should run its numbers through `runStage(stage, value, ctx,
subject?)` so modifiers reach it. `rateSegment` attaches the warnings, so a
rater returns `warnings: []`.

`RatingContext` is read-only: `mode` (`preview` or `live`), `seed`, `read`,
`date` (the show's), `tunables`, `input`, `segmentKind`, `matchType` or
`angleType`, `durationClass`, `role`, `slot` (with its traces), `policy` and
`rng` (or null).

Registries are module-level, like `registerSetupStep`: a feature registers from
its system module, so loading the system is enough. Tests that register extras
call `resetMatchRegistriesForTests()` in `afterEach`; it restores the two
built-in raters, no modifiers and no policy provider.

### The policy door (D-01)

[D-01](design-decisions.md#d-01-rival-promotions-use-simplified-rules-2026-11-07)
says rival shortcuts are named tunables, never an `if (isAI)` branch. The
rating's only door for them is the policy:

```ts
RatingPolicy = { scoreBonus: Traced<number>, simpleInputs, skipInMatchInjuries, label, lines }
registerRatingPolicyProvider((read, tunables, promotionId) => RatingPolicy, { id? }) → unregister
ratingPolicyFor(read, tunables, promotionId) → RatingPolicy
```

There is at most one provider; a second throws, naming the first. With none,
every promotion gets `NEUTRAL_RATING_POLICY`: a score bonus of 0 ("Same rules
for every promotion"), both flags false, label "Full rules". MTCH1 itself never
looks at who controls a promotion. AIP1 registers the provider that reads its
own tunables.

- `scoreBonus` is added to the segment score as one line, titled with the
  policy's first line ("Same rules for every promotion +0").
- `simpleInputs` skips every `detail: true` modifier, each with the note
  "Rival shortcut: simple booking inputs, <id> skipped".
- `skipInMatchInjuries` is carried for MTCH4, which reads it before rolling
  in-match injuries. MTCH1 does not use it.

### The stored-segment adapter

`ratingInputFromSegment(read, segmentId)` builds the input EVT3 rates a booked
segment with: the `segments` row's kind and match or angle type; its
participants (index `bySegment`; competitors for a match, speakers for an
angle) grouped by side, each side ordered by entrance order (unordered last)
then id; and its show's importance, region, date and promotion. The slot is the
stored 0-based slot plus 1, out of the show format's main-card slots (pre-show
slots count on their own); `televised` comes from the show's event definition,
false for a one-off. It throws `EntityNotFoundError` for a segment or show that
does not exist.

### Warnings

`segmentWarnings(input, read, catalogs, date)` returns the booking problems the
lab shows and EVT2's `booking.validate` reports, each `{ code, severity,
message, personId?, side? }`, errors first, then by side (whole-segment
warnings before side ones), then in the order found. `rateSegment` attaches
them to every result. A warning never stops a rating.

| Code              | Severity | Example                                                          |
| ----------------- | -------- | ---------------------------------------------------------------- |
| `sideCount`       | error    | "Three sides in a Singles match: it takes 2"                     |
| `sideSize`        | error    | "Side 2 has 2 people: Singles takes 1 a side"                    |
| `unequalSides`    | warning  | "The sides are uneven (2 against 1): Tag Team takes equal sides" |
| `duplicatePerson` | error    | "Kade Morrow is on both sides" / "is on side 1 twice"            |
| `injured`         | error    | "Kade Morrow is injured until 2026-05-01"                        |
| `inactive`        | error    | "Kade Morrow is on hiatus" (or retired, has died, has left)      |
| `nonWrestler`     | warning  | "Kade Morrow is not a wrestler" (matches only)                   |
| `speakerCount`    | warning  | "Five speakers in a Promo: it takes 1 to 4"                      |

Uneven sides are only reported when every side's size is allowed on its own. A
talking segment flags an injury only when the injury rules out talking
segments; semi-retired workers are not flagged.

### Adding a rating effect

The recipe MTCH2 (finishes), MTCH6 (chemistry and teamwork), MTCH7
(stipulations), MTCH8 (crew, title stakes, storyline heat), SOC3 (backstage
morale) and CRTV7 (gimmicks and managers) follow:

1. Pick the stage the effect belongs to: a worker's own night is
   `performance`, a team's is `side`, the match as a whole is `workRate` (or
   `talk`), what the crowd hoped for is `expectation`, how it reacted is
   `crowd`, and a flat change to the result is `score` or `stars`.
2. Add any numbers as tunables in your system's `tunables.ts`, never as
   literals.
3. From your system module, call `registerRatingModifier` with an id in your
   system's namespace, the stage, an order from `RATING_ORDER`, `applies`
   (read `ctx.input` and the world through `ctx.read`; add an optional field
   to `SegmentRatingInput` if the booking needs to carry something new) and
   `apply`, which adds one labelled line with `calc.add`, `calc.subtract` or
   `calc.multiply`, reading its tunable through `calc.tunable` so the line
   shows it.
4. Mark it `detail: true` if a rival on simple booking inputs should skip it.
5. Test that it appears as exactly one labelled line, moves the value by its
   amount and that the trace still replays; reset the registries in
   `afterEach`.
