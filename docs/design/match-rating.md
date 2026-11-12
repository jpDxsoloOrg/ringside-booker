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
