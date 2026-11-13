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

Every show is held somewhere: a real venue from the `venues` table
(`eventInstances.venueId`) or a [generic local venue](#generic-venues)
(`eventInstances.genericVenue`), never both. Both null means the venue is not
chosen yet. `showVenueOf(read, instance)` (`showVenue.ts`) turns either form
into one `ShowVenue` (name, capacity, kind of building, region, image), so
screens and formulas never need to know which it is.

**Availability.** `venueAvailability(read, venue, { promotionId, date, eventInstanceId })`
says whether a real venue can be booked for a show. The first rule that fails
is the reason:

| Code                       | Player text                                            | When                                                                            |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `boxOffice.venueClosed`    | "Closed on that date"                                  | The venue has not opened yet or has closed by the show's date (`isVenueOpenOn`) |
| `boxOffice.venueExclusive` | "Exclusive to Tessen Pro Wrestling"                    | The venue is exclusive to another promotion                                     |
| `boxOffice.venueTaken`     | "Tessen Pro Wrestling runs Iron Hour there that night" | Another promotion has a show there that day that is not cancelled               |

A venue exclusive to the show's own promotion is available, and the
promotion's own other shows never make a venue taken. The default world has
three exclusive venues (Altura Studio One, Longleaf Barn and Tessen Dojo
Hall; see [default-world.md](default-world.md#venues)).

**A show moves to its venue's region.** `applyVenueChoice(ctx, eventInstanceId, choice, { auto, trace })`
(`applyVenue.ts`) is the one write: a real venue sets `venueId`, clears
`genericVenue` and sets the show's `regionId` to the venue's region; a generic
size clears `venueId` and stores `{ tier, capacity }` with the capacity the
size has today. It stores the pick's Why? under `boxOffice.venuePick` (id: the
show) when one is given, and publishes
`show.venueChosen { eventInstanceId, promotionId, venueId, genericTier, auto }`.

**Fit.** `venueFit(expected, capacity, tunables)` (`venueFit.ts`) labels how
well a venue suits the expected crowd:

| Label             | When                                                  |
| ----------------- | ----------------------------------------------------- |
| "Likely sell-out" | expected ≥ capacity × `boxOffice.fit.sellOutAt` (1.0) |
| "Will look empty" | capacity ≥ expected × `boxOffice.fit.emptyAt` (3)     |
| "Good fit"        | anything in between                                   |

A sell-out wins when both hold.

`expected` here is the uncapped demand (the forecast's value), so a venue too small
for the crowd reads "Likely sell-out" rather than "Good fit". The screens show the
label as a `VenueFitBadge` (EVT6-06): "Likely sell-out" in the positive colour with a
ticket icon, "Good fit" in the data colour with a check, "Will look empty" in the
negative colour with a warning sign, so colour is never the only signal. The badge
only draws the engine's answer; it never works the fit out itself. It appears on the
booking screen's "Venue and crowd" panel, on each row of the "Choose a venue" sheet
and on the calendar show sheet's Crowd line (see `apps/web/src/app/README.md`).

## Generic venues

Every region has a set of generic local venues, so a founded promotion or a
tour stop with no real venue still has somewhere to run
(`genericVenues.ts`). Each size has a capacity tunable,
`boxOffice.generic.<size>.capacity` (1–200,000):

| Size         | Player label        | Rents as  | Default capacity |
| ------------ | ------------------- | --------- | ---------------: |
| `room`       | "Local room"        | `hall`    |              150 |
| `smallHall`  | "Local small hall"  | `hall`    |              500 |
| `hall`       | "Local hall"        | `hall`    |            1,200 |
| `largeHall`  | "Local large hall"  | `hall`    |            3,000 |
| `smallArena` | "Local small arena" | `arena`   |            6,000 |
| `arena`      | "Local arena"       | `arena`   |           12,000 |
| `largeArena` | "Local large arena" | `arena`   |           20,000 |
| `stadium`    | "Local stadium"     | `stadium` |           45,000 |

A generic venue is named after its size and the show's region ("Local hall,
Northeast") and shows the placeholder venue image. The sizes are ordered by
their capacities each time they are read (`genericVenueSizes`), so an
override that makes one size bigger than the next still picks the smallest
that fits. The capacity is copied onto the show when it is chosen, so a later
tunable change never rewrites a show.

## Pick

`pickVenue(inputs, { tunables })` (`formulas/pickVenue.ts`) is the decision
every later piece uses to give a show a venue: the automatic pick (EVT6-03),
rival calendars (AIP7) and tours (EVT8). Its answer is a venue id or
`generic:<size>`. `pickVenueFor(read, tunables, instance)` (`pickVenueFor.ts`)
gathers its inputs: the expected crowd from [`forecastAttendance`](#forecast)
in the show's region, the real venues in that region and in the rest of its
country (through the `venues.byRegion` index and the geography), each with its
[availability](#venues), the preferred venue from the show's definition, and
the generic sizes.

The rules, in order; the first that passes picks:

1. **Preferred venue <name> is open and can be booked**: the preferred venue,
   whatever its size.
2. **Smallest venue in <region> that fits <expected> × headroom**: the
   smallest available venue in the show's region whose capacity is at least
   the expected crowd × `boxOffice.pick.headroom` (1.1, "Room left for a good
   night when sizing a venue"), rounded up.
3. **Smallest venue elsewhere in <country> that fits**: the same, in the rest
   of the country.
4. **Generic venue: smallest size that fits**, or, when even the biggest size
   is too small, the biggest ("Bigger than any venue size: Local stadium").

The pick never chooses a venue that is closed, exclusive to another promotion
or used by another promotion that night. Every venue it looked at is listed in
the Why? with its capacity and why it was or was not used ("Too small",
"Exclusive to …"), and the expected crowd and the headroom are lines of their
own. Ties go to the smaller venue, then the lower id. The pick has no rolls.

A show that already has a venue keeps it; EVT6-03 runs the pick for shows that
have none ([automatic picks](#automatic-picks)).

## Automatic picks

There is no Lock card (EVT2-09), so the game gives shows their venues at two
moments (`phases.ts`):

- **`boxOffice.assignVenues`** (daily, `housekeeping` order 64) looks at the
  open (`scheduled` or `booked`) shows without a venue dated from today
  through today + `boxOffice.rivalVenueLeadDays` (14, 0–90 days), through the
  `eventInstances.byDate` index, date by date and by id within a date.
  - A show the computer runs (its brand's controller when the brand has one,
    else its promotion's) gets the pick, so the world calendar shows where
    rival shows are held two weeks ahead.
  - A show a human runs keeps "Not chosen yet" until **the day before**: the
    phase picks for the player's shows dated tomorrow, and today's as a safety
    net. The day runs before the clock moves on, so on show day the booking
    screen already shows a venue and its forecast, and the player can still
    change it. Later shows are never touched.
- **`boxOffice.pickOnShowNight`**, a
  [before-a-show-runs hook](show-night.md#before-a-show-runs) (order 10), picks
  for any show that reaches its first segment without a venue, the player's or
  a rival's. No show runs without a venue, so the settlement always has a
  capacity.

Both run `pickVenueFor` and store it with `applyVenueChoice(..., { auto: true })`,
which publishes `show.venueChosen { auto: true }`. A pick that cannot be made
(bad data) is logged and skipped, never thrown, so it never stops the day or the
show. The pick's Why? (`boxOffice.venuePick`) is stored for the player's shows
only; rival picks store none, so a year of rival calendars adds nothing to the
trace store. Picks are deterministic and the phase is idempotent: a show that
has a venue is skipped.

## Venue commands and queries

`api.ts` declares the shapes. A `VenueChoice` is
`{ kind: 'venue', venueId }` or `{ kind: 'generic', tier }` (`VenueChoiceSchema`).
A `VenueSummary` is a [`ShowVenue`](#venues) with its `regionName`,
`countryName` and the `choice` that names it.

**Commands** (`commands.ts`, in the `booking.` area but owned by this bundle):

| Command             | Args                          | What it does                                                                           |
| ------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `booking.setVenue`  | `{ eventInstanceId, choice }` | Stores the booker's choice (`auto: false`) with a one-rule Why? "Chosen by the booker" |
| `booking.autoVenue` | `{ eventInstanceId }`         | "Pick for me": runs `pickVenueFor` and stores it with `auto: true` and the pick's Why? |

Both return `{ eventInstanceId, venue: VenueSummary }`. They are refused, in
this order, with nothing changed:

| Code                        | Player text                                               | When                                                            |
| --------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| `invalidArgs`               | "That show no longer exists", "That venue does not exist" | Unknown show or venue; an unknown generic size fails the schema |
| `boxOffice.notYourShow`     | "Only the person running this show can choose its venue"  | The issuer does not run the show (`controlsShow`)               |
| `boxOffice.showNotEditable` | "This show can't change venue any more"                   | The show is completed, cancelled or dated before today          |
| `boxOffice.venueClosed` …   | The [availability](#venues) message, subject the venue    | `booking.setVenue` with a real venue that cannot be booked      |

The show dated today can still change venue until it has run. Choosing a venue
in another region moves the show there (D-03, touring): EVT5 reads the show's
region for popularity reach.

**Queries** (`queries.ts`):

- `boxOffice.forecast { eventInstanceId, choice? }` → `ShowForecast`:
  `current` (the show's venue or null), `suggested` (the pick preview while
  `current` is null), `shown` (`choice ?? current ?? suggested`), and the
  forecast at the shown venue's region: `demand` (the uncapped expected crowd,
  the trace's value), `expected`, `low` and `high` capped at the venue's
  `capacity`, `cappedByCapacity` (the top of the range does not fit), `fit` and
  `fitLabel`, the forecast's `trace` inline (queries cannot store traces) and
  the `pickTrace` behind `suggested`. A `choice` previews and writes nothing.
- `boxOffice.venues { eventInstanceId, scope: 'country' | 'world' }` →
  `{ current, suggested, options }`. Real venues in the show's country (`scope:
'country'`) or everywhere (`'world'`), plus the current and preferred venues
  wherever they are, then every generic size in the show's region. Each
  `VenueOption` has its `choice`, names, `group` (`region`, `country`, `abroad`
  or `generic`), capacity, building kind, image, expected crowd and range
  forecast in the venue's own region and capped at its capacity, fit,
  `preferred`, `current` and `disabled` (the availability code and message, or
  null). Sorted by group, then capacity, then id. Each region is forecast once.
- `boxOffice.showVenue { eventInstanceId }` → `{ venue: VenueSummary | null }`
  for any show and any viewer: where a show is held is not secret.

The forecast and the venue list are for the viewer's own shows
(`viewerControlsShow`); anything else is refused with `boxOffice.notYourShow`,
"Only your own shows have a crowd forecast". The omniscient viewer (tools and
tests) reads every show.

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

Every completed show, the player's and every rival's, is settled **on its own
date** (EVT6-05, `settle.ts`): its real crowd is rolled, its money posted and
`show.settled` published. Settling on the show's day is a deliberate change
from the reference, which rolled crowds the next morning and so counted a show
inside its own recent form.

**When.** Two paths, one function (`settleShow`):

- **The player's shows** are settled by the `show.completed` reaction
  `boxOffice.settleShow`, straight after the step that ran them. The player
  runs a show with Run the show at the start of its day and goes to its results
  at once, so the Box office is already there.
- **Every other show** is settled by the phase `boxOffice.settleShows`
  (group `settlement`, order 10, daily), straight after the `shows` group. It
  visits today's `completed` shows whose `result.attendance` is still null,
  through the `byDate` index, in id order, so it also catches a player's show
  whose reaction failed (a failed reaction rolls back only its own work).

A show with an attendance is never touched again, so a second pass settles
nothing and a show is settled exactly once. A cancelled show, or one that has
not run, is never settled.

**Bad data never throws.** No savepoints: a savepoint rolls back table writes
but not staged events or traces, and `postMoney` publishes as it goes. So each
show's inputs are checked first (its promotion exists and is open, its venue
can be found, the venue holds someone) and a show with bad data is logged and
skipped before anything is written. A genuine bug rolls the whole step back to
the failure log; those shows keep `attendance: null`, their results pages say
"Box office not settled yet", and later days never retry them, so money never
lands on the wrong date.

**Per show**, in order:

1. A show still without a venue gets the [automatic pick](#automatic-picks).
2. The crowd: [`forecastAttendance`](#forecast) (recent form leaves the show
   itself out) → [`computeActualAttendance`](#crowd-roll), one roll on
   `boxoffice.crowd`, capped at the venue's capacity.
3. The [ticket price](#ticket-price) from ECO1's reach and the show's size;
   ticket sales are the price × the crowd.
4. The [venue rent](#venue-rent); a venue exclusive to the show's own promotion
   is cheaper.
5. [Live merch](#live-merch), one roll on `boxoffice.merch`, from the crowd and
   `result.score`.
6. The [worker shares](#worker-shares) of each. The workers are every distinct
   person on the card, the pre-show included, except people who are only talked
   about (`subject`), each with an active contract with the show's promotion
   (`cardWorkers.ts`). A show with no card (a rival show scored off-screen) has
   no workers and no shares.
7. The [net](#box-office-net).

Then the show's `result` gets `attendance`, `gate` (ticket sales before the
shares), `ticketPrice` and `merch` (gross merch); the rest of the result is left
as show night wrote it. `ticketPrice` and `merch` are optional fields, so saves
made before EVT6-05 still load.

**Money, through `postMoney` only**, to the show's own promotion, rivals
included, each row with the show in `refs.eventInstanceId`:

| Category    | Amount                                 | Memo                      |
| ----------- | -------------------------------------- | ------------------------- |
| `tickets`   | ticket sales − the workers' gate share | "<show name>: tickets"    |
| `venueRent` | − the rent                             | "<show name>: venue rent" |
| `liveMerch` | merch sales − the workers' merch share | "<show name>: live merch" |

A line that comes to 0 is not posted (`postMoney` refuses 0) and the net's
Why? says so ("No tickets sold"). The three rows add up to the net exactly.
ECO1's show costs (appearance fees, travel, catering) never post `venueRent`,
so nothing is posted twice: the results page's **Show money** section and the
show report's Money line list and add up the box office rows with the show
costs.

**Event.** `show.settled { eventInstanceId, promotionId, attendance, capacity,
gate, net }`, money in whole cents, once per settled show, rivals' too.

**Traces.** Each line of the player's shows has its own kind, id the show, so
busy rival settlement never pushes the player's out of
`sim.traceRetentionPerKind`:

| Kind                        | What it explains                                               |
| --------------------------- | -------------------------------------------------------------- |
| `boxOffice.attendance`      | The crowd, starting from the whole forecast                    |
| `boxOffice.ticketPrice`     | The ticket price; reach is one line (its Why? is on Finances)  |
| `boxOffice.gate`            | Ticket price × crowd − the workers' share of the gate          |
| `boxOffice.venueRent`       | The rent                                                       |
| `boxOffice.liveMerch`       | Merch sales − the workers' share of the merch                  |
| `boxOffice.net`             | The net, with a note for each line that posted nothing         |
| `boxOffice.rivalAttendance` | A rival show's crowd, kept short: expected crowd, roll and cap |

A rival's money is private, so its show stores only the short attendance
trace, and its ledger rows get `postMoney`'s one-line Why?. A worker share of
0 is one line rather than a check per worker. The player's ledger rows carry a
short Why? of their own (ticket sales less the share; the rent).

**Save size.** On the default world after 365 days (JSON of the engine
state): 10.76 MB before EVT6-05, 12.64 MB after. The box office traces are
about 2.0 MB of that (the player's crowd Why? 0.8 MB, live merch 0.4 MB, the
rival crowds 0.26 MB, the rest under 0.21 MB each); they stop growing once each
kind holds `sim.traceRetentionPerKind` traces. The rest is the ledger rows
(three per show, about 1,750 a year). Keeping the reach roll-up inside the
ticket price trace would have cost 5 MB more.

**Queries** (`settlementQueries.ts`):

- `boxOffice.showCrowd { eventInstanceId }`, public, any show →
  `{ status: 'settled' | 'notSettled' | 'notRun', venue, attendance, capacity,
percentFull, attendanceTraceRef }`. `percentFull` is rounded to a whole
  percent.
- `boxOffice.showMoney { eventInstanceId }`, the viewer's own shows
  (`viewerPromotionIds`) and the omniscient viewer → `{ ticketPrice, grossGate,
gateShare, tickets, venueRent, grossMerch, merchShare, liveMerch, net }`,
  each `{ amount, traceRef }` (rent negative, like its row). The amounts come
  from the result and the show's three ledger rows, so they match the ledger
  even once the traces are gone. A rival's show is refused with
  `boxOffice.privateMoney` ("Other promotions' takings are private"); a show
  not settled with `boxOffice.notSettled`.

Every trace ref passes through `traces.has`, so a Why? never opens nothing.

**Results page.** The **Box office** section (order 35, after MTCH3's 30 and
before ECO1's Show money at 60; `apps/web/src/screens/box-office/`) shows, for
the player's own show, Attendance ("82% full · Harrowmere Arena, capacity
17,500"), Gate, Venue rent, Live merch and Net (signed, with a "Loss" badge
below 0), each with its Why?. A rival's show shows Attendance only and "Other
promotions' takings are private". A show that ran but was not settled says
"Box office not settled yet". The cards fall to one column on a phone. The
show report's What changed panel has a **Box office** line (35): "Crowd 4,210
(92% full) · Gate $48,300", the crowd alone for a rival's show.

**Headless.** The sim-runner's summary counts the settled shows and their
total attendance; `--strict` fails when a completed show was never settled.
