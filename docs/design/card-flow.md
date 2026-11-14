# Card flow

What shapes a show's card and score beyond its segments (EVT4). The code lives
in `packages/engine/src/systems/cardFlow/`. EVT4-02 adds the production rules
below; EVT4-01's card flow scaffold (`adjust` modifiers for D-04's balance
lines) shares the system.

Both rules read `promotions.production`, the eight areas at levels 0..10
(`PRODUCTION_AREAS`). They apply to every show of every promotion, the
player's and the rivals', carded or scored off-screen. ECO7 lets the player
change the levels and shows these numbers on its Production screen; it does
not own either formula. Until ECO7 lands the levels are the world's starting
values.

## Production ceiling

"Production is a visible ceiling" (design-decisions.md, defaults): stage,
camera, editing and pyro set the highest score a show can be stored with.

    ceiling = clamp(production.ceilingBase
                    + stage   × production.ceilingWeight.stage
                    + camera  × production.ceilingWeight.camera
                    + editing × production.ceilingWeight.editing
                    + pyro    × production.ceilingWeight.pyro, 0, 100)

`formulas/productionCeiling.ts`. The defaults are 40, 1.5, 2, 1.5 and 1, so
every area at 10 gives exactly 100. The ceiling is never rounded. Music,
writing, marketing and back office do not enter it; ECO7 gives them other
jobs. The trace reads "Base ceiling", then one line per area such as
"Stage (level 8 × 1.5)", in that order.

On the default world: Altura (stage 8, camera 8, editing 7, pyro 8) has a
ceiling of 86.5 and Wattle (1, 1, 0, 0) 43.5.

**How it applies.** `cardFlow.productionCeiling` is a show score `cap` modifier
(order 10, see [show-night.md](show-night.md#seams)). Its `gather` reads the
promotion's four levels, so `apply` stays pure and the trace replays. `apply`
adds `min("Production ceiling", ceiling)` with the ceiling's own breakdown
under it, then "Production held the score back" (taken when the card earned
more). That is the last step of the show score's Why?. The off-screen score of
a rival show with no card runs the same `cap` modifiers through
`applyCapModifiers` (`systems/shows/showScoreModifiers.ts`), with the same
labels.

**What is stored.** `result.score` is the capped score, `result.rawScore` what
the card earned and `result.ceiling` the ceiling it was held to (null in saves
from before EVT4-02). The score is not rounded after the cap, so a 43.5
ceiling stores 43.5 and `score ≤ ceiling` always holds.

**Why keep the raw score.** The gap between the two is the reason to spend on
production: the results page can say the card earned 60 and production held
it to 43.5, and the bookings that earned the 60 still count for what reads the
raw score.

The `production.ceiling` query answers `{ ceiling, ceilingTrace, bonusSlot:
{ qualifies, threshold, minImportance, trace } }` for a promotion. Its optional
`levels` override the stored ones (ECO7's change dialog shows the after-value
with them). Production levels are public, so any viewer may ask about any
promotion; the traces come back inline and nothing is recorded.

The Production screen shows the ceiling through ECO7's effect seam: the effect
`cardFlow.showCeiling` (`systems/cardFlow/productionEffect.ts`, ECO7-04) adds
"Shows can score up to 47 (90 earns an extra main-card slot)" with this trace
to the stage, camera, editing and pyro rows, and a before → after row to the
change dialog. See `production.md#effects`.

## Bonus slot

D-10: bigger production budgets unlock an extra segment slot.
`formulas/bonusSlot.ts`, a decision ("Bonus slot") with three rules, checked in
order and stopping at the first that fails:

1. The show is at least `production.bonusSlotMinImportance` (default regular,
   in `EVENT_IMPORTANCES` order).
2. The promotion's production ceiling (its trace attached) reaches
   `production.bonusSlotThreshold` (default 90).
3. The show has fewer than 12 main slots (`SHOW_SLOTS_MAX`: the show format
   allows 3 to 12 main slots).

All pass: the show gets one extra main-card slot; the pre-show is never
touched. Nobody on the default world starts at 90 (Altura is 86.5), so every
opening show has its definition's slots. Keep the threshold above 86.5, or
Altura's weekly shows get 7 slots and the "6 main slots" owner steps change.

**Newly scheduled shows.** The calendar's scheduler runs every registered
scheduled-format adjuster (`systems/calendar/formatAdjusters.ts`) right before
it stores a show, at new-game setup (step 810) and in the daily
`calendar.extendHorizon`. `cardFlow.bonusSlot` is one: it sets `format.slots`
from the decision and records the decision as `production.bonusSlot` under
the new show's id, for regular-or-bigger shows only (a house show's "no" says
nothing). With no adjuster registered a show gets its definition's format.
EVT8's re-sync must keep calling the adjusters when it builds a show's fields.

**Refreshing unbooked shows.** Without a refresh, a production upgrade would
take the whole 90-day horizon to reach the shows already stored. The daily
`cardFlow.refreshBonusSlots` phase (`housekeeping`, order 26) looks at every
show that is `scheduled`, comes from a definition, is dated after today and
has no segment yet, and gives it its definition's slots plus the bonus when
the decision changed, recording the new decision. It never touches a card the
booker has started, nor a slot count this rule did not set. It works out each
promotion's ceiling once per day and builds a trace only for a show it changes,
so it stays cheap on long skips.
