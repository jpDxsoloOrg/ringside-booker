# Show night

What happens when a show's day comes: the card is run, every segment is rated,
the show gets a score, title matches are settled, and the shows system
announces what happened so later features (morale, popularity, money, news,
awards) can react. This is the EVT3 feature; its code lives in
`packages/engine/src/systems/shows/`.

EVT3-01 lays the groundwork: the save shape, the empty `shows` bundle, the
events, trace kinds, random stream and tunables. EVT3-02 adds the show score,
off-screen score and show stars formulas and the show score modifier seam. The sections marked
"filled by" are written by the slice that adds the code.

## Phase

Filled by EVT3-03. The `shows.runShows` phase runs each booked show on its
day and writes every segment's `rating` and `outcome` and the show's `result`.

## Show score

`systems/shows/formulas/showScore.ts`. The show score is a **slot-weighted
mean** of its segment scores, using the slot weights of
[match-rating.md](match-rating.md#slots). The shows phase (EVT3-03) hands in
one entry per main-card slot, filled or not, and one per filled pre-show slot,
each with its role, its traced `slotWeightOf` weight and its segment score.

For each filled slot _i_:

    counted weight_i = weight_i × (pre-show ? shows.score.preShowFactor : 1)
    contribution_i   = score_i × counted weight_i

Then:

    weighted mean = Σ contribution_i / Σ counted weight_i      (0 when Σ is 0)
    penalty       = shows.emptySlotPenalty × empty main-card slots
    raw score     = round(clamp(weighted mean − penalty + adjust lines, 0, 100))
    score         = round(clamp(raw score + cap lines, 0, 100))

The Why? panel reads like a producer's notes: one line per filled slot in card
order (pre-show first, then the main card), each labelled like
"Main event: 72 × 1.75", then "Divided by the total weight", then one
"Empty main-card slots (N)" line with every empty slot listed under it (no line
when nothing is empty), then the modifiers' lines. When no slot counts (nothing
filled, or every counted weight 0) the mean is 0 and the trace says "No slot
counts toward the score". Without `cap` modifiers the second clamp and round
are left out and `score` equals the raw score.

