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
