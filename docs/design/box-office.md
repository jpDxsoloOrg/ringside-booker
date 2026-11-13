# Box office

Every show draws a crowd. The player can forecast it while booking and read it
afterwards, and the crowd pays: tickets, venue rent and live merchandise go
through ECO1's `postMoney` (see [finances.md](finances.md)). This doc covers the
`boxOffice` system bundle (EVT6), in
`packages/engine/src/systems/boxOffice/`.

EVT6-01 lays the ground: the bundle (registered in `defaultSystems` after the
shows and finance systems, with no phases, queries or commands yet), its
tunables (listed in [tunables.md](tunables.md#box-office-tunables)), two random
streams (`boxoffice.crowd` and `boxoffice.merch`; stream names are lower case only)
and the crowd forecast. Later EVT6 tickets fill the sections marked _Not built
yet_.

The rules the box office follows:

- **Crowd size is not crowd reaction (D-02).** The forecast is how many people
  come, not how they feel. Popularity and hype are separate lines in its Why?,
  and so is every other driver.
- **One forecast, read everywhere.** The booking panel, the venue pick, the
  show-day crowd roll and later ECO3 and BRW5 all read the same
  `forecastAttendance`, so what the player is shown on booking day is what the
  show day starts from.
- **Recent form never counts the show being forecast or settled**, and every
  multiplier is applied exactly once.
- **Capacity is not part of the forecast.** The venue caps the range and the
  real crowd later; the forecast says how many people want to come.

## Forecast

`computeExpectedAttendance` (`formulas/expectedAttendance.ts`) is the expected
crowd: a whole number of people, 0 or more, with no rolls.

```text
draw     = walkUp + atFullPopularity × (popularity / 100) ^ curve
expected = draw
         × (1 + marketing.perLevel × marketing level)
         × importance.<show size>
         × recent form
         × big-show fatigue
         × hype
         rounded to whole people, never below 0
```

| Line in the Why?           | Where it comes from                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| "Popularity in Texas: 20"  | The promotion's `regionalPop` in the show's region, 0 when none is stored, read with the [same-day rule](#same-day-rule) |
| "Popularity curve"         | `boxOffice.draw.curve` (3.0): a convex curve, so a company twice as popular draws far more than twice the crowd          |
| "Crowd at full popularity" | `boxOffice.draw.atFullPopularity` (30,000)                                                                               |
| "Walk-up crowd"            | `boxOffice.draw.walkUp` (80): people who turn up to any show, however unknown the company                                |
| "Marketing level 8"        | `× (1 + 0.04 × level)` with the promotion's `production.marketing` (0–10), so level 10 adds 40%                          |
| "Regular show"             | `boxOffice.importance.*`: house 0.35, minor 0.7, regular 1.0, major 1.5, flagship 2.2                                    |
| "Recent form"              | [Recent form](#recent-form), 0.85–1.15                                                                                   |
| "Big-show fatigue"         | [Big-show fatigue](#big-show-fatigue), 0.25–1                                                                            |
| "Hype"                     | [Hype](#hype), 1 until ECO3 tracks it                                                                                    |

Every number is a tunable, and 0 means 0: a show size multiplier at 0 empties
the building, and with the walk-up crowd and popularity both at 0 nobody comes.

`forecastAttendance(read, tunables, instance, at?)` (`forecast.ts`) gathers the
inputs from the world and returns:

- `expected`: the traced crowd above.
- `low` and `high`: `expected × (1 ∓ boxOffice.crowd.spread)`, rounded (±10%).
  The real crowd lands in this range (EVT6-04), so it is also the range the
  booking panel shows. The caller caps both at the venue's capacity.
- `inputs`: what the forecast was built from, including the recent shows and
  the other big shows it counted.

`at: { regionId }` forecasts the same show in another region, for "what if this
venue" in EVT6-03. It is exported from the engine next to `recentFormOf`.

### Same-day rule

`promoPop.applyAfterShow` moves a promotion's popularity as soon as a show
completes. The forecast reads
`popularityBeforeShow(read, eventInstanceId, regionId) ?? regionalPop[regionId]`,
so a show settled later the same day draws from the popularity it started with
and the next show sees the new value. See
[promotion-popularity.md](promotion-popularity.md#same-day-ordering-for-attendance).

## Recent form

Good recent shows bring people back; poor ones keep them away.
`recentFormOf(read, { promotionId, beforeDate, excludeEventInstanceId, tunables })`
(`recentForm.ts`) averages the `result.score` of the promotion's completed
shows dated in `[beforeDate − 120 days, beforeDate)`:

- **Strictly before the show's own date.** The booking forecast and the
  show-day settlement count the same shows, and a second show on the same day
  never counts the first.
- **Never the show itself** (`excludeEventInstanceId`).
- **No house shows** unless `boxOffice.recentForm.countHouseShows` is on.
- Ids come back sorted, for determinism.

`computeRecentFormMultiplier` (`formulas/recentFormMultiplier.ts`) turns the
average into a multiplier:

```text
fewer than minShows (3) shows → 1, "Not enough recent shows (2 of 3)"
otherwise                     → 1 + maxSwing × clamp((average − par) / fullSwingPoints, −1, 1)
```

With the defaults (par 50, full swing 25 points, largest swing 0.15) an average
of 75 or more adds 15%, an average of 25 or less takes 15%, and an average of
60 adds 6%.

**Par, not popularity.** The show score is already judged against what the
crowd expected (D-02), so a fixed par of 50 is the fair yardstick. Comparing
against popularity would punish a popular company twice.

## Big-show fatigue

Fans can only afford so many big nights out. `bigShowsBefore(read, { promotionId, date, excludeEventInstanceId, tunables })`
(`bigShows.ts`) counts the promotion's other `major` and `flagship` shows that
are not cancelled, dated in `[date − 28 days, date)`. Scheduled shows count as
well as completed ones, so the forecast and the settlement agree.

`computeBigShowFatigue` (`formulas/bigShowFatigue.ts`):

```text
house, minor, regular → 1, "Not a big show"
major, flagship       → max(floor, 1 − perExtraShow × max(0, other big shows − freeShows))
```

With the defaults the first other big show in four weeks is free, each one after
it takes 20%, and fatigue never takes more than 75% (floor 0.25).

## Hype

ECO3 tracks a show's hype. Until it is on main, `hypeLineFor`
(`hype.ts`) returns a constant 1 with the reason "Hype is not tracked yet", so
the line is still in the Why?. EVT6-07 swaps in ECO3's hype multiplier inside
that one function, without touching the formula.

## Calibration

`test/systems/boxOffice/calibration.test.ts` forecasts the first scheduled
date of five shows on a new default-world game (no recent form yet, so that
line is 1). If a band fails, tune the defaults, not the bands.

| Show             | Promotion, region popularity, marketing   | Size     | Forecast | Band          |
| ---------------- | ----------------------------------------- | -------- | -------- | ------------- |
| Altura Mainstage | Altura, 75, marketing 8                   | Regular  | 16,812   | 10,000–18,000 |
| Altitude         | Altura, 73, marketing 8 (1 free big show) | Flagship | 34,123   | 25,000–55,000 |
| Tessen Iron Hour | Tessen, 65, marketing 5                   | Regular  | 9,983    | 6,000–14,000  |
| Wattle Saturday  | Wattle, 18, marketing 1                   | Minor    | 186      | 100–400       |
| Hardpan Friday   | Hardpan, 20, marketing 1                  | Minor    | 233      | 100–500       |

## Venues

_Not built yet (EVT6-02)._

## Generic venues

_Not built yet (EVT6-02)._

## Pick

_Not built yet (EVT6-02, EVT6-03)._

## Crowd roll

On show day the forecast becomes a real crowd. `computeActualAttendance`
(`formulas/actualAttendance.ts`) starts from the forecast's traced `expected`
crowd, so the Why? opens with how the forecast was worked out:

```text
crowd = expected
      × roll between (1 − crowd.spread) and (1 + crowd.spread)   "Crowd on the night"
      rounded to whole people
      capped at the venue's capacity                              "Capacity of <venue>"
      never below 0
```

- The roll draws **exactly once** from the `boxoffice.crowd` stream, before the
  cap, even when the venue sells out. The stream stays aligned however the
  numbers are tuned, so the next show rolls the same way.
- With the default spread of 0.1 the crowd lands within the forecast's
  `low`..`high` range (±10%), the range the booking panel shows.
- Stream names are lower case only, so the streams are `boxoffice.crowd` and
  `boxoffice.merch` although the system id is `boxOffice`.

These show-day formulas are pure: they read only their inputs and the
tunables. The EVT6-05 settlement gathers the inputs from the world, passes the
streams in and posts the money.

## Ticket price

`computeTicketPrice` (`formulas/ticketPrice.ts`), in cents:

```text
price = (ticket.base + ticket.perReachPoint × reach) × ticket.importance.<show size>
        rounded to whole cents, never below 0
```

Reach is ECO1's smooth 0..100 figure from `reachOf` (see
[finances.md](finances.md#reach-and-size)), passed in as a nested trace so the
Why? shows how reach was worked out. A company's prices rise gradually as it
grows; the size labels are for display only. With the defaults a regular show
by a company with reach 0 charges $10.00, at reach 50 $40.00 and at reach 100
$70.00; a flagship show charges twice that.

## Venue rent

`computeVenueRent` (`formulas/venueRent.ts`), in cents:

```text
rent = rent.base + rent.perSeat × capacity × rent.kind.<venue kind>
       × rent.ownVenueFactor, only in "Your own venue"
       rounded to whole cents
```

- **Rent is charged on capacity, not on the crowd.** An empty arena costs the
  same as a full one, so picking a venue the right size matters.
- **Your own venue** is one exclusive to the show's own promotion
  (`exclusivePromotionId`). The branch is always recorded, taken or not.
- Stadiums cost far more per seat (3.5×, against the 1.4 first proposed) so a
  stadium only pays when it is close to full; see the
  [calibration](#show-day-calibration).

## Live merch

`computeLiveMerch` (`formulas/liveMerch.ts`), in cents:

```text
quality = merch.qualityLow + (merch.qualityHigh − merch.qualityLow) × score / 100
merch   = crowd × merch.perHead × quality
        × roll between (1 − merch.spread) and (1 + merch.spread)   "Merch stand on the night"
        rounded to whole cents, never below 0
```

- The crowd is the crowd on the night, after the cap, and it is used **once**
  (the reference applied its attendance setting twice here).
- The score is the show's `result.score`, read as 0..100. Until EVT4 caps the
  score by production, merch reads the uncapped score.
- The roll draws exactly once from the `boxoffice.merch` stream, even for an
  empty building.

With the defaults each fan spends $4.00 after a show scoring 0, $5.00 after an
average show and $6.00 after a show scoring 100, give or take 5%.

## Worker shares

`computeWorkerShare` (`formulas/workerShare.ts`), in cents, once for the gate
(`label: 'Gate'`, each worker's `terms.shares.gateBp`) and once for the merch
(`'Merch'`, `merchBp`):

```text
shares = sum over workers with a share of gross × bp / 10,000   "Rex Vance 2.5% of the gate"
         capped at gross × gate.workerShareCap (or merch.workerShareCap)   "Share cap"
         never below 0, rounded down to whole cents
```

- A worker with no share (0 bp) is a `branch` that was not taken, not a line.
- **The cap (half the gross by default) means worker shares can never turn
  takings negative**; the reference had no cap on the gate. Net takings can go
  low or negative only through rent.
- Rounding down means the company never pays a fraction of a cent more than
  it owes.

## Box office net

`computeBoxOfficeNet` (`formulas/boxOfficeNet.ts`) adds the lines up, in cents,
so the Net figure has its own Why?:

```text
net = ticket sales − workers' share of the gate − venue rent
    + merch sales − workers' share of the merch
```

Ticket sales are the ticket price × the crowd on the night. Each amount can be
passed as a plain number or with its own trace to nest. Wages, travel,
catering and production are ECO1's per-show costs and are not part of the box
office. A test of 1,000 seeded random shows checks that every amount is whole,
non-negative cents and that the net equals the sum of its lines exactly.

## Show-day tunables

All in `systems/boxOffice/tunables.ts`, category `Box office`, and 0-means-0.
Money is in whole cents.

| Key                                    | Default | Range        | Unit       | Meaning                                         |
| -------------------------------------- | ------- | ------------ | ---------- | ----------------------------------------------- |
| `boxOffice.ticket.base`                | 1,000   | 0–100,000    | money      | Ticket price every show starts from ($10)       |
| `boxOffice.ticket.perReachPoint`       | 60      | 0–10,000     | money      | Added per point of reach ($0.60)                |
| `boxOffice.ticket.importance.house`    | 0.8     | 0–5          | multiplier | Ticket price × this for a house show            |
| `boxOffice.ticket.importance.minor`    | 0.9     | 0–5          | multiplier | Same, minor show                                |
| `boxOffice.ticket.importance.regular`  | 1       | 0–5          | multiplier | Same, regular show                              |
| `boxOffice.ticket.importance.major`    | 1.5     | 0–5          | multiplier | Same, major show                                |
| `boxOffice.ticket.importance.flagship` | 2       | 0–5          | multiplier | Same, flagship show                             |
| `boxOffice.rent.base`                  | 25,000  | 0–10,000,000 | money      | Rent every venue charges, however small ($250)  |
| `boxOffice.rent.perSeat`               | 350     | 0–100,000    | money      | Rent per seat of capacity ($3.50)               |
| `boxOffice.rent.kind.hall`             | 1       | 0–5          | multiplier | Seat rent × this in a hall                      |
| `boxOffice.rent.kind.theatre`          | 1.1     | 0–5          | multiplier | Same, theatre                                   |
| `boxOffice.rent.kind.arena`            | 1.25    | 0–5          | multiplier | Same, arena                                     |
| `boxOffice.rent.kind.stadium`          | 3.5     | 0–5          | multiplier | Same, stadium                                   |
| `boxOffice.rent.kind.studio`           | 0.6     | 0–5          | multiplier | Same, studio                                    |
| `boxOffice.rent.kind.outdoor`          | 1.2     | 0–5          | multiplier | Same, outdoor venue                             |
| `boxOffice.rent.ownVenueFactor`        | 0.25    | 0–1          | ratio      | Share of the rent paid in your own venue        |
| `boxOffice.merch.perHead`              | 500     | 0–100,000    | money      | Merch each fan buys at an average show ($5)     |
| `boxOffice.merch.qualityLow`           | 0.8     | 0–3          | multiplier | Merch × this after a show scoring 0             |
| `boxOffice.merch.qualityHigh`          | 1.2     | 0–3          | multiplier | Merch × this after a show scoring 100           |
| `boxOffice.merch.spread`               | 0.05    | 0–0.5        | ratio      | How far merch sales can swing on the night      |
| `boxOffice.gate.workerShareCap`        | 0.5     | 0–1          | ratio      | Most of the ticket money worker shares can take |
| `boxOffice.merch.workerShareCap`       | 0.5     | 0–1          | ratio      | Most of the merch money worker shares can take  |

The crowd roll uses `boxOffice.crowd.spread` from the [forecast](#forecast).

## Show-day calibration

`test/systems/boxOffice/calibration.test.ts` also runs the show-day formulas
for a show's first date on a new default-world game, with ECO1's reach, a
fixed-seed roll and an average show (score 50). No default-world contract has a
gate or merch share yet, so shares are $0. Moving a show to another venue
forecasts it in that venue's region.

| Show at venue                          | Crowd (capacity) | Ticket | Ticket sales | Rent     | Merch   | Net       |
| -------------------------------------- | ---------------- | ------ | ------------ | -------- | ------- | --------- |
| Altura Mainstage at Harrowmere Arena   | 16,733 (17,500)  | $42.37 | $708,977     | $76,813  | $86,776 | $718,941  |
| Altura Mainstage at Kestlewood Stadium | 14,775 (68,000)  | $42.37 | $626,017     | $833,250 | $74,677 | −$132,556 |
| Wattle Saturday at The Gumleaf Room    | 192 (400)        | $11.78 | $2,262       | $1,790   | $957    | $1,429    |

Altura's reach is 54 and Wattle's 5. The bands the test checks: more than
$400,000 at Harrowmere, below $0 at Kestlewood, and between $0 and $5,000 at
The Gumleaf Room. With the first proposed stadium rent (1.4×) the Kestlewood
show still netted about $367,000, so the stadium multiplier was raised to 3.5.

## Settlement

_Not built yet (EVT6-05)._
