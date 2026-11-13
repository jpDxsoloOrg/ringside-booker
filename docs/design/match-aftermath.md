# Match aftermath

What a match result does to the people in it once the bell has rung: how much
more (or less) famous each competitor gets, and how much hotter (or colder)
they are right now (MTCH3). Popularity is how well known someone is; momentum
is how hot they are at the moment. The two are worked out separately, and
neither ever touches morale.

The formulas here are pure: they take a result and return a traced change.
Writing it is someone else's job. WRK1's doors (`applyPopularityChange`,
`applyMomentumChange` in `systems/workers/doors.ts`, see
[workers.md](workers.md#doors)) apply the change, start an empty momentum and
keep the totals within their ranges. Show night calls them for every match it
runs (MTCH3-03), and the Match lab's Aftermath tab shows the same numbers with
a Why? (MTCH3-04).

Code: `packages/engine/src/systems/match/aftermath/`.

## Popularity gain

`popularityGain(inputs, { tunables })` returns how many popularity points one
competitor gains (positive) or loses (negative) from one match, as a
`Traced<number>`. It is pure: plain inputs, no world, no writes. Every balance
number is a `match.popularity.*` tunable (category Aftermath).

It works only on the **show region's** popularity, the crowd that actually saw
the match (D-03). The result is the `delta` the
[popularity door](workers.md#popularity-door) (`applyPopularityChange`, WRK1)
takes. The door, not this formula, spreads the change over regions, tapers
gains above the person's charisma anchor, keeps popularity between 0 and 100
and rounds the stored value. This formula keeps full precision.

It never reads or changes morale (D-09 lives with morale), and it has no
duration or minutes input.

### Inputs

| Input             | Meaning                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `outcome`         | `win`, `loss`, `draw` or `noContest` for this competitor                                                   |
| `popularity`      | Their own popularity in the show's region                                                                  |
| `opponents`       | Who the result is measured against: everyone beaten for a win, the winners for a loss, everyone for a draw |
| `importance`      | The event's size, house show to flagship                                                                   |
| `finish`          | The chosen finish's name and its winner and loser gain factors from the finish catalog, or null            |
| `competitorCount` | Everyone competing in the match, on every side                                                             |
| `segmentScore`    | The match's segment score 0..100, or null before it is scored                                              |
| `preShow`         | Whether the match was on the pre-show                                                                      |
| `priorWinStreak`  | Wins in a row before this match, not counting it (MTCH3-02)                                                |
| `momentum`        | Momentum with the promotion −100..100, or null before a first appearance                                   |

### Order of steps

```
base → event size → pre-show → finish → crowded → limit
     → great match → limit → classic → limit
     → win streak → limit
     → momentum (gains only) → limit
```

"Limit" is the per-match limit: the running value is kept between
`−maxLoss` and `+maxGain` (default −3 and +4).

### Base

The result, and who it was against, drives popularity. Match quality barely
does (D-02): it only adds a small bonus later. Gains scale smoothly with the
popularity gap; there are no bands or steps.

- **Win.** `gap = strongest beaten opponent − own`. When the gap is 0 or more
  the base is `winBase + winGapPerPoint × gap`; beating a less popular
  opponent uses the gentler `winDownGapPerPoint`, so the gain shrinks. The base
  is then floored at 0: a win never costs popularity. The line reads
  "Beat Kara Voss, 31 points more popular".
- **Loss.** `gap = own − least popular winner`. The cost is
  `lossBase + lossGapPerPoint × max(0, gap)`: losing to someone less popular
  costs more, losing to someone more popular costs only the base. The line
  reads "Lost to Kara Voss, 20 points less popular" or "Lost to a more popular
  opponent".
- **Draw.** `drawGapPerPoint × (mean opponent popularity − own)`, kept within
  `±drawMax`. Drawing with stronger opponents helps, drawing with weaker ones
  hurts, symmetrically.
- **No contest.** 0, recorded as a single "No contest" line. Nothing else
  applies.

With the defaults a win over an equal is +1.0, a 30-point upset is +4.6 before
the limit (+4.0 after), and a loss to an equal is −0.5.

### Multipliers

1. **Event size.** `importance.<size>.gain` for a gain (or 0), `.loss` for a
   loss. Bigger shows make gains bigger (0.5 at a house show up to 2 at the
   flagship), while losses never grow past 1: a big stage is where careers are
   made, not ruined.
2. **Pre-show.** × `preShowFactor` (0.5): fewer people watch the pre-show.
3. **Finish.** × the finish's winner gain factor for the winner, its loser
   factor for the loser (a disqualification win counts for half). Draws are not
   touched; with no finish chosen the step is skipped with a "No finish chosen"
   line.
4. **Crowded match.** When more than `crowdedFrom` (6) compete, the result is
   multiplied by `crowdedFrom / competitors`: winning a ten-way scramble is
   worth less than a one-on-one win.

### Bonuses

- **Great match.** + `greatMatchBonus` when the segment score is at least
  `greatMatchFrom` (85), then + `classicBonus` on top when it is at least
  `classicFrom` (95). They apply to winners, losers and draws alike, so a
  classic can lift a narrow loss to a small gain ("lost but won the crowd").
- **Win streak.** Winners only. With `k` wins in a row before this match and
  `k ≥ streakPriorWins`, + `min(streakStep × (k − streakPriorWins + 1), streakMax)`.
  `streakLookback` is how far back MTCH3-02 counts the streak.

**Why a limit after every bonus.** A bonus added after the only clamp would
let a capped upset plus a streak plus a classic break the per-match limit,
which is exactly the kind of spike the limit exists to stop. Clamping after
each step keeps the limit a real limit, and the trace shows where it bit.

### Momentum

Momentum shapes gains only, after the bonuses. Below `neutralMomentumAt` (0)
a gain is dampened:

```
factor = coldMomentumFactor + (1 − coldMomentumFactor) × clamp((m + 100) / (neutral + 100), 0, 1)
```

so at −100 a gain keeps `coldMomentumFactor` (a quarter) of its size. At or
above neutral it is lifted:

```
factor = 1 + hotMomentumBonus × (m − neutral) / (100 − neutral)
```

up to 1.25 at +100. No momentum yet counts as neutral (factor 1, with a note).
The final per-match limit follows.

**Why momentum never flips a gain.** Every factor is 0 or more (each tunable
has `min: 0`), and momentum multiplies only a value that is already above 0, so
a cold worker's gain can shrink to 0 but never becomes a loss. Losses are never
multiplied by momentum: a cold streak is already its own punishment.

### Turning things off

Every tunable at 0 removes exactly its effect with no special cases: a zero
gap rate makes every win worth `winBase`, a zero bonus adds nothing, a
`coldMomentumFactor` of 0 lets a gain fade to nothing at −100, and every
tunable at 0 gives 0 for every outcome. The only fixed numbers are 0 (no
contest, floors), the ends of the momentum scale (−100 and +100) and the
identity factor 1, each recorded as a constant with its reason.

### Next

- [Momentum gain](#momentum-gain) and [Prior matches](#prior-matches) (MTCH3-02, below): momentum changes and the win streak count fed into `priorWinStreak`.
- [Regional spread](#regional-spread) (MTCH3-03): spreading this region's
  change to neighbours and TV reach; the neighbouring region's Why? reads
  "this match's change × spill × taper".
- MTCH3-04: the Match lab's Aftermath tab shows these lines.

## Momentum gain

`momentumGain(inputs, { tunables })` in `aftermath/formulas/momentumGain.ts`
gives one competitor's momentum change from one match, in points. Its trace
starts at 0 ("No change yet") and every step below is a labelled line.

| Result     | Steps                                                                                                                                                                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Win        | `+ winBase` ("Win"); `+ winGapPerPoint × gap` where `gap = max(0, hottest beaten opponent − own)` ("Beat a hotter opponent (gap g)"); `+ multiSideWinPerExtraSide × (sides − 2)` when there are more than two sides ("Won a n-way match"); then at most `winMax` ("Most one win can give")    |
| Loss       | `− lossBase` ("Loss"); `− lossGapPerPoint × gap` where `gap = max(0, own − coldest winner)` ("Lost to a colder opponent (gap g)"); then at least `−lossMax` ("Most one loss can cost"); then `× max(multiSideLossShare, 2 ÷ sides)` when there are more than two sides ("Lost a n-way match") |
| Draw       | `− draw` ("Draw")                                                                                                                                                                                                                                                                             |
| No contest | 0, with the line "A no contest changes nothing". Nothing else applies, not even the great match bonus.                                                                                                                                                                                        |

Then, for every result but a no contest:

1. **Great match.** `+ greatMatchBonus` when the segment score is at least
   `greatMatchFrom` (a branch line records the check). An unrated segment gets
   the note "Not rated: no great match bonus". Everyone in a great match gets
   it, winners and losers alike.
2. **Per-match limit.** The total is kept within `±maxPerSegment`, so a bonus
   can never push a result past the limit.

Why it works this way:

- **Beating someone hotter is worth more; losing to someone colder costs
  more.** The gap is measured against the hottest opponent a winner beat and
  the coldest opponent who beat a loser. In a multi-way match a loser's gap
  is to the winners only: finishing behind a cold fellow loser is not losing
  to them. Gaps are never negative, so a win is always worth at least
  `winBase` and a loss always costs at least `lossBase` (before the limits).
- **Many sides soften a loss.** Losing a four-way match is not the same as
  being beaten one on one, so a loss keeps `2 ÷ sides` of its size (half in a
  four-way), but never less than `multiSideLossShare`: being the one who got
  pinned in a battle royal still counts for something. Winning against more
  sides is worth a little more.
- **Draws cost a little.** Nobody looks hot after a stalemate.
- **The lines are smooth.** The gap bonus grows point by point instead of
  stepping through bands, and every number is a tunable; set one to 0 and its
  step adds nothing.

With the defaults: an equal win is +5, an equal loss −5, a draw −2, a win over
someone 50 hotter +15 (the win limit), a loss to someone 40 colder −13, a
four-way loss −2.5 and a ten-way loss −1.75.

### Momentum is per contract

Momentum lives on the employment (`employments.momentum`), so it is always the
momentum with the show's promotion:

- **Own momentum** is the competitor's momentum with the show's promotion. An
  empty one (no appearance yet) is first started with `initialMomentum` from
  `systems/workers/doors.ts`, which is exactly what
  `applyMomentumChange` will start it from, so the "before" in the Why? is the
  door's "before".
- **Opponents' momentum** is theirs with the same promotion. An opponent with
  no contract there counts as 0 (`noContractMomentum(name)`), and the trace
  says so: "No contract with this promotion: counts as 0".
- **A competitor with no contract with the show's promotion gets no momentum
  change at all.** There is no employment to write it to; the aftermath shows
  a note instead of a number.

What the formula does not do: decay toward 0 between shows is WRK5's; the
−100..100 range and starting an empty momentum are WRK1's door; morale is never
read or written here.

## Prior matches

`priorMatchesOf(read, personId, before, limit)` in `aftermath/history.ts`
lists a person's earlier matches, newest first. It feeds the popularity
formula's win-streak bonus (MTCH3-01, through `winStreakBefore`) and the
Recent form list (MTCH3-04). Each entry has the segment, show, date, the
person's side, the result from that side (`resultOf(segment, side)`: win,
loss, draw or no contest) and the competitors on every other side.

`before` is where the match being judged sits: its date, its show (null for a
Match lab match on no show), its section and slot, and its own segment id when
it is stored.

**What counts as prior.** A match is prior when it is on an earlier date, or
on the same show and earlier on its card: the pre-show comes before the main
card, then lower slots come first. Another show on the same day is not known
to come first, so it is left out; a lab match on no show sees only earlier
days. Ties are broken by id so the order is always the same.

**The match being judged is never in its own history.** By the time show night
works out a match's aftermath, its result is already written, so a naive
lookup would count the win it is judging as part of the streak going into it,
and a two-match streak would be paid as three. `before.segmentId` is always
left out, whatever its date and slot say.

**Only run matches count, and only as a competitor.** A match counts once show
night has run it (it has a rating) and it has a result. Before that, a
segment's outcome is only the planned result, which may never happen. Someone
at ringside, interfering, or in an angle did not win or lose, so only the
`competitor` role counts.

### Win streaks

`winStreakBefore(read, personId, before, lookback)` counts the straight wins
at the head of the last `lookback` prior matches (`match.popularity.streakLookback`,
10 by default):

- a loss or a draw ends the streak;
- a no contest is skipped: it neither ends nor extends it (it still uses one
  of the `lookback` matches);
- a lookback of 0 gives no streak.

It returns the streak and the segment ids it is made of, newest first, so the
popularity trace can show them as an input line "Win streak before this
match".

The lookup reads the person's participant rows through the `byPerson` index,
so it grows with a career, not with the whole history. It is called once per
competitor per segment and capped by `limit`; if it ever shows up as slow, the
applier can keep a per-show memo rather than adding an index.

## Regional spread

`popularityGain` gives one number for the show's region. The popularity door
spreads it (D-03): each region gets `delta × weight`, tapered above the
worker's charisma anchor, kept within 0..100 and rounded to hundredths.
`segmentRegionWeights(read, ctx, tunables)` in `aftermath/regionWeights.ts`
decides the weights:

| Region                      | Weight                                  | Line                       |
| --------------------------- | --------------------------------------- | -------------------------- |
| The show's region           | 1                                       | "Show region"              |
| Each of its neighbours      | `match.popularity.neighbourSpill` (0.4) | "Neighbour of North Coast" |
| Each region a provider adds | the provider's weight                   | the provider's reason      |

**Largest weight wins, never the sum.** A region reached twice (a neighbour
that also gets TV coverage) takes the larger weight. The TV audience next door
is the same crowd, not a second one, so summing would pay one match twice.
Weights are kept within 0..1 (a provider weight outside it is clamped and a
note says so), a weight of 0 is dropped, and a spill of 0 drops the
neighbours.

**The reach seam.** `registerPopularityReach({ id, order, regionsFor })` in
`aftermath/reach.ts` adds regions beyond the neighbours. `regionsFor(read,
ctx, tunables)` gets the promotion, the show (null in the lab), the region,
whether it is televised, its size and the date, plus the tunables, and returns
`{ regionId, weight, reason }` lines such as "TV reach: Coastline Sports".
Providers run by `order`, then id; a duplicate id throws. MTCH3-05 registers
TV coverage (`match.tvReach`, see [Integrations](#integrations)); without a
provider only the show region and its neighbours move.

Countries and continents are never weighted: their figures are the
population-weighted roll-ups of the regions, worked out on read.

## The aftermath of one match

`computeSegmentAftermath(read, input, tunables, geography)` in
`aftermath/computeSegmentAftermath.ts` works out what one match does to every
competitor, writing nothing. `input` is a stored segment (`{ segmentId }`,
show night) or a simulated match (sides, outcome, finish, score, size,
region, televised, pre-show, promotion and date: the Match lab).

For each competitor it reads, from the world as it stands:

- popularity in the show's region (0 when none is stored);
- the opponents MTCH3-01 measures against (everyone beaten for a win, the
  winners for a loss, everyone else for a draw) and, for momentum, every
  competitor on another side with whether they won;
- the win streak going in (`winStreakBefore` with
  `match.popularity.streakLookback`);
- momentum with the show's promotion: the stored value, the door's starting
  value when it is empty, or no momentum at all without an active contract.

It then calls `popularityGain` and `momentumGain`, and previews both doors
(`previewPopularityChange`, `previewMomentumChange` in
`systems/workers/doors.ts`, the doors' own math with no writes) over the
region weights. The answer is plain JSON: the weight lines, and per worker the
popularity delta, a row per reached region (before, after, change and the
door's trace), a row per country and continent that holds a changed region
(roll-up before and after; the Why? reads "after roll-up − before roll-up")
and the momentum before, after and trace, or `{ none: 'noContract' }`.

**Everyone is worked out from the values before the match.** In a tag match
one partner's gain must not change the other partner's comparison, and a
winner's gain must not change the loser's. Show night calls it once per
match, so the next match on the card sees this one's changes.

`match.simulate` returns it as `aftermath`, computed from the simulated
result: still no writes and no world RNG. `match.simulateBatch` leaves it out.

## Applying an aftermath

`applySegmentAftermath(step, segmentId)` in `aftermath/apply.ts` is show
night's applier (MTCH3-05 registers it with `registerSegmentResultApplier`).
MTCH3-05 registers it at order 30 (see [Integrations](#integrations)).
It runs after the segment's result and rating are written and reads the step's
transaction, so a worker in two matches on one card gets the second change on
top of the first.

For each competitor it records the `match.popularityGain` trace (id
`<segmentId>/<personId>`), calls `applyPopularityChange` with the region
weights and the delta, then, with a contract, records `match.momentumGain` and
calls `applyMomentumChange`. The reason key is `match.win`, `match.loss` or
`match.draw`; the label is "<Show name>: Beat Kara Voss". The source is
`player` on a human-run show, `ai` otherwise. Changes go through the doors
only, so the taper, limits, door traces and `popularity.changed` /
`momentum.changed` events are the same as for every other change.

A no contest, an angle and anyone not competing (ringside, interferers,
speakers, subjects) write nothing. **It never touches morale** (D-09): it does
not call the morale door, so losing a booked match, in a hot angle or not,
never upsets anyone through the aftermath.

## Stored aftermaths

Each applied competitor gets one `aftermaths` row (see
[data-model.md](data-model.md#aftermaths-aftermaths-aft_)) with the before
and after values the doors actually wrote, so results pages and Recent form
show exactly what moved even after the full trace has left the recent-traces
store (`sim.traceRetentionPerKind`): they then say "Full breakdown is only
kept for recent results" and still show the numbers.

The weekly `match.pruneAftermaths` phase (periodic group, order 40, Mondays)
keeps each worker's newest `match.aftermath.keepPerPerson` (10) rows: latest
date first, then the later row of the same day.

`match.aftermath { segmentId } | { eventInstanceId }` returns the stored rows
grouped by match in card order, with names, the show region's name, each
region's before and after, momentum, and the trace refs while the traces are
kept. Results are public: a row holds no morale and no contract terms, so
every viewer gets the same answer.

## Recent form

`match.recentForm { personId, limit? }` (`aftermath/recentFormQuery.ts`,
MTCH3-04) lists a worker's last `limit` run matches (1..10, 5 by default),
newest first: `priorMatchesOf` with today's matches included. Each row has
the show, date, promotion, the result from the worker's side, the opponents
by name, the win method and the booked finish, and the changes from the
worker's [stored aftermath](#stored-aftermaths): popularity in the show's
region (after − before) and momentum (after − before). A change is null when
the row was pruned or never written (a no contest writes none), and momentum
is null without a contract or when the match started it. The trace refs are
given only while the traces are kept. An unknown person is refused with
`notFound`. Results are public, so every viewer gets the same answer.

The worker profile shows it as the **Form** tab (order 55, wrestlers and
occasional wrestlers only) with the `RecentForm` component: a strip of
W / L / D / NC pills and a list with each match's changes and a Why? while
the breakdown is kept.

## The Match lab's Aftermath panel

The lab's Aftermath panel (`screens/match-lab/aftermath/`, MTCH3-04) shows
`match.simulate`'s `aftermath` for the night shown in full. It reads nothing
else from the engine, so it never asks about morale and shows none. One panel
per side carries the side's result; each worker shows popularity in the show's
region before → after with the change and a Why?, then momentum before →
after (or "No contract with <promotion>: momentum isn't tracked"). Below,
a table lists the show region, the neighbours behind a "Neighbouring regions
(n)" toggle (folded by default) and any reach rows. A neighbour's Why? is the
door's trace with the spread line spelled out: the match's change, "Share for
<region>" with its reason ("Neighbour of Northeast") and the taper and limits.
A Region / Country / Continent choice switches the table to the
population-weighted roll-ups, each with its own Why?; the choice is a viewer
convenience kept in memory, never in the save. With nine or more competitors
each worker's table opens on its own. When the setup changes after a Run the
panel says the numbers are out of date.

## Integrations

MTCH3-05 wires MTCH3 into the partners that were on `main` when it ran.
Partners that land later wire MTCH3 from their own packs.

| Partner                              | Status                  | How it is wired                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EVT3 (show night)                    | wired (MTCH3-05)        | The match bundle registers `match.aftermath` (`aftermath/showNight.ts`) with `registerSegmentResultApplier` at order 30: after EVT3-04's title outcome (10), before MTCH4 (40) and MTCH6 (50). Every match a real show runs, player and rival cards alike, moves its competitors' popularity and momentum by exactly what its `aftermaths` rows store; a worker in two matches gets both, in card order. Off-screen shows have no segments and write nothing. A throw rolls back the whole day's shows, as for every applier.                                    |
| EVT3 (results page)                  | wired (MTCH3-05)        | `registerResultsSection({ id: 'mtch3.aftermath', label: 'Popularity & momentum', order: 30 })` (`apps/web/src/screens/match-aftermath/`) reads `match.aftermath { eventInstanceId }`: one card per match, each competitor's show-region popularity and momentum before → after with the change and a Why? while the breakdown is kept, and an "Open in profile" link. Phones fold every match after the third behind its own toggle. It reuses the Match lab Aftermath panel's words (`aftermathText.ts`).                                                       |
| EVT5 (TV reach)                      | wired (MTCH3-05)        | The match bundle registers the `match.tvReach` reach provider (`aftermath/tvReach.ts`, order 10). For a show it takes EVT5's `reachInputsFor` → `showReach` and keeps only the TV regions, each at EVT5's TV weight for the network's tier × `match.popularity.tvSpill` (0.3; 0 turns it off), reason "TV reach: <network>". A Match lab match with Televised on uses the promotion's deals in force on the lab's date; Televised off, or no deal in force, reaches no TV region. The neighbours keep MTCH3's own `neighbourSpill`, and the largest weight wins. |
| WRK5 (drift, decay, momentum labels) | wires from its own pack | Momentum labels in the Aftermath panel and on Recent form rows, and the headless bounds check. Until WRK5's decay lands nothing pulls momentum back toward 0, so a busy worker's momentum runs to the ±100 limits within months.                                                                                                                                                                                                                                                                                                                                 |
| MTCH5 (angles)                       | wires from its own pack | Angle aftermath through `registerAftermathForKind('angle', fn)`; the applier still skips angles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ECO2 (star merch)                    | wires from its own pack | `merchStar` reads the popularity show night now moves; ECO2 adds the test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| DAY5 (awards)                        | wires from its own pack | The Breakout Star headless check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**Morale.** None of this reads or writes morale (D-09). Losing a booked
match, in a hot angle or not, changes popularity and momentum only.

**Save size.** Today no show in a headless run has a card (the rivals' shows
are scored off screen until AIP4), so a 365-day default-world run writes no
aftermath and its save is unchanged (8.9 MB). With every show given a card,
the aftermath adds about 8 MB over a year (25 MB → 34 MB), and stops growing
after a few months: the stored rows are pruned to 10 per worker, and each
trace kind keeps `sim.traceRetentionPerKind` full traces. The largest part is
WRK1's per-person popularity door trace (one per worker, one line per region
the worker is known in), then the `match.popularityGain` traces and the
stored rows. See the MTCH3-05 progress log for the figures.
