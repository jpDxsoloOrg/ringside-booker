# Production

Production (ECO7) turns a promotion's eight production levels into a choice
with visible trade-offs. Raising a level costs a one-time **upgrade fee**;
every level carries a running cost, either a **monthly overhead** or a
**per-show cost**; and low marketing or back office sets a **popularity
ceiling** the promotion's regional popularity cannot stay above.

Code: `packages/engine/src/systems/production/` (system id `production`).
ECO7-01 ships the area tables, the tunables and the pure traced formulas.
ECO7-02 adds changing a level (the upgrade fee is the first production money
posted), the screen and dialog queries and the effect seam. ECO7-03 posts the
monthly overhead, ECO7-05 posts the per-show costs (and a temporary rival
budget until AIP8), and ECO7-04 puts it on screen. Production never rolls, so
the system has no RNG stream.

All money is in whole cents. Every tunable is 0-means-0: a price of 0 makes
that area free, a multiplier of 0 makes that kind of show free, and a floor of
0 drops the floor. Nothing falls back to a default.

The **show-quality ceiling** and the **bonus slot** that stage, camera,
editing and pyro feed belong to EVT4 (system `cardFlow`, keys
`production.ceilingBase`, `production.ceilingWeight.*`,
`production.bonusSlotThreshold`, `production.bonusSlotMinImportance`). They
share the `production.` key prefix with this doc's keys but are documented with
EVT4's show-night work.

## Areas

Each promotion stores eight areas, each a whole level from 0 to 10
(`ProductionSchema` in `model/entities/promotion.ts`). `areas.ts` says what the
player reads for each one, how it is paid for and where its money goes in the
books:

| Area       | Label       | Paid     | Ledger category |
| ---------- | ----------- | -------- | --------------- |
| stage      | Stage       | per show | production      |
| camera     | Camera      | per show | production      |
| editing    | Editing     | per show | production      |
| pyro       | Pyro        | per show | production      |
| music      | Music       | monthly  | production      |
| writing    | Writing     | monthly  | production      |
| marketing  | Marketing   | monthly  | marketing       |
| backOffice | Back office | monthly  | backOffice      |

`PER_SHOW_AREAS` and `MONTHLY_AREAS` list them in `PRODUCTION_AREAS` order.

What each area does in play: the four per-show areas feed EVT4's show-quality
ceiling; writing feeds the angle writing band (MTCH5); marketing feeds hype
(ECO3) and viewers (ECO8) as well as the ceiling below; back office feeds merch
(ECO2) and the ceiling below. Music has no effect in any planned feature yet.

## Area costs

One smooth power curve over the full 0..10 scale, with a price per area:

- **curve** = (level ÷ 10) ^ `production.costCurve`: 0 at level 0, 1 at level 10. At the default of 3, low levels are cheap and the top levels dear; at 1
  the cost is a straight line.
- **cost** = curve × the area's price at level 10, rounded to the cent. The
  price is `production.showCost.<area>` (one regular show) for stage, camera,
  editing and pyro, and `production.monthlyCost.<area>` (one month) for music,
  writing, marketing and back office.
