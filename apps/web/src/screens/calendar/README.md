# Calendar screen

`/game/calendar`: every dated show, a month at a time. On desktop it is a month grid; below
`--bp-mobile` the same month is an agenda grouped by week. Picking a show opens its sheet.

| File                  | What it does                                                             |
| --------------------- | ------------------------------------------------------------------------ |
| `CalendarScreen.tsx`  | The page heading and title; loads the rest as its own chunk              |
| `CalendarView.tsx`    | The toolbar, the queries, the URL state and which month view is drawn    |
| `MonthGrid.tsx`       | The desktop grid: a `role="grid"` table, chips, "+N more", keyboard      |
| `AgendaList.tsx`      | The phone list: weeks headed "Week of Mon 4 Jan"                         |
| `ShowDetailSheet.tsx` | One show's facts, its status and Cancel show                             |
| `DayMarkers.tsx`      | Gathers the day markers every registered source returns                  |
| `calendarMonth.ts`    | Month maths: the weeks on screen, grouping by date, `YYYY-MM` in the URL |
| `importance.ts`       | The importance labels (House show, Minor, Regular, Major, Flagship)      |
| `slotsText.ts`        | "6 main slots", "8 main slots + 1 pre-show"                              |
| `statusText.ts`       | A show's status in words, and the badge tone that goes with it           |
| `placementWording.ts` | The venue's Why? with its outcome in words instead of the rule's key     |
| `registry.ts`         | The five extension slots (below)                                         |

The chip is a shared component, `components/ShowChip`, so other screens can list shows the same
way. It leaves out a brand tag that would only repeat the show's name.

## Data

- `clock.get` gives today. With no world loaded the screen says "No game loaded".
- `calendar.range` gives the stored shows and `calendar.projected` the ones past the stored
  horizon, both for the weeks on screen: the Monday on or before the 1st to the Sunday on or after
  the last day. Projected shows are drawn dashed and listed after the stored ones on a day.
- `calendar.show` is read only while a stored show's sheet is open. It adds how often the show
  runs and the reasoning for where it is held (the Why? beside the venue).
- `calendar.cancelShow` runs from the sheet's Cancel show, after a confirmation. A refusal shows
  the game's reason inside the confirmation.

No row carries a running time, and nothing here prints one: a card is slots (design decision D-10).

## URL

Everything that should survive a reload is in the query string, and other screens link in with
`routes.game.calendarAt({ month, scope, show })`:

| Parameter | Values             | Default                      |
| --------- | ------------------ | ---------------------------- |
| `month`   | `YYYY-MM`          | The month of the game's date |
| `scope`   | `mine`, `world`    | `mine`                       |
| `show`    | A stored show's id | None: the sheet is closed    |

A value that is the default is left out. A seat that runs no promotion always sees the whole
world, with no switch. A projected show has no id, so its sheet is local state and is not in the
URL. Changes replace the history entry, so Back leaves the calendar.

## Keyboard

One day of the grid is in the Tab order (the last one focused, else today, else the 1st). The
arrow keys move a day or a week, Home and End go to the ends of the week, and Enter on a day
opens its first show. Chips and "+N more" are buttons reached with Tab from their day. Closing the
sheet puts focus back on the chip or day that opened it; a sheet opened from a link puts it on
the show's day.

## Extension slots

Other features add to the calendar from their own files by registering with `registry.ts`. Every
`register…` call returns a function that removes the definition again and throws when the id is
already taken. An open calendar re-renders when a list changes. Use ids prefixed with the
feature, such as `booking.open`.

| Slot          | Register with                                            | Drawn                                        | Expected to use it                                |
| ------------- | -------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Sheet action  | `registerShowSheetAction({ id, order, render })`         | The sheet's footer row, before Cancel show   | Booking ("Book this show"), venue picking, taping |
| Sheet section | `registerShowSheetSection({ id, order, title, render })` | A titled section under the sheet's facts     | TV deals (the airing line)                        |
| Chip badge    | `registerShowChipBadge({ id, order, render })`           | The end of every show chip                   | Hype (a hype badge), taping ("Taped")             |
| Day markers   | `registerCalendarDayMarkers({ id, useMarkers })`         | A badge on a day, on the grid and the agenda | Drafts (draft day), seasons (season end)          |
| Toolbar item  | `registerCalendarToolbarItem({ id, order, render })`     | The end of the calendar's toolbar            | One-off shows ("New show")                        |

### Registered so far

- `booking.book` (sheet action, order 10): "Book this show" / "Edit card" for your own open
  shows, from `screens/booking/calendarAction.tsx`.

When another feature registers, add its id here. The ids the planned features will use are in
[`docs/design/calendar.md`](../../../../../docs/design/calendar.md#integration).

| Slot          | Registered ids |
| ------------- | -------------- |
| Sheet action  | None           |
| Sheet section | None           |
| Chip badge    | None           |
| Day markers   | None           |
| Toolbar item  | None           |

What each `render` is given:

- **Sheet action and section:** `{ show, isOwn, today }`. `show` is the calendar row (or the
  fuller `calendar.show` answer once it has loaded); a projected show has a null
  `eventInstanceId`, so an action that needs a stored show returns null for it. Returning null
  leaves the action or the whole section out.
- **Chip badge:** `{ show }`. The badge sits inside the chip's button, so it must be text or a
  `Badge`, never a control. Its text becomes part of the chip's accessible name.
- **Toolbar item:** `{ month, scope, today }`, where `month` is the first day of the month on
  screen.
- **Day markers:** `useMarkers({ from, to })` is a hook, called while a calendar is open with the
  first and last day on screen. It returns `{ date, label, tone }[]` and may run its own engine
  queries. Markers outside the range are ignored. `tone` is one of the colour roles in
  `components/tone.ts`; the label always says what the day is, so the colour is never the only
  cue.

```ts
import { registerShowSheetAction } from '@/screens/calendar/registry';

registerShowSheetAction({
  id: 'booking.open',
  order: 10,
  render: ({ show, isOwn }) =>
    isOwn && show.eventInstanceId !== null ? <BookShowButton show={show} /> : null,
});
```
