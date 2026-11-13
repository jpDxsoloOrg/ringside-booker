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

`systems/shows/phases.ts`. One phase, `shows.runShows` (group `shows`, order
10, daily), resolves **every show dated today that the computer runs**, so a
show's results, and later its attendance and money, all share its date. The
player's own shows run from the show screen instead
([The player's shows](#the-players-shows)). It is skipped on a day with no
open show (`hasShowsToday`).

### Which shows run

The day's shows are read through the `byDate` index and run by air date, then
id. Ids come from the seeded random stream, so id order is not the order shows
were made in; sorting by air date first means a live episode resolves before
an episode taped the same night. Then, for each show:

- `cancelled` and `completed` shows are never touched.
- A show a **human** runs (its brand's controller when the brand has one, else
  its promotion's, through the calendar's `showControllerOf`) is never run
  here (EVT2-09): it is logged and left alone. The show-day gate stops the
  clock on its day and the player runs it with `shows.runTonight`; in a game
  built without that gate, the calendar's `calendar.closePastShows`
  (settlement, order 90) marks it Not run at the end of the day.
- A show the **computer** runs plays its card when it has one, and is scored
  [off-screen](#off-screen-score) when it has none.

Every show, the phase's and the player's, runs through one function,
`runShowNow` (`runShow.ts`): the [before-a-show-runs hooks](#before-a-show-runs),
then the card (or the off-screen score).

### Running a card

`systems/shows/context.ts` reads the show once (`showContextOf`): its format,
region and region name, promotion, brand, importance, whether it is televised
(from its definition; a one-off show counts as not televised), whether a human
runs it, and its card in running order (the pre-show first, then the main
card, each by slot, through booking's `cardSegments`). Each segment's people
are grouped into sides: in a match the competitors' sides are the sides and
ringside people and interferers ride along on theirs; in an angle every role
counts. `slotRoleInput(segment, format)` turns the stored 0-based slot into
MTCH1's 1-based slot position.

Then each segment, in running order (`runSegment.ts`):

1. A segment that already has a rating (BRW3's aired draft) is left as it is;
   its stored score still counts toward the show score. The rating being set is
   what marks a segment as run (`isSegmentRun`): a match's `outcome` holds the
   plan before the show and the result after, so it cannot.
2. A match's result is decided by the [outcome resolver](#match-outcome-resolver)
   and written to `outcome` (and `match.finishKey` when the resolver chose a
   finish) before rating, because the stored-segment adapter reads the row and
   finish effects must see the real result.
3. The segment is rated with MTCH1's `rateSegment(ratingInputFromSegment(...))`
   in `live` mode, seeded by the segment id and drawing on the world's
   `match.rating` stream. The promotion's rating policy comes through
   `ratingPolicyFor` inside `rateSegment`, so rival edges reach ratings only
   through that door (D-01). A rating the pipeline refuses is logged and the
   segment counts as an empty slot; it never throws.
4. `rating` is written: `score`, `stars`, the `workRate`, `crowd` and
   `expectation` components (kept within 0..100; a talking segment has no work
   rate) and the trace's ref key.
5. The trace is stored under `shows.segmentScore` (or
   `shows.rivalSegmentScore` on a computer show). It starts with MTCH1's slot
   lines ("Main event (long)", "Slot weight ×1.75"), then the resolver's
   decision ("How the match ended: Booked result"), then the numbers.
6. Winners, losers and drawers are worked out from the result, competitors
   only and each list by id: a win makes the winning side's competitors winners
   and every other side's losers; a draw puts every competitor in `drawIds`; a
   no contest and an angle leave all three empty. Every registered
   [result applier](#segment-result-appliers) runs, in order.
7. `segment.completed` is published.

Then the show score (`showScore`, above) is computed from one entry per
main-card slot (an empty slot, or a segment that could not be rated, counts as
empty) and one per rated pre-show segment, each with its `slotWeightOf`
weight. Every show score modifier's `gather` runs first and the registered
modifiers are passed in. The trace is stored under `shows.showScore`, the
instance becomes `completed` with its `result` (`attendance`, `gate` and
`viewers` stay null until EVT6 and ECO8), and `show.completed` is published
with `offscreen: false` and the number of segments on the card.

An off-screen show writes its result with `rawScore` equal to its score,
stores the trace under `shows.showScore` and publishes `show.completed` with
`offscreen: true` and `segmentCount: 0`. It runs no segment and no applier and
publishes no `segment.completed`. It draws `shows.offscreen` exactly once, so
adding or removing another show never changes its roll.

Show night writes only segments' `outcome`, `match.finishKey` and `rating` and
shows' `status` and `result`. Morale, momentum, popularity and fatigue belong
to the features that react to its events and appliers (WRK8, MTCH3, MTCH4);
losers inside hot storylines are WRK8's to shield (D-09), so show night only
reports `storylineIds`.

EVT3-04 adds two more writes of show night's own: its built-in title applier
opens, closes and adds defences to title reigns ([Title outcomes](#title-outcomes)),
and each run card adds to its workers' appearance counts on their contracts
([Appearance counts](#appearance-counts)).

### Why a failure rolls back the whole day's shows

A phase is one step and one transaction ([day-pipeline.md](day-pipeline.md)).
If anything throws while a show runs, every show of that day rolls back with
it: no ratings, results, events, traces or random draws are kept, the failure
lands in `sim.failures`, and the shows stay unrun, so the calendar closes them
as Not run at the end of the day. That is honest but harsh, which is why every
step that can meet bad data (a rating the pipeline refuses, an applier) logs
and skips rather than throwing. Running one step per show would need pipeline
support that does not exist; a savepoint is no substitute, because it rolls
back table writes but not staged events, traces or random draws.

Running the phase a second time on the same date changes nothing: every show
it ran is `completed`.

## The player's shows

`systems/shows/tonight.ts` (EVT2-09). There is no Lock card: a card stays
editable until its show has run. Show night for the player is an event they
start, not something Next Day does in the background.

**The gate.** `shows.tonight` (label "Show night") stops Next Day and every
skip before a day with an open show a human runs. It reads the day's shows
through the `byDate` index, keeps the open ones (`scheduled`, or `booked` from
a save made before EVT2-09) whose `showControllerOf` is human, and names the
first by air date, then id: the order the phase uses. The hit is
`{ reason, subject: { kind: 'eventInstance', id }, actionHint: 'showNight' }`,
with reason "Tonight: <Show>", or "Your show '<Show>' has no card yet" when
nothing is booked. A cancelled or completed show never stops the clock, and
computer-run shows never do, so headless runs of a world without a human
promotion are unaffected. With two of the player's shows on one day, running
the first makes the gate name the second. The web shell maps the `showNight`
hint to **Go to the show** (`/game/booking?event=<id>`).

**The command.** `shows.runTonight { eventInstanceId }` → `{ eventInstanceId }`.
Its `validate` refuses, in this order, with the first that applies:

| Code              | When                                   | Player message                                                           |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| `showNotFound`    | no such show                           | "That show no longer exists"                                             |
| `notYourShow`     | the issuer does not run the show       | "Only the person running {brand or promotion} can run this show"         |
| `showCompleted`   | it has run                             | "This show has already run"                                              |
| `showCancelled`   | it was cancelled                       | "This show was cancelled"                                                |
| `notTonight`      | it is not dated today                  | "This show has already happened" / "This show is on {date}, not tonight" |
| `cardNotRunnable` | `validateCard` finds errors (up to 10) | each error's own message, with its segment as the subject                |

Warnings never block (D-09: booking someone to lose is never a warning at
all). Then `apply` calls `runShowNow(ctx, show, true)`: the same per-segment
work, appliers (titles at 10, the aftermath at 30), traces,
`segment.completed` and `show.completed` as the phase, so finance's show costs
and promotion popularity react the same way. Commands are refused with `busy`
while days are advancing.

**When it runs.** The gate stops a skip before its day is simulated, so the
player's show runs at the start of its day, before that day's phases
(fatigue recovery, the rivals' shows, settlement). Given the same save and
seed it gives exactly the result running it inside the day did, when nothing
earlier in the day changed the world it reads (`runTonight.test.ts` checks the
whole world, random state, traces and events against the old phase path).
The day's own phases then see the show completed, as before.

**Running it segment by segment** is EVT10 (live show night): it adds a
"Run next segment" command beside this one on the same screen, and this
command stays "Run the whole show".

### Before a show runs

`registerBeforeShowRuns({ id, order, run(ctx, { show, human }) })`
(`beforeRun.ts`) registers a hook that runs once, inside the show's own step,
just before its first segment, for every show `runShowNow` runs (the player's
from `shows.runTonight`, everyone else's from the phase). `runShowNow` reads
the show again afterwards, so a hook's writes are what the show runs with.
Hooks run by `order`, then id; a throw rolls the show back with it, so a hook
logs and skips bad data. This is where EVT6-03 picks a venue for a show that
has none ("pick a venue when the show runs"), the job a `card.locked` listener
would have done. An event published in the same step is no substitute: it is
delivered only after the show has run.

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

`systems/shows/formulas/offscreenShowScore.ts`. AIP4's rival booker books a
card for every computer-run show on show day, and show night runs those cards
like the player's (AIP4-08). A computer-controlled show that still has no card
(the booker could not fill it, or a world without the rival desk) is scored
without rating any segments, and its results page says the card was not booked
in detail:

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
traces). It only covers a computer show AIP4 left empty. Any rival-only rating edge stays in AIP1's `ai.*` tunables through
MTCH1's `RatingPolicy`, never here.

## Title outcomes

**Rival results arrive planned.** Since AIP5-04 every match on a computer-run
card reaches show night with a planned result (`segment.outcome`) from the
rival booker's `aip.decideResults` step, so `shows.runShows` runs it as booked
like a player's planned result, and a planned title change happens here,
through this applier, not in the booker. Only a rival match the step could not
plan (a content problem, logged) is left to the automatic winner. See
[rival-booking.md](rival-booking.md#how-a-rival-shows-results-are-decided).

`systems/shows/titles.ts` (EVT3-04). A title match ends one of three ways for
each title on the line: the title changes hands (`title.changed`), the
champion keeps it (`title.defended`), or nothing happens (a no contest). A draw
counts as a successful defence while `shows.titles.drawCountsAsDefence` is on
(the default).

It is show night's own [result applier](#segment-result-appliers),
`shows.titleOutcome` at order 10, so later appliers (MTCH3's popularity at 30)
already see the new champion. It runs only for a match with titles on the
line, once per title in title id order, so two titles on one match each get
their own decision, trace and event.

### The decision

`titleOutcomeDecision` is a traced decision titled "Title outcome: <title
name>", stored under `shows.titleOutcome` with the id
`${segmentId}|${titleId}`. The **holders' side** is the side with any holder
of the title's open reign; a title with no open reign is vacant and every side
is a challenger side (so is every side when the champion is not in the match).

| Result                     | Rules checked                                                                                                              | Outcome                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Win by a challenger side   | "<Method> can change titles" (or MTCH2's title rule, below); "Winning side has <n> competitors; the title needs <holders>" | `changed` ("Challengers won by <Method>") when both pass                                                          |
| (one of those rules fails) |                                                                                                                            | `retained`, or `stillVacant` for a vacant title; the failing rule is the reason ("Count-Out can't change titles") |
| Win by the holders' side   |                                                                                                                            | `retained` ("Champion won")                                                                                       |
| Draw                       | Reads `shows.titles.drawCountsAsDefence`                                                                                   | `retained` (`stillVacant` for a vacant title)                                                                     |
| No contest                 |                                                                                                                            | `noChange` ("No contest: the title stays where it was")                                                           |

Every `retained` adds a defence, except a draw while the flag is off. A
challenger win that could not move the title (a count-out, say) is still a
successful defence. `stillVacant` and `noChange` write and publish nothing.

**How MTCH2 slots in.** The method rule reads the win method's `changesTitles`
from the methods catalog. When the match outcome resolver returns
`titleCanChange` (MTCH2's title rule: the method **and** the finish allow a
change, EVT3-07), that result replaces the method rule and its reason is the
rule's text ("Disqualification: titles can't change hands on this finish").
Until then `plannedOrNoContest` returns null and the method flag alone
decides.

### Writes, in order

A `changed` title:

1. closes the old reign, if any: `lostOn` today, `endReason: 'lost'`,
   `endedInSegmentId` the segment;
2. then creates the new reign: the winning competitors by id, `wonOn` today,
   `wonInSegmentId` the segment, 0 defences, `holderNamesAtTime` from each
   holder's ring name on their active contract with the title's promotion
   (else their default ring name), and `teamId` the winners' shared team when
   the title has more than one holder and every winner was listed with the
   same team;
3. publishes `title.changed` (`fromReignId` null for a vacant title).

Closing first matters: the `openByTitle` unique index allows one open reign
per title, and a second one would throw and roll back the whole day's shows. A
title can change hands twice on one show; the middle reign is won and lost the
same day, which the `reignsDoNotOverlap` invariant allows.

A defence adds 1 to the open reign's `defences` and publishes
`title.defended` with the new count.

### Guardrails

A title that no longer exists, is retired, or belongs to another promotion
than the show's is logged and skipped (no trace, no write). A winning side
whose size does not fit the title is not an error: EVT2's validation stops it
on the player's cards, and a rival card that slips through fails the size rule.
Prestige changes, vacating, stripping and unifying titles belong to CRTV1 and
CRTV2; show night only ends reigns as "lost".

## Appearances

Filled by EVT3-03..05: who appeared on the show and in which segments.

### Appearance counts

`systems/shows/appearances.ts` (EVT3-04). After a card's segments have run,
every distinct person who worked it gets one more appearance: every
participant in any role (competitors, ringside, interferers, speakers) and
each segment's crew (referee, producer and announcers). Crew count on purpose:
they worked the show, and per-appearance contracts pay them, so ECO's fee code
counts them the same way. For each, their **active** contract with the show's
promotion gets `appearancesThisYear + 1` and `lastAppearanceOn` set to the
show's date. Someone in three segments counts once; a guest with no active
contract with that promotion is skipped. A show scored off-screen counts
nobody, since it has no card.

The phase `shows.resetAppearances` (group `housekeeping`, order 22, yearly on
1 January) sets `appearancesThisYear` back to 0 on every contract that has
any; `lastAppearanceOn` is kept. Housekeeping runs before the `shows` group,
so a show on 1 January is the first appearance of the new year. EVT2's
appearance cap warning, ECO's per-appearance fees and WRK8's not-booked
penalty read these fields.

## Events

Declared in `systems/shows/events.ts`. Payloads carry ids and primitives only;
see [day-pipeline.md](day-pipeline.md#adding-events-for-a-system) for the
table.

- `segment.completed`: one per segment, in card order. `winnerIds`, `loserIds`
  and `drawIds` list competitors only; a no contest and a talking segment have
  all three empty. `finishKey` is the finish MTCH2's resolver picked (EVT3-07);
  it is null only for an angle, or when the resolver fell back to the booked
  result without a finish.
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
| `match.result`            | segment id                 | How a match ended on a human-controlled show    |
| `match.rivalResult`       | segment id                 | How a match ended on a computer-controlled show |

Rival segments use their own kind so a busy rival schedule never pushes the
player's breakdowns out of `sim.traceRetentionPerKind`. A stored rating or
result keeps its trace's ref key (`refKey(ref)`) in `traceId`, and
`traceRefFromKey` turns it back into a ref.

## Results queries

`systems/shows/queries.ts` and `resultsView.ts` (EVT3-05). Show night writes
results; these queries make them readable without touching the world. The
view types (`ShowResultsView`, `SegmentResultView`, `ShowSummaryView`) are
exported from the engine's index; screens import them, and later features
(MTCH2's lab, DAY2's Office panel, EVT7's archive, DAY1's news) read them, so
changes to their shapes are additive only.

- `shows.results { eventInstanceId }`: one show's page. The header (name,
  dates, status, promotion with its colour and logo, brand, importance,
  format, region, venue), `mine`, `offscreen`, the `result` (score, raw
  score, stars from [show stars](#show-stars), the score's trace ref,
  attendance, gate, viewers) and every segment in running order. An unknown
  id is refused with `notFound` ("That show doesn't exist.").
- `shows.lastCompleted { scope? }`: the latest completed show (by date, then
  id) as one `ShowSummaryView`: name, date, promotion, score, stars, the main
  event slot's type, sides and winner, and every title change. `mine` (the
  default) keeps the viewer's shows; an omniscient viewer or a player who runs
  no promotion reads the world. It walks back a day at a time through the
  `byDate` index, at most 3,650 days and never before the world's first day.
- `shows.completedSince { from, to, scope, limit? }`: the shows completed with
  `from <= date < to`, newest first (by date, then id), at most `limit`
  (1 to 50, 10 by default). It reads `eventInstances.byDate` one day at a
  time; a range is refused when it ends before it starts or covers more than
  3,650 days (the most one advance can skip).

Each segment carries its 1-based `slotNumber`, its slot role and duration
class as keys and words (never minutes), the match or angle type, the sides
with each member's ring name (the active contract with the show's promotion,
else the default ring name: names are not stored at the time of the show),
the result (`win` with the side, method and finish names, `draw` or
`noContest`; null for a talking segment), the rating with its components, the
storylines, and each title on the line:

| Title outcome | When                                                                                 |
| ------------- | ------------------------------------------------------------------------------------ |
| `newChampion` | A reign was won in this segment; `newHolderNames` is the reign's `holderNamesAtTime` |
| `retained`    | The title was held going into the segment and nobody won it here                     |
| `stillVacant` | Nobody held it going in and nobody won it                                            |
| `none`        | The segment ended in a no contest, or the show has not run yet                       |

Every trace ref is passed through `ctx.traces.has(ref)`: a summarised trace
keeps its ref (the Why? panel shows the summary), an evicted one gives null,
so a screen never shows a Why? that opens nothing.

**Who sees what.** Results are public: rival cards and winners were on TV.
Money is not: `gate` is only returned for the viewer's own promotions (and to
the omniscient viewer of tools and tests), and is null for a rival's show
whatever is stored; ECO and EVT6 rely on this. A card is private until it
airs: a show that has not completed returns `result: null`, and a rival's
returns no segments at all. The viewer's own unaired card is listed without
outcomes or ratings, since a match's `outcome` is still the booker's plan. An
off-screen show (a completed computer show with no card) has
`offscreen: true` and no segments.

## Show report

EVT3-09 (owner testing, Sprint 4: "I couldn't see why things scored the way
they did, what I gained or lost, or how the show did overall"). The top of the
results page is a **show report** that answers those at a glance; every Why?
stays for the detail. It appears once the reveal is over, so it never gives a
result away early.

**Engine: read from the traces, no second formula.** `shows.results` carries
two more fields, both built in `systems/shows/report.ts` from the traces show
night stored:

- `result.breakdown` (`showScoreBreakdown`): the show score trace as rows.
  One `segment` row per rated slot (pre-show first, then the main card) with
  its score, slot weight, counted weight (after the pre-show factor) and
  `points`, its share of the show score (`score × weight ÷ total weight`); one
  `emptySlot` row per empty main-card slot (the penalty, negative); then one
  `adjustment` row per later step that moved the score (card flow, the
  production cap, the 0..100 clamp, rounding), with the step's own label. The
  rows add up to the score. `preShowFactor` is set when a pre-show slot
  counted, and `totalWeight` is the divisor. The n-th slot row is matched to
  the n-th rated segment of the card when their roles agree, else its
  `segmentId` is null. The labels the reader matches on are named once in
  `SHOW_SCORE_TRACE_LABELS` beside the formula. Null for an off-screen show,
  once the full trace is summarised or evicted, and for a trace cut by the
  size limits.
- `rating.reasons` on each segment (`segmentReasons`): the top two things that
  moved its score, largest first. Each weighted part (`work rate` or `talk`,
  and the `crowd`) counts by how far it sits from the middle of the scale,
  `(part − 50) × share`, and the house-rules bonus by itself; together they
  are how far the score sits from 50 before rounding. Worded "Strong work
  rate", "Weak talking", "Hot crowd", "Quiet crowd"; reasons under half a
  point are left out. Empty once the full trace is gone.

Nothing new is stored, so the save is unchanged.

**The page** (`screens/show-results/ShowReport.tsx`):

- **Headline**: the stars drawn and a verdict in words from them (poor under
  1.25 stars, weak, solid from 2.25, great from 3.25, outstanding from 4.25),
  "A solid show: 64, 2.5 stars", plus "3 points above what fans expected"
  when EVT5's `popularity.showChange` gives the show region's expectation.
  Then the best and worst segment by stars (then score), each linking to its
  card.
- **How it was scored**: a table, one row per breakdown row, with the slot
  and who was in it (linking to the segment card), stars, score, weight
  (`×0.4 → ×0` on the pre-show) and share; the pre-show factor has its own
  row; the last row is the show score. The score's Why? sits beside the
  heading. On a phone the table becomes cards.
- **What changed**: one line each, linking to its section lower on the page.
  Built in: new champions, title defences and appearances. Features add theirs
  with `registerShowReportLine` (see `apps/web/src/app/README.md`); a feature
  that is not on main has no line, never a placeholder.

| Order | Line               | From                                                        |
| ----- | ------------------ | ----------------------------------------------------------- |
| 10    | New champion(s)    | built in, the segments' title outcomes                      |
| 11    | Title defence(s)   | built in                                                    |
| 15    | Appearances        | built in, everyone on the card once                         |
| 25    | Fans (EVT5)        | `popularity.showChange`: regions gained and lost, the most  |
| 30    | Popularity (MTCH3) | `match.aftermath`: workers up, down and the same            |
| 35    | Box office (EVT6)  | `boxOffice.showCrowd`: the crowd and % full; your gate too  |
| 60    | Money (ECO1)       | `finance.ledger` for the show: the net, your own shows only |

Still to come, each as its own line: TV, PPV and streaming
income (ECO8), injuries (MTCH4, WRK6), morale (WRK8).

**Each segment card** shows its reasons in a line under the numbers ("Top
reasons: Strong work rate (+8), quiet crowd (−5)").

**Getting there.** The setting "After a show, open its results" (Settings >
Show nights, on by default, stored in the browser with the other settings):
when a Next Day or a skip runs one of your shows, the game goes straight to
that show's results with the reveal; several shows on one skip open the
first, and the day summary links the rest. Off, the summary only links. Once
EVT2-09 lands, your shows run from the show screen and always open their
results, so the setting only matters for shows run some other way.

**The reveal.** Opened from those links, the results page waits for the
player: the cards start as "Coming up" placeholders, and each tap of Next
segment (or of the next placeholder) reveals one, the main event last; the
tap after that shows the score and the show report. Show all reveals
everything at once. Nothing comes out on a timer (EVT3-10, after owner
testing found the timed reveal slow). The setting "Reveal results one segment
at a time" (Settings > Show nights, on by default) turned off opens results
fully revealed, and so does reduced motion.

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

### Segment result appliers

`systems/shows/registries.ts`. Features that react to a segment's result
inside the shows phase, in the same transaction, register an applier: EVT3-04
settles titles through one, and MTCH3 (popularity) and MTCH4 (fatigue) add
theirs later.

```ts
registerSegmentResultApplier({
  id: 'shows.titleOutcome', // system.camelName, unique
  order: 100, // lower runs first; ties run by id
  apply: (ctx, result) => {
    /* read the world through ctx.read, write through ctx.tx */
  },
});
```

`result` is plain data: the segment, show, promotion, brand, date, importance
and region; `humanShow`; `kind`, the stored `slot`, `preShow`, the slot role
(`roleKey`) and `durationClass`; the `sides` (`{ side, personIds, teamIds }`);
the `outcome` (null for an angle); `winnerIds`, `loserIds` and `drawIds`;
`storylineIds` and `titleIds`; the `finishKey`, `methodKey` and
`titleCanChange` the resolver returned; and the `score` and `stars`. An
applier that throws rolls back the whole day's shows (see
[above](#why-a-failure-rolls-back-the-whole-days-shows)), so it should log bad
data with `ctx.log` and skip it. A malformed id, a non-finite order or a
duplicate id throws a `RegistryError`. `listSegmentResultAppliers()` returns
them in run order; `unregisterSegmentResultApplier(id)` is for tests.

### Match outcome resolver

`systems/shows/registries.ts`. How a match ends is decided before it is rated,
by one resolver:

```ts
registerMatchOutcomeResolver({
  id: 'match.resolveOutcome',
  resolve: (input, { read, tunables, rng }) => ({
    outcome, // MatchOutcome
    finishKey, // ContentKey | null
    methodKey, // ContentKey | null
    titleCanChange, // Traced<boolean> | null
    trace, // the decision, shown in the segment's Why? panel
  }),
});
```

`input` holds the segment, show, promotion and region ids, the booker's
`plan` (the planned `outcome`, or null), the planned finish and the sides with
their competitors. `rng` is the phase's own stream lookup, so a resolver draws
only from its own named streams. At most one resolver may be registered (a
second throws a `RegistryError`). MTCH2 registers its `resolveMatchOutcome`
here (EVT3-07) instead of editing the phase.

The resolver's decision is also stored on its own, under `match.result` (or
`match.rivalResult` on a computer show) with the segment id, and the results
page's result line opens it as the winner Why? (`resultTraceRef` on the
segment's outcome view).

Without MTCH2 the built-in `plannedOrNoContest` decides: a planned result is used
as booked ("Booked result"), and a match with no plan ends as a no contest
("No winner was planned for this match, so it ends as a no contest"). It
leaves the finish null and `titleCanChange` null, so EVT3-04 reads the
method's `changesTitles`.

### Still to come

Filled by EVT3-04 and later: EVT6's attendance and gate and ECO8's viewers.

The save break: EVT3-01 changed the segment rating and show result shapes, so
saves made before it fail to load with the "Made with an older build" message
and a new game is needed.

## Integration

EVT3-07 wires show night into the partners that were on `main` when it ran.
Partners that land later wire show night from their own integration tickets
through the seams above.

| Partner                                                 | Status                  | How it is wired                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MTCH2 (finishes)                                        | wired (EVT3-07)         | The match bundle registers `match.resolveOutcome` (`systems/match/finishes/showNight.ts`) as the [match outcome resolver](#match-outcome-resolver). It adapts `resolveMatchOutcome`: plan = `outcome` + `match.finishKey`, mode `randomWinners` when `randomWinnersActive` is true for the show's promotion and brand, streams `match.auto-winner` and `match.finish`. It returns `finishKey`, `methodKey` and `titleCanChange` (MTCH2's title rule), so EVT3-04's decision reads the method **and** the finish; `segment.completed.finishKey` is filled. See [match-finishes.md](match-finishes.md#integration) for the cases (unplanned, booked no contest, refused plans). |
| MTCH3 (popularity, momentum)                            | wired (MTCH3-05)        | `registerSegmentResultApplier({ id: 'match.aftermath', order: 30, ... })` from the match bundle (`systems/match/aftermath/showNight.ts`) and the "Popularity & momentum" results section at order 30. See [match-aftermath.md](match-aftermath.md#integrations).                                                                                                                                                                                                                                                                                                                                                                                                              |
| WRK8 (morale)                                           | wires from its own pack | Subscribes to `segment.completed` and `show.completed`; the D-09 story shield reads `storylineIds`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AIP4 (rival booking)                                    | wired (AIP4-08)         | `aip.bookShow` books each computer show's card on show day, so `shows.runShows` runs it (rated segments, `offscreen: false`); the off-screen score is left for a computer show with no segments. The Shows tab links each run show to its results.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| DAY2 (Office)                                           | wired (DAY2-06)         | The "Last show" Office panel `shows.lastShow` (order 55, main column) in `apps/web/src/screens/show-results/officePanel.tsx` reads `shows.lastCompleted { scope: 'mine' }`: name, date, score with its Why? and stars, the main event and winner, title changes, EVT6's crowd (`boxOffice.showCrowd`) and the box office net (`boxOffice.showMoney`, own shows), and a Full results link; "No shows yet" before the first.                                                                                                                                                                                                                                                    |
| MTCH4, MTCH6                                            | wires from its own pack | Result appliers at order 40 (physical toll) and 50 (chemistry).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ECO1 (show costs)                                       | wired (ECO1-04, -06)    | `finance.postShowCosts` subscribes to `show.completed` (appearance fees, travel, catering) and the "Show money" results section (60) lists the show's ledger rows. See [finances.md](finances.md#integration).                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ECO3/7/8/10/11, DAY1/3/4/5/8, SOC5/7, BRW3, MP7, POL2/8 | wires from its own pack | Subscribe to `show.completed`, `segment.completed` and `title.changed`, or read `shows.completedSince`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Applier order.** Titles 10 (`shows.titleOutcome`, built in), then MTCH3's
aftermath 30, MTCH4's physical toll 40 and MTCH6's chemistry 50 as they land.
The title applier and MTCH3's aftermath (MTCH3-05) run today.

**Results sections.** EVT5's "Popularity" (25), then MTCH3's "Popularity &
momentum" (30, MTCH3-05), then EVT6's "Box office" (35, EVT6-05; a rival's
show shows its crowd only), then ECO1's "Show money" (60, ECO1-06, the player's
own shows only).

**Random winners and booking.** Show night decides every match on a Random
winners show on the night; a result booked anyway is set aside with a note
("Random winners: the booked result was set aside and decided on the night").
Booking refuses a planned result or finish on such a show and skips the
`noPlannedResult` check, so the show runs with nothing planned (EVT2-07, see
[booking.md](booking.md#integration)); the set-aside note only covers results
written before Random winners was on.

**Show scores.** With MTCH2 wired every match has a finish, so finish effects
now reach real ratings. See the EVT3-07 progress log for the measured change in
show score levels over the 60- and 365-day sims.
