# Box office

Every show draws a crowd. The player can forecast it while booking and read it
afterwards, and the crowd pays: tickets, venue rent and live merchandise go
through ECO1's `postMoney` (see [finances.md](finances.md)). This doc covers the
`boxOffice` system bundle (EVT6), in
`packages/engine/src/systems/boxOffice/`.

EVT6-01 lays the ground: the bundle (registered in `defaultSystems` after the
shows and finance systems, with no phases, queries or commands yet), its
tunables (listed in [tunables.md](tunables.md#box-office-tunables)), two random
streams (`boxOffice.crowd` and `boxOffice.merch`, nothing draws from them yet)
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
have none.

## Crowd roll

_Not built yet (EVT6-04)._ It draws from the `boxOffice.crowd` stream and lands
within the forecast's `low`..`high` range.

## Ticket price

_Not built yet (EVT6-05)._

## Venue rent

_Not built yet (EVT6-05)._

## Live merch

_Not built yet (EVT6-05)._ It draws from the `boxOffice.merch` stream.

## Worker shares

_Not built yet (EVT6-05)._

## Settlement

_Not built yet (EVT6-05)._
