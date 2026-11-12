# Show night

What happens when a show's day comes: the card is run, every segment is rated,
the show gets a score, title matches are settled, and the shows system
announces what happened so later features (morale, popularity, money, news,
awards) can react. This is the EVT3 feature; its code lives in
`packages/engine/src/systems/shows/`.

EVT3-01 lays the groundwork only: the save shape, the empty `shows` bundle,
the events, trace kinds, random stream and tunables. The sections marked
"filled by" are written by the slice that adds the code.

## Phase

Filled by EVT3-03. The `shows.runShows` phase runs each booked show on its
day and writes every segment's `rating` and `outcome` and the show's `result`.

## Show score

Filled by EVT3-02. The show score is a weighted blend of its segment scores,
using the slot weights of [match-rating.md](match-rating.md#slots). The
numbers it reads:

- `shows.score.preShowFactor` (default 0): how much pre-show segments count
  toward the show score. At 0 the pre-show never moves the score.
- `shows.emptySlotPenalty` (default 5): show score lost for each empty
  main-card slot.
- `shows.stars.zeroAt` (default 35) and `shows.stars.pointsPerStar`
  (default 12): how a show score turns into stars. A score at or below
  `zeroAt` earns zero stars; each `pointsPerStar` above it earns one more, up
  to 5. At `pointsPerStar` 0 any score above `zeroAt` earns 5.

The result keeps both `score` (final) and `rawScore` (before any `cap`-stage
modifier, such as EVT4's production ceiling; equal to `score` when no cap
applies). See [data-model.md](data-model.md#event-instances-eventinstances-evi_).

## Off-screen score

Filled by EVT3-04. A show nobody watches card by card (a rival's show the
player does not follow) is scored without rating its segments:

    score = base + prestigeWeight × prestige + popularityWeight × popularity
          + importance points + a roll between −spread and +spread

The roll draws from the `shows.offscreen` stream. The tunables are
`shows.offscreen.base`, `.prestigeWeight`, `.popularityWeight`,
`.importance.{house,minor,regular,major,flagship}` and `.spread`.

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

Filled by EVT3-02..04: the points later features hook into (the `cap` stage
for EVT4's production ceiling, EVT6's attendance and gate, ECO8's viewers).

The save break: EVT3-01 changed the segment rating and show result shapes, so
saves made before it fail to load with the "Made with an older build" message
and a new game is needed.
