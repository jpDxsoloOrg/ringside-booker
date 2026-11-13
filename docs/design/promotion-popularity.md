# Promotion popularity after shows

A promotion's fan base is its popularity in each region (`promotions.regionalPop`,
0 to 100 per region, sparse). Once show night gives every completed show a
score (see [show-night.md](show-night.md)), that score moves the promotion's
popularity in every region that saw the show. This doc describes the three
formulas that decide the change for one show, one promotion and one region
(EVT5-01), and how they run after every show and write the result
([After every show](#after-every-show), EVT5-02).

The formulas live in `packages/engine/src/systems/promoPop/formulas/`. They are
pure: plain inputs in, a `Traced<number>` (or a list of them) out, no world
access, no rolls. Every balance number is a `promoPop.*` tunable (listed in
[tunables.md](tunables.md#promotion-popularity-tunables)), and setting one to 0
removes exactly the effect its description names.

The rules they follow:

- **Against expectations (D-02).** The change comes from how the show scored
  against what that region's fans expected, not from raw popularity. Fans
  expect more from a company they already like, so big companies have to
  deliver to grow, and a small company can win fans with a good show.
- **One regional model (D-03).** Everything works per region. Country and
  continent figures are population-weighted roll-ups computed when they are
  read, never stored (see [geography.md](geography.md)).
- **Smooth, not banded.** The response grows in a straight line with the
  margin, gains shrink smoothly as popularity rises, and losses shrink smoothly
  where there are few fans to lose. No table of bands, so one point of score
  never makes a jump.
- **No flat floor.** There is no minimum gain or loss. A tiny change stays
  tiny; a floor would swamp everything else for small local shows and make
  every show worth something whatever happened in it.
- **One formula for everyone.** Player shows and rival shows use exactly the
  same formulas and tunables.
- **No minutes, no randomness.** The change is fixed by the score.

## Show reach

`showReach(inputs, { tunables })` lists the regions a show reached and how much
of it each one saw, as a weight from 0 to 1.

Inputs: the show's region, its neighbours (`regions.neighbourRegionIds`) and the
TV deals in force that carry the show, each with its network's reach tier and
the regions it covers (none for an untelevised show).

A region can be reached three ways:

1. **Show region.** The region the show takes place in sees all of it: weight 1.
2. **Neighbour.** A neighbouring region sees part of it:
   `promoPop.neighbourReach` (0.5).
3. **TV.** Every region a deal in force covers sees it at the network's reach
   tier: `promoPop.tvReach.tier0` to `.tier4` (0.1, 0.2, 0.3, 0.45, 0.6).

Each region's weight is its own trace. It starts at 0 ("Not reached"), takes
each route that reached the region as a floor ("Neighbour of Texas × 0.5",
"TV: National Signal Network, reach tier 4 × 0.6"), so the strongest route
wins, notes "Reached several ways: the strongest counts" when there was more
than one, and is capped at 1 ("Full reach"). The show region is always 1, even
when it is also a neighbour or on TV. A region whose weight comes to 0 is left
out, so `neighbourReach` 0 removes neighbours that are not also on TV.

**Why the largest and not the sum.** Seeing a show on TV in a neighbouring
region does not mean seeing it twice. Adding the routes would let a region next
door to a televised show count for more than the region the show was in, and
would reward stacking deals over running good shows.

The list comes back with the show region first, then by weight (largest first),
then by region id, so it is stable. Each row carries the strongest route
(`source`: `show`, `neighbour` or `tv`; the network for TV) and its words
("Show region", "Neighbour of Texas", "TV: National Signal Network") from
`reachLabel` in `formulas/labels.ts`, which the web results page uses too.

## Region expectation

`regionExpectation(inputs, { tunables })` is the show score fans in one region
expected, 0 to 100.

1. Start at 0 ("Nothing expected yet").
2. Add the popularity part: popularity here × `promoPop.expect.popularityWeight`
   (0.6), × the event size factor `promoPop.expect.importance.<importance>`
   (house 0.8, minor 0.9, regular 1, major 1.15, flagship 1.3). A region where
   the promotion has no stored popularity counts as 0.
3. Add the prestige part: prestige × `promoPop.expect.prestigeWeight` (0.2).
4. Multiply by hype when it is tracked ("Hype: fans expect more × 1.1").
   Until ECO3 lands, hype is null and the trace says "Hype isn't tracked yet";
   EVT5-04 passes ECO3's multiplier.
5. Keep the result within 0 to 100 ("Expectations stay within 0–100").

Event size scales only the popularity part: fans who already like a company
expect more of its big nights, while prestige is the company's name and holds it
to the same standard at any show.

## Show popularity change

`showPopularityChange(inputs, { tunables })` is the change in popularity, in
points, in one region from one show. Inputs: the region's name, the show's
score, the region's expectation (traced), the popularity there before the show,
the region's reach weight (traced) and its words, the event's importance, and
how much the promotion has already gained there this calendar month.

1. **Margin.** Score minus expectation: "Scored 75 against an expected 61: +14".
2. **Dead zone.** When the margin is within `promoPop.deadZone` (3) either way,
   the show was about what fans expected and nothing changes. The trace shows
   the margin and the line "About what fans expected (within ±3)".
3. **Strength.** How far past the dead zone, as a share of the way to a
   blowout: `(|margin| − deadZone) ÷ (blowoutMargin − deadZone)`, kept within
   0 to 1, with `promoPop.blowoutMargin` 25. A margin of 25 or more counts in
   full. When the blowout margin is not above the dead zone, any result outside
   the dead zone counts in full (and nothing is divided by 0).
4. **Base change.** A gain is strength × `promoPop.maxGainPerShow` (3), "Beat
   expectations by 14"; a loss is strength × `promoPop.maxLossPerShow` (2.5),
   "Fell short of expectations by 16".
5. **Event size.** × `promoPop.impact.<importance>` (house 0.4, minor 0.7,
   regular 1, major 1.3, flagship 1.6): "Event size: Regular × 1".
6. **Reach.** × the region's weight from [show reach](#show-reach), with that
   trace nested: "Seen here as: TV: National Signal Network".
7. **Gains only: diminishing returns.** ×
   `(1 − popularity ÷ 100) ^ promoPop.diminishingPower` (1.5): "Diminishing
   returns at popularity 75". The more of a region's fans a company already
   has, the fewer are left to win, so a giant barely grows from one good show
   while a small company grows visibly. `diminishingPower` 0 turns this off.
8. **Losses only: fans to lose.** × `min(1, popularity ÷ promoPop.lossFullFrom)`
   (25): "Few fans to lose here (popularity 8)". A company with few fans in a
   region has few to lose there, so a bad show cannot wipe out a small
   company's foothold. `lossFullFrom` 0 means losses are never scaled down
   ("Losses not scaled").
9. **Gains only: the monthly cap** (see [below](#monthly-cap)).
10. **Bounds.** The change is kept so that popularity before plus the change
    stays within 0 to 100 ("Popularity stays within 0–100").

The formula does not round. The popularity door that EVT5-02 writes through
(WRK1's `applyPopularityChange`, see [workers.md](workers.md#popularity-door))
clamps the stored value to 0 to 100 and stores it to two decimals.

## Monthly cap

A promotion can gain at most `promoPop.monthlyGainCap` (3) points of popularity
in one region in one calendar month, from all its shows together. The formula
takes what was already gained there this month and caps the gain at what is
left, `max(0, cap − gained)`: "Monthly gain cap: 0.4 of 3 used", or "Monthly
gain cap reached" when nothing is left (the gain is then 0). The cap stops a
run of good shows, or a weekly TV show in a big market, from snowballing a
company to the top of a region in a few months. Losses are never capped by it.
`monthlyGainCap` 0 means no gains at all. EVT5-02 keeps the month's running
total per promotion and region.

## Worked examples

With the default tunables.

**A big company's strong regular show in its home region.** Popularity 75,
prestige 80, a regular show, weight 1 (show region).

- Expectation: 75 × 0.6 × 1 = 45, plus 80 × 0.2 = 16, so fans expect **61**.
- Score 75: margin +14. Strength (14 − 3) ÷ 22 = 0.5, so the base gain is
  0.5 × 3 = 1.5. Regular × 1, reach × 1. Diminishing returns:
  (1 − 0.75)^1.5 = 0.125, so 1.5 × 0.125 = 0.1875. Well under the monthly cap.
  Change **+0.19**: popularity 75 → 75.19.
- Score 45 instead: margin −16. Strength 13 ÷ 22 ≈ 0.591, so the base loss is
  ≈ 1.477. Regular × 1, reach × 1, and with popularity 75 above 25 the loss is
  not scaled down. Change **−1.48**: popularity 75 → 73.52.

The giant barely gains from a good show and visibly loses from a weak one.

**A small company's minor show in its home region and a neighbour.**
Popularity 20 at home and none next door, prestige 28, a minor show scoring 50.

- Home region: expectation 20 × 0.6 × 0.9 = 10.8, plus 28 × 0.2 = 5.6, so
  **16.4**. Margin +33.6 is past the blowout margin, so the full 3. Minor × 0.7
  = 2.1, reach × 1, diminishing returns (1 − 0.2)^1.5 ≈ 0.716. Change
  **+1.50**: popularity 20 → 21.50. Had the company already gained 2.96 there
  this month, the cap would leave only **+0.04**.
- Neighbouring region, weight 0.5: nobody knows the company, so fans expect
  only the prestige part, **5.6**. Margin +44.4, the full 3. Minor × 0.7 = 2.1,
  reach × 0.5 = 1.05, and with popularity 0 nothing diminishes. Change
  **+1.05**: the company gains its first fans next door.

## After every show

The `promoPop` system (`systems/promoPop/index.ts`, EVT5-02) runs the formulas
for real. Its reaction `promoPop.applyAfterShow` listens to `show.completed`,
so it runs for player and rival shows alike, including rival shows scored off
screen, right after show night and before the settlement group. Each reaction
has its own transaction: if it fails, only that show's popularity is rolled
back, the failure goes to the failure log and the day goes on.

For one show (`applyShowPopularity`):

1. **Skip** with a log line, writing nothing, when the show is not completed,
   has no result, its promotion is not active, or it already has a record (so
   `show.completed` arriving twice changes nothing twice).
2. **Reach.** `reachInputsFor` reads the show's region, its neighbours and the
   TV deals in force (`dealsInForce`): the promotion's active deals that have
   started by the show's air date and not yet ended, on a network still on
   air, bound to the show's definition or promotion-wide for a televised
   definition. A taped show is reached from where it was taped and carried by
   the deals in force on its air date. Both helpers are exported for ECO8 and
   EVT6.
3. **Each reached region, most populous first:** popularity before (0 when
   none is stored), the [expectation](#region-expectation) (hype is null until
   ECO3) and the [change](#show-popularity-change), with this month's gains
   from `promotions.popularityGains` (empty when the stored month is another
   one).
4. **One door call.** Every non-zero change goes to WRK1's popularity door in
   one call with `regionDeltas` ([workers.md](workers.md#popularity-door)), with
   source `system` and reason `show.result` (the show's name for the player).
   The door clamps, stores two decimals, records its trace and publishes
   `popularity.changed`, exactly as for any other popularity change.
5. **The month's tally.** Each region that went up adds what the door actually
   stored (`after − before`) to `popularityGains.byRegion`; a new month starts
   a new tally. Losses never touch it.
6. **The record.** One `popularityShowChanges` row
   ([data-model.md](data-model.md#popularity-show-changes-popularityshowchanges-psc_))
   lists every reached region, changed or not, with its source, weight,
   expectation, the values the door stored and whether the monthly cap cut the
   gain, plus the worldwide figure before and after.
7. **Why? traces.** One per reached region at
   `{ kind, id: '<eventInstanceId>/<regionId>' }`: the region's change, with
   its reach and expectation nested. `kind` is `promoPop.showChange` for a
   human-run promotion and `promoPop.rivalShowChange` for a computer-run one,
   because rival shows reach hundreds of regions a week and
   `sim.traceRetentionPerKind` counts per kind: sharing one kind would push the
   player's own Why? panels out within days. The stored record keeps the
   numbers after the full trace has gone.
8. **The event** `showPopularity.changed` (always, even when nothing moved):
   ids, the worldwide figure before and after, and how many regions went up,
   went down and had a gain cut by the cap.

Nothing else changes: no morale, momentum, prestige or cash, and no rolls.

**Same-day consumers.** Anything that settles the same show later that day
(EVT6 attendance) must read the popularity before the show with
`popularityBeforeShow(read, eventInstanceId, regionId)`, not `regionalPop`.
`recentShowChanges(read, promotionId, limit)` lists a promotion's latest shows
with their worldwide change, and `monthlyGainsOf(read, promotionId, date)` reads
this month's tally.

**Keeping the records.** On the 1st of each month the
`promoPop.pruneShowChanges` phase (periodic group) deletes records of shows
more than `promoPop.keepShowChangesDays` (365) days before that day. 0 keeps
none past the 1st.

### `popularity.showChange`

`popularity.showChange { eventInstanceId }` answers what one show did. Promotion
popularity is public, so every viewer gets the same answer, rival shows
included; nothing private (money, morale) is in it. An unknown show is refused
with `notFound`.

- `status`: `applied` (the record is there), `notCompleted` (the show has not
  run), `pruned` (it ran before the last prune's cutoff and its record is gone)
  or `notApplied` (it ran but nothing was stored, for example because its
  promotion was not active). Only `applied` has a `summary` and `countries`.
- `summary`: regions gained, lost, unchanged and capped, and the world's
  before, after and change, with the change's trace (the population-weighted
  mean of every region's change, untouched regions counting 0).
- `countries`: each country with a reached region, largest change first, with
  its population-weighted change and trace (`aggregateByCountry`, untouched
  regions counting 0), and its regions: the show region first, then the largest
  change, then by name. Each region has its source and words ("Show region",
  "Neighbour of Texas", "TV: National Signal Network"), weight, expectation,
  before, after, change, whether it was capped, and `traceRef` (null once the
  full trace is no longer kept).
