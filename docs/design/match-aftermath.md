# Match aftermath

What a match result does to the people in it once the bell rings: who gets more
popular, who loses ground. A result that changes nothing makes booking
pointless, so a nobody who beats the top star should get noticeably more
famous, and a star who loses to a nobody should pay for it (MTCH3).

This doc so far covers the one formula that decides what a single result is
worth to one competitor. Spreading that change to neighbouring regions and TV
reach (MTCH3-03), momentum gains and win streaks (MTCH3-02) and the Match lab's
Aftermath tab (MTCH3-04) build on it.

Code: the formula in
`packages/engine/src/systems/match/aftermath/formulas/popularityGain.ts` and
its tunables in `packages/engine/src/systems/match/aftermath/tunables.ts`.

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

- MTCH3-02: momentum changes and the win streak count fed into `priorWinStreak`.
- MTCH3-03: spreading this region's change to neighbours and TV reach; the
  neighbouring region's Why? reads "this match's change × spill × taper".
- MTCH3-04: the Match lab's Aftermath tab shows these lines.