- A per-show area is also multiplied by the show's importance (see
  [per-show costs](#per-show-costs)). A monthly area ignores importance and its
  Why? says so ("Monthly cost: show importance does not apply").

The Why? reads: "Camera level 4 of 10", "0.4 raised to the power 3 = 0.064
(Cost curve)", "Camera at level
10: $150,000 per regular show", "Minor show × 0.5", for $4,800.

`productionMonthlyCost` adds the four monthly areas, one line each ("Marketing
(level 8)"), and returns the same total split by ledger category (`production`,
`marketing`, `backOffice`) so each category is posted as its own ledger row
with its own Why?.

| Key                                 | Kind    | Default     | Range            | Unit        | Meaning                                                   |
| ----------------------------------- | ------- | ----------- | ---------------- | ----------- | --------------------------------------------------------- |
| `production.costCurve`              | number  | 3           | 1–5              | ratio       | How steeply production costs rise with level; 1 is a line |
| `production.showCost.stage`         | integer | 12,000,000  | 0–10,000,000,000 | money       | Stage at level 10, one regular show ($120,000)            |
| `production.showCost.camera`        | integer | 15,000,000  | 0–10,000,000,000 | money       | Camera at level 10, one regular show ($150,000)           |
| `production.showCost.editing`       | integer | 10,000,000  | 0–10,000,000,000 | money       | Editing at level 10, one regular show ($100,000)          |
| `production.showCost.pyro`          | integer | 6,000,000   | 0–10,000,000,000 | money       | Pyro at level 10, one regular show ($60,000)              |
| `production.monthlyCost.music`      | integer | 50,000,000  | 0–10,000,000,000 | money/month | Music at level 10, each month ($500,000)                  |
| `production.monthlyCost.writing`    | integer | 25,000,000  | 0–10,000,000,000 | money/month | Writing at level 10, each month ($250,000)                |
| `production.monthlyCost.marketing`  | integer | 120,000,000 | 0–10,000,000,000 | money/month | Marketing at level 10, each month ($1,200,000)            |
| `production.monthlyCost.backOffice` | integer | 100,000,000 | 0–10,000,000,000 | money/month | Back office at level 10, each month ($1,000,000)          |

Worked numbers at the defaults:

- **Hardpan** (music 1, writing 2, marketing 1, back office 1): music $500 +
  writing $2,000 = production $2,500; marketing $1,200; back office $1,000;
  **$4,700 a month**.
- **Altura** (music 7, writing 7, marketing 8, back office 7): $171,500 +
  $85,750 + $614,400 + $343,000 = **$1,214,650 a month**.

### Monthly overhead

Phase `production.monthlyOverhead` (`money` group, order 35, after payroll and
medical; the 1st of each month). Each **active** promotion, the player's and
every rival's alike, pays `productionMonthlyCost` at the levels it has that
morning, as up to three ledger rows dated the 1st: **Production** (music and
writing), **Marketing** and **Back office**, with memos such as "Production
overhead for February 2026". Each row's Why? lists the areas behind it
("Music (level 1)", "Writing (level 2)"). A category at 0 posts nothing; a
dormant or closed promotion pays nothing. The month's total is also kept as a
trace (`production.monthlyOverhead`, id the promotion; only a summary for a
computer-run promotion) for the Production screen's "last charged" line.

The overhead is paid for the month ahead. Lowering a level on the 31st and
raising it again on the 2nd would dodge a month's overhead, but the raise costs
the [upgrade fee](#upgrade-fee), which is what the fee is for.

## Upgrade fee

Lowering or keeping a level is free. Raising an area from one level to another
costs its fee for the whole climb from 0 to 10 (`production.upgradeFee.<area>`)
× (curve(to) − curve(from)), on the same curve as the running costs.

Each end is worked out and rounded to the cent on its own (the fee for 0 → to,
less the fee for 0 → from), so fees telescope exactly: 2 → 3 then 3 → 4 costs,
to the cent, what 2 → 4 costs. Nobody saves or loses money by raising a level
in steps.

Camera 2 → 4: curve at 4 is 0.064, curve at 2 is 0.008; camera's fee for 0 →
10 is $500,000; $32,000 − $4,000 = **$28,000**.

| Key                                | Kind    | Default    | Range            | Unit  | Meaning                                        |
| ---------------------------------- | ------- | ---------- | ---------------- | ----- | ---------------------------------------------- |
| `production.upgradeFee.stage`      | integer | 60,000,000 | 0–10,000,000,000 | money | Fee for raising stage from 0 to 10 ($600,000)  |
| `production.upgradeFee.camera`     | integer | 50,000,000 | 0–10,000,000,000 | money | Same, camera ($500,000)                        |
| `production.upgradeFee.editing`    | integer | 40,000,000 | 0–10,000,000,000 | money | Same, editing ($400,000)                       |
| `production.upgradeFee.pyro`       | integer | 25,000,000 | 0–10,000,000,000 | money | Same, pyro ($250,000)                          |
| `production.upgradeFee.music`      | integer | 30,000,000 | 0–10,000,000,000 | money | Same, music ($300,000)                         |
| `production.upgradeFee.writing`    | integer | 20,000,000 | 0–10,000,000,000 | money | Same, writing ($200,000)                       |
| `production.upgradeFee.marketing`  | integer | 15,000,000 | 0–10,000,000,000 | money | Same, marketing ($150,000)                     |
| `production.upgradeFee.backOffice` | integer | 15,000,000 | 0–10,000,000,000 | money | Same, back office ($150,000)                   |
| `production.feeNeedsCash`          | boolean | true       |                  | flag  | An upgrade fee must be covered by cash in hand |

`production.feeNeedsCash` is read by the change check (see
[Changing a level](#changing-a-level)), not by the formula.

## Popularity ceiling

How popular a promotion can stay in any region, set by what it spends on
marketing and back office:

ceiling = `production.popularityCeiling.base` + marketing level ×
`perMarketingLevel` + back office level × `perBackOfficeLevel`, kept within 0
to 100. Not rounded.

At the defaults: Hardpan (1, 1) = **30**, Wattle (1, 0) = 25, Boreal (4, 4) =
60, Altura (8, 7) = **95**. No promotion in the default world starts above its
ceiling in any region (a test checks this and names the promotion and region if
a tuning change breaks it), so the drag does nothing until the player lowers
marketing or back office.

| Key                                               | Kind   | Default | Range | Unit   | Meaning                                      |
| ------------------------------------------------- | ------ | ------- | ----- | ------ | -------------------------------------------- |
| `production.popularityCeiling.base`               | number | 20      | 0–100 | points | Ceiling with no marketing and no back office |
| `production.popularityCeiling.perMarketingLevel`  | number | 5       | 0–20  | points | Ceiling added by each marketing level        |
| `production.popularityCeiling.perBackOfficeLevel` | number | 5       | 0–20  | points | Ceiling added by each back office level      |

## Popularity drag

A region above the ceiling loses some of the excess each day. excess =
popularity − ceiling. At or under the ceiling there is no drag ("At or under
the ceiling: no drag"). Above it, the drag is excess ×
`production.popularityDrag.fractionPerDay`, at least
`production.popularityDrag.minPerDay`, and never more than the excess, so the
drag never pulls popularity below the ceiling. The formula returns the positive
amount to remove; its Why? nests the ceiling's own Why?.

Hardpan at 50 in a region against its ceiling of 30: 20 × 0.02 = 0.4 a day. At
31: 1 × 0.02 = 0.02, raised to the 0.05 floor. At 30.01: the floor would cross
the ceiling, so only 0.01 goes.

Phase `production.popularityDrag` (`growth` group, order 90, daily) applies it.
For each active promotion it works out the ceiling once, finds every region
above it, and makes **one** popularity door call with each region's own drag
(`regionDeltas`), so the event log gets one `popularity.changed` (reason
`production.popularityDrag`, "Marketing and back office can't support this
popularity") per promotion per day, whatever the number of regions. Each
region's line reads "Production popularity drag in <region>" and nests the
drag's Why?. Popularity is stored to two decimals; when the ceiling is not a
whole hundredth, the loss stops at the lowest stored value above it, so the
drag never leaves a region below its ceiling. (The door's own drop rule still
removes a region that falls under `workers.popularity.dropBelow`, which only
matters with a ceiling near 0.) At or under the ceiling nothing happens. Every
promotion in the default world starts at or under its ceiling, so the drag
bites when marketing or back office are lowered, or when show results push
popularity past the cap.

| Key                                        | Kind   | Default | Range | Unit       | Meaning                                                    |
| ------------------------------------------ | ------ | ------- | ----- | ---------- | ---------------------------------------------------------- |
| `production.popularityDrag.fractionPerDay` | number | 0.02    | 0–1   | ratio      | Share of the popularity above the ceiling lost each day    |
| `production.popularityDrag.minPerDay`      | number | 0.05    | 0–10  | points/day | Least lost each day while above the ceiling (0 = no floor) |

## Per-show costs

One show's production cost is the sum of the four per-show area costs at the
show's importance, one line per area. A show with all four at level 0 costs
nothing and says so ("No paid production on this show"). `upcomingShowCost`
adds the shows in a coming window, one line per show ("Hardpan Friday, 8 Jan
(minor)"), each nesting its show's Why?; an empty window is 0 with "No shows in
the window".

Worked numbers at the defaults:

- **Hardpan Friday** (minor; stage 1, camera 2, editing 1, pyro 0): $60 + $600
  - $50 + $0 = **$710**. With camera raised to 4: $60 + $4,800 + $50 =
    **$4,910**.
- **Altura, a regular show** (stage 8, camera 8, editing 7, pyro 8): $61,440 +
  $76,800 + $34,300 + $30,720 = **$203,260**.

| Key                                      | Kind   | Default | Range | Unit       | Meaning                                            |
| ---------------------------------------- | ------ | ------- | ----- | ---------- | -------------------------------------------------- |
| `production.showCostMultiplier.house`    | number | 0.25    | 0–10  | multiplier | Stage, camera, editing and pyro × this, house show |
| `production.showCostMultiplier.minor`    | number | 0.5     | 0–10  | multiplier | Same, minor show                                   |
| `production.showCostMultiplier.regular`  | number | 1       | 0–10  | multiplier | Same, regular show                                 |
| `production.showCostMultiplier.major`    | number | 1.5     | 0–10  | multiplier | Same, major show                                   |
| `production.showCostMultiplier.flagship` | number | 2.5     | 0–10  | multiplier | Same, flagship show                                |

Balance is a first guess. Altura spends about $1.2M a month on overhead plus
about $200,000 per regular show, against $40M cash and TV fees of over $1M per
Mainstage; Hardpan spends $4,700 a month plus $710 per Friday against $85,000.
If payroll leaves local promotions bleeding, tune `production.monthlyCost.*`
down; the curve keeps low levels cheap.

### Posting per-show costs

ECO7-05: the reaction `production.showCosts` on `show.completed` charges every
completed show, the player's and every rival's (on screen or off it, D-01), at
the promotion's levels when the show completes: one ledger row, category
Production, memo "Show production: Hardpan Friday", `refs.eventInstanceId` set
to the show, with the show's cost as its Why? (one line per area, then "Cost").
A rival's row keeps only a summary, like every rival ledger row (POL4-06). A
show whose four areas are all at 0 posts nothing, a cancelled show never
completes so it costs nothing, and a show already charged is skipped, so a show
the player runs before the day is never charged twice. The results page's
Show money section and the Finances ledger pick the row up from the ledger;
there is no second Production line.

## Rival production budget

**Temporary (ECO7-05), until AIP8's rival production desk.** Without it,
computer-run promotions keep the levels the world started them with, and the
monthly overhead plus per-show costs push the small ones into debt within a
year. Phase `production.rivalBudget` (`money`, order 33, monthly on the 1st,
before the overhead) looks at each active computer-run promotion's cash against
a month of its production costs (the overhead plus the per-show cost of its
shows in the next `production.forecastDays`):

- **Short of cash** (less than `lowerBelowMonths` months): it lowers one level
  at a time until the cash covers that many months or nothing more can go.
  First the cuts that hurt nothing: music and writing (no effect yet), and
  room a ceiling has to spare (the show-quality ceiling above its best show in
  the last `lookbackDays` plus `headroom`, the popularity ceiling above its
  best region plus `headroom`), biggest saving first. Cuts that lower a
  ceiling it is using wait until the cash covers less than
  `deepCutBelowMonths` months; then the least harm per dollar saved goes
  first.
- **Plenty of cash** (at least `raiseAboveMonths` months of the cost after the
  change, plus the fee): it raises one level a month, only where a ceiling is
  holding it back, the most relief per dollar first. Music and writing are
  never raised.

Every change goes through `changeProductionLevel` with source `'ai'`: rivals
pay the same upgrade fee (a hidden rival ledger row), and the TV-deal camera
minimum holds for them too. The player's promotions are never touched. It is
a decision rule, not a Rival rules shortcut, so the Level playing field
setting does not turn it off. A months tunable at 0 turns that half off. AIP8
deletes the phase and these keys when its business review sets levels.

On the default world over 365 days (player's shows run by the test helper),
no rival ends more than about $10,000 in debt: Golden Poppy ends at +$15,000
(−$746,000 without the budget), Tessen +$2.8M (−$57,000), Blast Furnace
+$186,000 (−$134,000), Hibari +$9,000 (−$43,000), Hardpan −$8,000 (−$64,000),
Wattle −$6,000 (−$2,500; it loses popularity once marketing goes).

| Key                                         | Kind    | Default | Range | Unit   | Meaning                                                             |
| ------------------------------------------- | ------- | ------- | ----- | ------ | ------------------------------------------------------------------- |
| `production.rivalBudget.lowerBelowMonths`   | number  | 12      | 0–60  | months | Cash below this many months of production costs: cut (0 = never)    |
| `production.rivalBudget.deepCutBelowMonths` | number  | 6       | 0–60  | months | Below this, also cut levels that lower a ceiling in use (0 = never) |
| `production.rivalBudget.raiseAboveMonths`   | number  | 24      | 0–120 | months | Cash covering this many months after a raise: raise (0 = never)     |
| `production.rivalBudget.headroom`           | number  | 5       | 0–100 | points | Room kept between the best recent show or region and its ceiling    |
| `production.rivalBudget.lookbackDays`       | integer | 28      | 1–365 | days   | How far back the best show is looked for                            |

## TV camera minimum

While a promotion has an active broadcast deal, its camera level may not go
below `production.tvDealMinCamera`: a network will not air a show nobody
filmed. The change check enforces it for everyone, the player's command and the
rival desk alike (AIP8 keeps its own `aip.production.cameraFloorWithTv` as a
target, never below this one).

`activeBroadcastDeal(read, promotionId, date)` finds the deal: a `deals` row of
the promotion with status `active` that runs on the date (`startsOn` ≤ date <
`endsOn`, since `endsOn` is the first day the deal no longer runs), lowest id
first. Any network kind counts: TV, pay-per-view and streaming all need
cameras. Deal fees are not read. Raising camera is never refused for a deal,
and a camera already below the minimum may stay there.

The refusal names the network and the deal's last day: "You have an active TV
deal with Channel 9 until Sun 1 Feb: camera can't go below level 1". The
overview's camera row has `minLevel` 1 and the line "TV deal with Channel 9:
camera stays at 1 or higher" for the promotion's own management only; whether
a rival has a deal is ECO8's to show.

| Key                          | Kind    | Default | Range | Unit   | Meaning                                              |
| ---------------------------- | ------- | ------- | ----- | ------ | ---------------------------------------------------- |
| `production.tvDealMinCamera` | integer | 1       | 0–10  | points | Lowest camera level allowed while there is a TV deal |

## Changing a level

`checkLevelChange(read, { promotionId, area, level }, tunables, date)` works
out the upgrade fee and every reason the change is not allowed. Both
`production.setLevel` (its `validate`) and `production.changePreview` use it,
so the change dialog never promises a change the command refuses.

| Code                          | When                                                                | Message                                                         |
| ----------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `production.promotionClosed`  | the promotion is not `active`                                       | "Hardpan has closed"                                            |
| `production.outOfRange`       | the level is outside 0–10                                           | "Camera levels run from 0 to 10"                                |
| `production.sameLevel`        | the level is the current one                                        | "Camera is already at level 4"                                  |
| `production.tvDealCamera`     | camera below `production.tvDealMinCamera` while a deal runs         | "You have an active TV deal with … until …: camera can't go …"  |
| `production.cannotAfford`     | `production.feeNeedsCash` is true and the fee is more than the cash | "The fee is $28,000 and you have $20,000"                       |
| `production.notYourPromotion` | (command and preview only) the issuer or viewer does not run it     | "Only the promotion's own management can change its production" |

`changeProductionLevel(ctx, { promotionId, area, level, source })` is the only
code that writes `promotions.production`. It re-runs the check and throws on
any reason, so a buggy caller's step rolls back. A fee above 0 is posted
through `postMoney` under the `production` category ("Camera upgrade: level 2
to 4"), with a Why? that nests the fee's own trace; lowering posts nothing.
Then it writes the level and publishes `production.levelChanged` (`{
promotionId, area, from, to, fee, source: 'command' | 'ai' }`). The rival desk
(AIP8) calls the door with `source: 'ai'`, so everyone pays the same fee by the
same rule (D-01).

`production.setLevel { promotionId, area, level }` is refused unless the issuer
runs the promotion (`controlsPromotion`, the rule every command uses: the
player for their own, the computer for a computer-run one), then by the check.
It returns `{ area, from, to, fee }`.

EVT4's show-quality ceiling reads the stored levels: the `production.ceiling`
query reflects a change at once, and the daily `cardFlow.refreshBonusSlots`
phase gives or takes the bonus slot on unbooked future shows the next day.

## Coming shows

`upcomingShows(read, promotionId, from, days)` lists the shows a promotion is
expected to run from `from` for `days` days (`production.forecastDays`, 28): its
scheduled and booked shows in the window when it has any, otherwise every
active event definition whose recurrence falls on a day of the window. Dates
ascending; an `eventInstanceId` of null marks a date read off a definition.
Hardpan's weekly minor Friday gives 4 shows in 28 days from a Monday.

| Key                       | Kind    | Default | Range | Unit | Meaning                                           |
| ------------------------- | ------- | ------- | ----- | ---- | ------------------------------------------------- |
| `production.forecastDays` | integer | 28      | 1–90  | days | How many days ahead the coming shows are added up |

## Screens

`production.overview { promotionId }` gives one row per area (level, label,
`costKind`, `cost` with its Why? and `costBasis`, effect lines and `minLevel`)
and the header: the popularity ceiling, how many regions sit above it, the
monthly overhead by ledger category, the per-show cost of the coming shows and
the TV deal. A per-show row is priced at the importance of the next coming
show, with `costBasis` "per Hardpan Friday (minor)" ("per regular show" when
nothing is coming); a monthly row's basis is "a month".

Levels are public, and so is the popularity ceiling, which follows from them.
For a promotion the viewer does not run, `mine` is false and every cost, the
totals, `typicalImportance` and the TV deal are null, and lines registered as
`ownOnly` are left out. The all-seeing viewer sees everything.

`production.changePreview { promotionId, area, level }` (own promotions only)
gives the fee and its Why?, the reasons and `canApply`, and one row per number
the change moves, before and after: `areaCost` (the area at the same basis as
the overview), then `upcomingShows` for a per-show area or `monthlyOverhead`
for a monthly one, then `popularityCeiling` for marketing and back office, then
one row per registered effect for the area (skipped when either side has no
number). A level out of range gives no rows. Traces are returned inline and
never recorded.

The web screen is Business > Production (`apps/web/src/screens/production/`,
ECO7-04): the header cards (popularity ceiling, monthly overhead with "Last
charged" from the `production.monthlyOverhead` trace, show production for the
coming shows), one row per area in two groups ("On every show", "Every month")
with − / + that open a change dialog drawn from `production.changePreview`, and
a "Monthly overhead" card on the Finances Overview. Other features add header
cards with `registerProductionHeaderItem` (ECO7's sit at 20, 30 and 40).

## Cash runway

Production is meant to be a real cost: at its starting levels the biggest
promotion spends far more than it earns, and a year at those levels takes it
from about $40M into debt. That is a challenge, not a bug (owner decision,
ECO7-06), so the game makes sure the player sees it coming. The
`production.cashRunway { promotionId }` query (`runway.ts`, own books only,
the same `notYourBooks` rule as Finances) and the `cashRunway` formula
(`formulas/cashRunway.ts`) work out the money a month at this rate and how
many months the cash lasts.

The month has two halves:

- **Fixed spend, priced ahead** with the formulas that post it, at today's
  levels: wages (the payroll a month), medical, the production, marketing and
  back office overhead, and the per-show production of the shows in the next
  `production.forecastDays`, turned into a month (÷ days ahead × 365 ÷ 12).
- **Everything else, from the ledger**: ticket sales, merchandise, TV money,
  venue rent, travel, catering and the rest, over the last
  `production.runway.lookbackDays` days played before today (never more than
  `history.keepDetailDays`, so every row is still there), turned into a month
  the same way. The categories priced ahead are skipped here (they are
  charged once a month, so a few weeks of rows would count them zero or one
  times), and so are one-off payments (signing bonuses, severance, buyouts,
  and upgrade fees, which are `production` rows).

Before `production.runway.minDaysPlayed` days of play the second half is left
out and the status is `tooEarly`: the screens show the fixed spend and say
when the forecast starts. Then:

| Status        | When                                                        |
| ------------- | ----------------------------------------------------------- |
| `outOfCash`   | cash ≤ 0 (checked first)                                    |
| `tooEarly`    | fewer than `minDaysPlayed` days played                      |
| `makingMoney` | the month at this rate is ≥ 0                               |
| `runningOut`  | months left = cash ÷ money lost a month < `warnBelowMonths` |
| `losingMoney` | otherwise                                                   |

The answer carries the cash, the status, the month's net (signed cents) and
months left with their traces, the fixed spend a month line by line,
`warnBelowMonths` and `daysUntilForecast`. `production.changePreview` adds a
`cashRunway` row ("Months of cash left", before → after) when both sides are
losing money, so the change dialog shows what a level does to the runway.

On screen (`apps/web/src/screens/production/cashRunway.tsx`): a **Cash
runway** card in the Production header (order 50) and on the Finances
Overview (KPI order 12, after Cash), with the sentence "At this rate you run
out of cash in about 8 months.", the month's net with its Why?, and the fixed
spend; and a warning strip at the top of both screens ("Losing money",
"Running out of cash", "Out of cash") while money goes out faster than it
comes in. There is no inbox yet; when SOC1 adds one, a mail when the status
turns `runningOut` belongs there.

| Key                                 | Kind    | Default | Range | Unit   | Meaning                                                           |
| ----------------------------------- | ------- | ------- | ----- | ------ | ----------------------------------------------------------------- |
| `production.runway.lookbackDays`    | integer | 28      | 7–28  | days   | Recent days of show money the runway averages                     |
| `production.runway.minDaysPlayed`   | integer | 7       | 1–28  | days   | Days of play before show money counts                             |
| `production.runway.warnBelowMonths` | number  | 6       | 0–36  | months | Fewer months of cash than this: "Running out of cash" (0 = never) |

## Effects

`registerProductionEffect({ id, order, areas, ownOnly?, describe })` lets other
features say what a level does without editing ECO7's files: EVT4 the
show-quality ceiling, MTCH5 the angle writing band, ECO2 merch, ECO3 hype, ECO8
viewers. `describe(read, { promotionId, levels, date, tunables })` returns a
line `{ id, label, value, unit, text, trace }` or null. The overview shows the
lines on each listed area's row (stored levels); the change dialog calls it
with the current and the proposed levels. Register once, when the registering
system's `index.ts` is imported; a duplicate id throws. `ownOnly` lines name
something private and are never shown to a rival.

EVT4's show-quality ceiling, `cardFlow.showCeiling` (stage, camera, editing,
pyro; order 10; public, like the levels), reads "Shows can score up to 47 (90
earns an extra main-card slot)" with the ceiling's Why?
(`card-flow.md#production-ceiling`); the change dialog shows it before → after.

ECO7's own two: `production.popularityCeiling` (marketing, back office;
"Popularity above 30 slowly falls back"; the dialog shows it as the fixed
`popularityCeiling` row) and `production.tvCameraMinimum` (camera, `ownOnly`,
only while a deal runs).
