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

CRTV3-02. How much heat a new storyline starts with. The starting heat is the
first step of its `storylines.heat` trace.

## Heat decay

CRTV3-02. How a storyline cools when no linked segment moves it on, counted
from `lastProgressOn` (or `startedOn` when there is none). Each cooling step
replaces the storyline's `storylines.heat` trace.

## Starters

CRTV3-02. The storylines a new game starts with, and why each was picked
(`storylines.starter` trace).

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
- `storylines.starter`: why a starter storyline was picked (CRTV3-02).
- `storylines.payoff`: reserved for CRTV4's payoff.
