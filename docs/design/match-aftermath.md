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
- MTCH3-03: spreading this region's change to neighbours and TV reach; the
  neighbouring region's Why? reads "this match's change × spill × taper".
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
