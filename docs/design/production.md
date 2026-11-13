# Production

Production (ECO7) turns a promotion's eight production levels into a choice
with visible trade-offs. Raising a level costs a one-time **upgrade fee**;
every level carries a running cost, either a **monthly overhead** or a
**per-show cost**; and low marketing or back office sets a **popularity
ceiling** the promotion's regional popularity cannot stay above.

Code: `packages/engine/src/systems/production/` (system id `production`).
ECO7-01 ships the area tables, the tunables and the pure traced formulas.
Nothing charges money yet: ECO7-03 posts the monthly overhead, ECO7-05 posts
the per-show costs, and ECO7-04 puts it on screen. Production never rolls, so
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

The Why? reads: "Camera level 4 of 10", "Cost curve 0.4 ^ 3", "Camera at level
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

`production.feeNeedsCash` is read by the command that buys an upgrade
(ECO7-02), not by the formula.

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

## TV camera minimum

While a promotion has an active TV deal, its camera level may not go below
`production.tvDealMinCamera`: a network will not air a show nobody filmed. The
production commands (ECO7-02) enforce it; this ticket only defines the number.

| Key                          | Kind    | Default | Range | Unit   | Meaning                                              |
| ---------------------------- | ------- | ------- | ----- | ------ | ---------------------------------------------------- |
| `production.tvDealMinCamera` | integer | 1       | 0–10  | points | Lowest camera level allowed while there is a TV deal |
