# Storylines

Storylines are the feuds and angles that tie segments together across shows.
The storylines system (`packages/engine/src/systems/storylines/`) is the one
place the rest of the engine and the Storylines desk read them from.

CRTV3-01 laid the ground: the two new fields, the read queries, the shared
engine reader, the read-side tunables, the trace kinds and the events. Later
tickets fill in the sections marked below: CRTV3-02 (starting heat, cooling,
starter storylines), CRTV3-03 (the player's commands), CRTV3-04 (the screen)
and CRTV4 (heat after segments, finales and the payoff).

| Piece       | Where             | What it does                                                                                        |
| ----------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| Tunables    | `tunables.ts`     | The read-side numbers, category `Storylines` ([Storyline tunables](tunables.md#storyline-tunables)) |
| Streams     | `streams.ts`      | None yet; CRTV3-02 declares the starter stream here                                                 |
| Events      | `events.ts`       | `storyline.started`, `storyline.ended`, `storyline.membersChanged`                                  |
| Trace kinds | `traceKinds.ts`   | `storylines.heat`, `storylines.starter`, `storylines.payoff`                                        |
| Formula     | `formulas/hot.ts` | `isHotHeat`: whether heat shows as Hot                                                              |
| Rows        | `rows.ts`         | `buildStorylineRow` and the viewer rules                                                            |
| Queries     | `queries.ts`      | `storylines.list`, `.detail`, `.forPerson`, `.memberOptions`                                        |
| Reader      | `context.ts`      | `storylineContextFor`, `storylinesOfPerson`, `activeStorylinesOf`                                   |

## What is stored and what is derived

A storyline row (see [data-model.md](data-model.md#storylines-storylines-sty_))
stores its promotion, an optional brand, a name, `active` or `ended` with
`startedOn` and `endedOn`, its heat (0 to 100), 1 to 12 members each on a side,
a summary, and since CRTV3-01:

- `lastProgressOn`: the last day a linked segment moved the story on. Null
  means never, so cooling counts from `startedOn`. It is never before
  `startedOn`.
- `finaleSegmentId`: the linked segment booked as the story's final match, or
  null. The finale must link the storyline (`finaleIsLinked`), and the weekly
  history roll-up never deletes it.

CRTV4 writes both fields. CRTV3 only stores and reads them; nothing else may
set them. Both default to null, so saves from before CRTV3-01 load unchanged.

Segments point at storylines through `segments.storylineIds` (index
`byStoryline`). Everything else is derived when read: the linked segment
count, days since the story last moved on, the Hot flag, the timeline and how
an ended storyline ended. The linked segments are the ones still kept: the
history roll-up deletes old segments past the detail window (see
[save-format.md](save-format.md#history-retention)), finales aside.

Storylines are ended, never deleted, because segments reference them.

### Sides and alignment

A member's side (`face`, `heel` or `neutral`) is their side in this story, not
their overall alignment. A face can be the heel of one story; the rows show
both, the side from the storyline and the alignment from the member's active
employment at the storyline's promotion.

A member who no longer has an active employment at the storyline's promotion
stays in the storyline and is shown with a warning (`stillEmployed: false`).
They are never removed automatically.

## Hot storylines

A storyline shows as Hot on the heat meter when its heat is at least
`storylines.heat.hotFrom` (70). This is display only. The story shield
(D-09, owned by WRK8; ECO4-03 reads `contracts.quit.storyShieldHeat` until
then) and the rival booker (`aip.card.storylineMinHeat`) keep their own heat
lines.

Owner rule D-09: losing inside a hot storyline doesn't hurt morale, and a
worker in a hot storyline never asks to leave or walks out. Nothing in CRTV3
changes morale.

## Starting heat

CRTV3-02. Every storyline starts through `startStoryline`
(`systems/storylines/lifecycle.ts`): the new-game starters below, CRTV3-03's
`storylines.create` and later AIP6's rival storylines, so starting heat is the
same whoever starts one. It creates the storyline (active, started today, no
progress, no finale), stores the heat's Why? as the storyline's
`storylines.heat` trace and publishes `storyline.started`.

The formula (`formulas/startingHeat.ts`), in plain words:

1. Start from the base starting heat (`storylines.heat.startBase`, 25). This
   is the first line of every starting-heat Why?.
2. Add star power: the average home popularity of the (up to) two best-known
   members, times `storylines.heat.startStarWeight` (0.25). Home popularity is
   the member's popularity in the promotion's home region (0 when they have
   none there). Only the best two count, so a big storyline is not hotter for
   having more people in it. With no members the star line is 0 ("No members
   yet"); with the weight at 0 there is no star line at all.
3. No higher than `storylines.heat.startMax` (60), kept within 0–100 and
   rounded to a whole number.

Two members at 60 and 40 at home: 25 + 0.25 × 50 = 37.5, so 38.

| Tunable                           | Default | Meaning                                                                      |
| --------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `storylines.heat.startBase`       | 25      | Heat every new storyline starts from                                         |
| `storylines.heat.startStarWeight` | 0.25    | Share of the best two members' average home popularity added. 0 turns it off |
| `storylines.heat.startMax`        | 60      | Highest starting heat                                                        |

## Heat decay

CRTV3-02. Heat never rises on its own: only CRTV4's linked segments raise it
(and set `lastProgressOn`, which restarts the grace period). When nothing
happens, it cools.

The daily phase `storylines.heatCooling` (`growth`, order 35, no random
numbers) looks at every active storyline in id order. Days since progress are
counted from `lastProgressOn`, or from `startedOn` when there is none. The
formula (`formulas/heatDecay.ts`), in plain words:

1. Start from yesterday's heat and note the days since progress and what they
   count from ("Started 2027-01-04", "Last linked segment 2027-02-10").
2. Inside the grace period (days since progress at most
   `storylines.heat.decayGraceDays`, 7): no change.
3. Already at or below the floor (`storylines.heat.decayFloor`, 10): no
   change. Cooling never raises heat, so a storyline that starts below the
   floor stays where it is.
4. Otherwise take off `storylines.heat.decayPerDay` (1), no lower than the
   floor, kept within 0–100, with a note of how many days it has been cooling.

So with the defaults a storyline started on day 0 keeps its heat through day
7 and loses 1 a day from day 8: heat 40 is 33 on day 14, and 10 from day 37
on. `decayPerDay` 0 stops cooling.

| Tunable                          | Default | Meaning                                                           |
| -------------------------------- | ------- | ----------------------------------------------------------------- |
| `storylines.heat.decayGraceDays` | 7       | Days without progress before heat starts cooling                  |
| `storylines.heat.decayPerDay`    | 1       | Heat lost each day after the grace period. 0 means it never cools |
| `storylines.heat.decayFloor`     | 10      | Cooling never takes heat below this                               |

`growth` (700) runs after `shows` (500) and `settlement` (600), so a storyline
a segment moves on today never cools on the same day.

A storyline whose heat does not change gets no new trace, so its Why? stays
the latest change: the starting heat or the last cooling step. The phase skips
storylines inside the grace period or on the floor before building a trace,
so a quiet day costs one pass over the storylines. Every storyline in the
world cools every day, so a rival's heat Why? is kept as a summary only (the
player's stay in full). The weekly `storylines.pruneDetail` (`periodic`, order
46, Mondays) turns the heat and starter Why?s of storylines that ended more
than `history.keepDetailDays` ago into summaries; an active storyline keeps
its Why?, because it explains today's heat.

`storylines.detail` gives an active storyline of the viewer's own promotion a
`cooling` block: `graceDays`, `daysSinceProgress`, `perDay`, `floor`,
`coolingNow` (the next day simulated lowers heat) and `startsInDays` (days
until the first day that cools if nothing happens; null when already cooling,
on the floor or with cooling off), so the screen can say "Cools from day 8
without progress" or "Cooling 1 per day". It is null for ended and rival
storylines.

## Starters

CRTV3-02. New-game setup step `storylines.seedStarters` (order 880, see
[new-game.md](new-game.md#setup-steps)) gives every active promotion, in id
order, up to `storylines.starterPerPromotion` (2) starter storylines, so the
Storylines desk has something to show on a fresh game. 0 creates none (the
step logs "Starter storylines turned off").

- **Pool.** Active wrestlers under an active contract with the promotion,
  face or heel (tweeners sit out), who are active and not injured. They are
  ranked by push (main event first), then popularity in the promotion's home
  region, then id.
- **Gender.** Each starter is a face and a heel of the same gender: the group
  with the most face and heel pairs left, ties to the group holding the
  best-ranked worker. Picked again for each starter, so a promotion with both
  men's and women's pairs usually gets one of each.
- **Picks.** The face is rolled among the top 3 unused faces, then the heel
  among the top 3 unused heels (stream `storylines.starters`, two draws per
  starter). Nobody is in two starters. When no pair is left the step stops
  early with a log line.
- **The storyline.** Named "<face> vs. <heel>" (ring names), summary "A
  rivalry already simmering when the season began.", the brand both
  employments share (else none), started through `startStoryline` with source
  `setup`.
- **Why it started.** A "Starter storyline" decision trace lists each gender's
  pool size and pairs, the gender rule, the top 3 on each side and both rolls.
  It is stored as `storylines.starter` under the storyline's id (a summary
  only for a rival's) and served by `storylines.detail` as
  `startedBecauseTraceRef` (null for any storyline that was not a starter).

On the default world every one of the twelve promotions gets two starters,
with starting heat around 26 to 43, well below the Hot line (70), the story
shield (`contracts.quit.storyShieldHeat`, 70) and so on: starters do not
shield anyone's morale at the start. Rivals book them on their cards
(`aip.card.storylineMinHeat` is 0).

Dated note (CRTV3-02, Sprint 11): starters exist only in games started after
this step was added. Older saves keep the storylines they have; nothing adds
starters to a game already under way, and rivals start no new storylines
later (that is AIP6).

## Commands

CRTV3-03. Creating, editing and ending storylines. Creating one more than
`storylines.activeSoftLimit` (6) active storylines shows a warning; 0 never
warns. `storylines.memberOptions` lists the people who may join.

## Payoff threshold

CRTV4 pays a storyline off when it ends. A storyline needs at least
`storylines.payoff.minSegments` (4) linked segments for that; 0 means any
storyline can. Until CRTV4 is on main, `storylines.detail` only says why an
ended storyline had no payoff:

- `paid`: a `storylines.payoff` trace exists for it;
- `tooFew`: fewer linked segments than the threshold;
- `notAvailable`: enough segments, but there is no payoff yet.

## Context

`storylineContextFor(read, storylineId, date)` is the shared engine-side
reader. WRK8 (the story shield), CRTV4 (heat after segments, the payoff) and
AIP4 (rival cards) read it instead of each writing its own reader. It returns
null for an unknown id, otherwise:

| Field               | What                                              |
| ------------------- | ------------------------------------------------- |
| `storylineId`       | The id                                            |
| `promotionId`       | Its promotion                                     |
| `brandId`           | Its brand, or null                                |
| `name`, `status`    | As stored                                         |
| `heat`              | 0 to 100                                          |
| `startedOn`         | As stored                                         |
| `lastProgressOn`    | As stored, or null                                |
| `daysSinceProgress` | Days from `lastProgressOn ?? startedOn` to `date` |
| `members`           | In stored order, with their sides                 |
| `linkedSegmentIds`  | The kept segments that link it, in id order       |
| `finaleSegmentId`   | The finale, or null                               |

`storylinesOfPerson(read, personId, { status? })` lists the storylines a person
is in, in every promotion (every status unless `status` is given), and
`activeStorylinesOf(read, promotionId)` a promotion's active ones. Both are in
id order.

None of these filter by viewer. They are for engine code only; a query that
shows storylines to a player must scope them by the rules below.

## Viewer rules

- A viewer who runs the storyline's promotion, or the omniscient viewer, gets
  the full row.
- Anyone else gets the public row: name, status, dates, brand and members with
  their sides. `heat`, `isHot`, `heatTraceRef`, `linkedSegmentCount`,
  `lastProgressOn` and `daysSinceProgress` are null and `editable` is false.
  `storylines.detail` gives them no summary, an empty timeline and no ending.
- `editable` is true only for an active storyline of a promotion the viewer
  runs. The omniscient viewer sees everything and edits nothing.
- `storylines.memberOptions` is refused with `storylines.notYours` for a
  promotion the viewer does not run.

The queries:

| Query                      | Args                          | Returns                                                                                                                                                              |
| -------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storylines.list`          | `{ promotionId?, status? }`   | `{ promotionId, rows, activeCount, softLimit, hotFrom, editable }`; default the viewer's first promotion and `active`; refused `storylines.noPromotion` with neither |
| `storylines.detail`        | `{ storylineId }`             | The row plus `summary`, `timeline` and `ending`; refused `storylines.notFound` for an unknown id                                                                     |
| `storylines.forPerson`     | `{ personId, includeEnded? }` | `{ personId, rows }` across every promotion, each row scoped on its own                                                                                              |
| `storylines.memberOptions` | `{ promotionId? }`            | `{ promotionId, options }`: everyone with an active contract there, wrestlers first, then by push, then name                                                         |

List order: active storylines first, hottest first (public rows after) then by
name; ended storylines after, most recently ended first.

The timeline lists the linked segments by show date, the pre-show before the
main card, then slot: segment, show, date, slot, kind, a label (the billing
line, else who was in it), stars once rated, the rating trace and whether it
is the finale. No entry has a duration, length or minutes (D-10).

## Events

Payloads hold ids and primitives only
([day-pipeline.md](day-pipeline.md#payload-rules)). CRTV3-02 and CRTV3-03
publish them.

| Event                      | Payload                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `storyline.started`        | `{ storylineId, promotionId, source: 'player' \| 'setup' \| 'ai' }` |
| `storyline.ended`          | `{ storylineId, promotionId, linkedSegments }`                      |
| `storyline.membersChanged` | `{ storylineId, promotionId, added, removed, sideChanged }`         |

## Traces

All three kinds are stored under the storyline's id.

- `storylines.heat` (`storylineHeatTraceRef`): one current heat trace per
  storyline: the starting heat, then the latest cooling step, then CRTV4's
  progress. Rows show it as `heatTraceRef` when kept.
- `storylines.starter`: why a starter storyline was picked (CRTV3-02),
  served as `startedBecauseTraceRef`.
- A rival's heat and starter traces are kept as summaries only; an ended
  storyline's become summaries once it ended more than
  `history.keepDetailDays` ago ([Heat decay](#heat-decay)).
- `storylines.payoff`: reserved for CRTV4's payoff.
