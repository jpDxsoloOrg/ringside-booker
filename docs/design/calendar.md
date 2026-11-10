# Calendar

The calendar turns event definitions (a promotion's weekly TV, monthly specials
and annual big shows) into dated shows. Every show feature reads those dated
shows, so this is where they come from. The code is in
`packages/engine/src/systems/calendar/`.

Nothing here is random. The schedule is fully decided by the data, so the
calendar has no RNG stream and the same world always gets the same shows with
the same ids.

## Horizon

Shows are **stored** only a fixed distance ahead. `calendar.scheduleHorizonDays`
(default 90) is that distance: at any time the `eventInstances` table holds
every show from today through today + 90 days, for every promotion. Dates past
the horizon are **projected** when a screen asks for them and never stored, so
a ten-year game does not carry ten years of empty shows.
`calendar.projectionMaxDays` (default 400) caps how far the projection looks.

Two things keep the stored window full:

- **New game.** The setup step `calendar.scheduleOpening` (order 810, straight
  after `wld.storeSettings`) schedules the start date through start + horizon.
  It runs after founding, so a founded promotion's weekly show is included. It
  reads the horizon from the session's tunables, so an override picked in the
  new-game wizard applies.
- **Every day.** The phase `calendar.extendHorizon` (housekeeping, order 20,
  daily) schedules tomorrow through tomorrow + horizon.

### Why the daily window starts tomorrow (the `+1`)

The clock moves to `date + 1` when the day closes. A phase running on day `D`
that fills `D + 1` through `D + 1 + H` leaves the player, who is now on
`D + 1`, looking at exactly today through today + `H`.

The window never includes the day being simulated. A definition that is created
or changed today can never get a surprise show on a day that is already
running, which would then close as "Not run". The setup step covers the start
date itself, because no phase has run for it.

With the horizon at 0, the stored window is just today: each day stores only
the next day's shows, and nothing after today is ever on the books. Zero means
zero.

An older game that has no stored shows heals itself: its first simulated day
fills tomorrow onward.

### Which definitions are scheduled

A definition is schedulable when its promotion is `active` and it is
promotion-wide or its brand is active. Dormant and closed promotions and
inactive brands get nothing. Definitions are visited in ascending id order.

`occurrencesBetween(definition, from, to)` lists the dates, both ends included,
clipped to the definition's `activeFrom` and `activeUntil`. One call lists at
most 400 dates for one definition. Only a show that runs every day of the week
can reach that, and only when the horizon is tuned above 400 days; it is then
stored 400 dates ahead instead, and the daily run keeps that many on the books.
A weekly show has under 110 dates even at the largest horizon of 730 days.

### The idempotency key

A recurring show is identified by its definition and its **air date**. The
`eventInstances` table has a unique index, `byDefinitionAirDate`, keyed
`<definitionId>|<airDate>`, and scheduling skips any date that already has a
row under that key, whatever the row's status. So:

- running the schedule twice creates nothing the second time, and on an
  unchanged world a day creates only the shows for the newly reached date;
- a cancelled show is never created again;
- a show taped on an earlier day keeps its air date, so its slot stays taken.

One-off shows have no definition and are left out of the index.

A new show copies `promotionId`, `brandId`, `name`, `importance` and `format`
from its definition, has `date` and `airDate` on the occurrence, and starts as
`scheduled`. Copying is deliberate: editing a definition later never rewrites
shows that are already stored.

### Events

- `show.scheduled { eventInstanceId, promotionId, date }`: one per show the
  daily phase adds, about two a day across the default world.
- `calendar.horizonExtended { from, through, created }`: one summary from the
  new-game setup step.

The setup step does not publish an event per show. The default world opens
with about 150 shows, and that many events at once would fill the
recent-events log before the player has done anything. A listener that needs
every opening show reads the table when `world.created` arrives, which is
published after the opening schedule.

## Placement

`placeShow(read, definition, date)` decides where a show is held and returns
the answer with a decision trace, for the Why? on the show sheet.

Venue:

1. The definition's preferred venue is used when it exists, is open on the day
   (`openedOn` is null or on or before the date, and `closedOn` is null or
   after it) and is either open to everyone or exclusive to the show's own
   promotion.
2. Otherwise the venue is left empty, which means "not chosen yet". Venue
   picking fills it in later.

Region, first match wins:

1. the definition's preferred region;
2. the region of the venue chosen above;
3. the promotion's home region.

Every show therefore has a region, even with no venue. The trace records each
rule that was checked and whether it passed, and its value says whether the
preferred venue was used (`preferredVenue`) or left open (`notChosen`).

## Lifecycle

A show moves `scheduled` → `booked` → `completed`, or ends as `cancelled`.

A cancelled show carries a `cancellation` record, `{ reason, on }`, so the two
ways a show can fail to happen stay apart:

| Reason        | Meaning                                   |
| ------------- | ----------------------------------------- |
| `notRun`      | Its day passed with the show still open   |
| `byPromotion` | The promotion that owned it called it off |

`cancellation` is set exactly when the status is `cancelled`, the same way
`result` is set exactly when the status is `completed`. The `byStatus` index
lets a phase read only the open shows instead of scanning every stored one.

The rules for closing an unrun show, who may cancel a show and what cancelling
costs are part of the show lifecycle work and are written up here when they
land.