**Why slot weights and not "best segments".** The reference game's
aggregation (notes 02 §1) blends a show's best segments whatever their place
on the card, so a great opener carries a show as far as a great main event.
D-10 says a segment's slot decides how much it counts, so here the main event
is always the heaviest line (`slotWeightOf` never lets it weigh less than
another slot), a strong main event moves the score more than a strong opener,
and a card of segments that all score 60 scores 60 whatever the weights. The
reference's match-ratio penalty is not copied either; D-04's balance lines
arrive as `adjust` modifiers (see [Seams](#seams)).

The numbers it reads:

- `shows.score.preShowFactor` (default 0): how much pre-show segments count
  toward the show score. At 0 the pre-show never moves the score.
- `shows.emptySlotPenalty` (default 5): show score lost for each empty
  main-card slot. 0 means no penalty.
- `match.slot.weight.*`: each role's weight, through `slotWeightOf`.

The result keeps both `score` (final) and `rawScore` (before any `cap`-stage
modifier, such as EVT4's production ceiling; equal to `score` when no cap
applies). See [data-model.md](data-model.md#event-instances-eventinstances-evi_).

### Show stars

`systems/shows/formulas/showStars.ts`. MTCH1's `starRating` blends
performance and crowd for one segment, so it cannot take a show score; the
show has its own straight line:

    stars = clamp((score − shows.stars.zeroAt) / shows.stars.pointsPerStar, 0, 5)

rounded to the nearest quarter star (× 4, round, ÷ 4). At the defaults
(`zeroAt` 35, `pointsPerStar` 12) a score of 35 or less earns zero stars and 95
or more earns five. At `pointsPerStar` 0 any score above `zeroAt` earns 5 and
the trace says "Points per star is 0".

## Off-screen score

`systems/shows/formulas/offscreenShowScore.ts`. Rival shows need a score even
before AIP4 lets rivals book real cards. A computer-controlled show with no
card is scored without rating any segments, and its results page says the
card was not booked in detail:

    score = shows.offscreen.base
          + shows.offscreen.prestigeWeight × promotion prestige
          + shows.offscreen.popularityWeight × popularity in the show's region
          + shows.offscreen.importance.<importance>
          + swing,   swing rolled between −shows.offscreen.spread and +spread

then kept within 0..100 and rounded. The popularity is the promotion's
`regionalPop[show.regionId]`, 0 where it has none (the caller reads it). The
swing is drawn from the `shows.offscreen` stream, exactly once per show even at
spread 0 (the trace then says "No randomness (0)"), so changing a tunable never
shifts the stream. The trace is titled "Show score (card not booked in
detail)", with the lines "Promotion prestige", "Popularity in <region>",
"<Importance> show" and "Night-to-night swing".

This is a fallback for a computer show nobody booked, not a D-01 shortcut: it
applies whether or not "level playing field" is on, it never applies to a
human-controlled show, and it is fully traced (D-01: rival shows keep full
traces). Once AIP4 books rival cards it only covers a computer show AIP4 left
empty. Any rival-only rating edge stays in AIP1's `ai.*` tunables through
MTCH1's `RatingPolicy`, never here.

## Title outcomes

Filled by EVT3-04. A title match ends one of three ways for each title on the
line: the title changes hands (`title.changed`), the champion keeps it
(`title.defended`), or nothing happens (a no contest). A draw counts as a
successful defence while `shows.titles.drawCountsAsDefence` is on (the
default).

## Appearances

Filled by EVT3-03..05: who appeared on the show and in which segments.

## Events

Declared in `systems/shows/events.ts`. Payloads carry ids and primitives only;
see [day-pipeline.md](day-pipeline.md#adding-events-for-a-system) for the
table.

- `segment.completed`: one per segment, in card order. `winnerIds`, `loserIds`
  and `drawIds` list competitors only; a no contest and a talking segment have
  all three empty. `finishKey` stays null until MTCH2's finishes are wired in.
- `show.completed`: one per show, after its segments, with `score`,
  `rawScore` and whether it was scored off-screen.
- `title.changed` and `title.defended`: one per title on the line in a
  segment that settled it.

Traces (`systems/shows/traces.ts`), stored with `ctx.recordTrace`:

| Kind                      | Id                         | What it explains                                |
| ------------------------- | -------------------------- | ----------------------------------------------- |
| `shows.segmentScore`      | segment id                 | A segment's score on a human-controlled show    |
| `shows.rivalSegmentScore` | segment id                 | A segment's score on a computer-controlled show |
| `shows.showScore`         | event instance id          | A show's score                                  |
| `shows.titleOutcome`      | `${segmentId}\|${titleId}` | Why a title changed hands or was kept           |

Rival segments use their own kind so a busy rival schedule never pushes the
player's breakdowns out of `sim.traceRetentionPerKind`. A stored rating or
result keeps its trace's ref key (`refKey(ref)`) in `traceId`, and
`traceRefFromKey` turns it back into a ref.

## Seams

### Show score modifiers

`systems/shows/showScoreModifiers.ts`. Later features add lines to the show
score without editing the formula: D-04's card flow (EVT4), CRTV and BRW.

```ts
registerShowScoreModifier({
  id: 'evt.cardFlow', // system.camelName, unique
  stage: 'adjust', // or 'cap'
  order: 100, // within the stage; ties run by id
  gather: (read, show) => ({ repeats: countRepeatedMatchups(read, show) }),
  apply: (calc, inputs, extra, { tunables }) => {
    /* calc.subtract(...), calc.min(...), ... */
  },
});
```

- **Stages.** `adjust` modifiers run after the empty-slot penalty and before
  the raw score is kept within 0..100 and rounded, so their lines are part of
  `rawScore`. `cap` modifiers run after that, then the score is kept and
  rounded again. EVT4's production ceiling is a `cap` modifier (a
  `calc.min(...)` line), so the result keeps the raw score the card earned
  next to the score it was held to.
- **Order.** By stage (`adjust` first), then `order`, then id. A duplicate or
  malformed id, an unknown stage or a non-finite order throws a
  `RegistryError` at registration.
- **gather and apply.** `gather` runs in the shows phase and may read the
  world (for example EVT4's repeated matchups); its plain-JSON result goes in
  `inputs.extras[id]`. `apply` gets only the calc, the inputs, that extra and
  the tunables, so it stays pure and the show score's trace replays.
- `listShowScoreModifiers()` returns them in run order; the shows phase passes
  that list to `showScore`. `unregisterShowScoreModifier(id)` is for tests.

### Still to come

Filled by EVT3-03..04: EVT6's attendance and gate and ECO8's viewers.

The save break: EVT3-01 changed the segment rating and show result shapes, so
saves made before it fail to load with the "Made with an older build" message
and a new game is needed.
