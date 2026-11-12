# Booking screen

`/game/booking`: one of your shows at a time, its card slot by slot, the checklist and Lock card.
On desktop the card sits beside a side column with the checklist; below `--bp-mobile` it is one
column with a sticky bar at the bottom. The engine side is in
[`docs/design/booking.md`](../../../../../docs/design/booking.md).

| File                            | What it does                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `index.ts`                      | Exports the screen; registers the calendar action and the feature panels        |
| `BookingScreen.tsx`             | The `h1` and title; loads the rest as its own chunk                             |
| `BookingView.tsx`               | Show choice and URL, the header, commands, layout, phone bar, refusal notice    |
| `CardBoard.tsx`                 | The card: a section per `booking.card` section, a `CardSlot` per slot, drag     |
| `cardSlotProps.ts`              | `toCardSlotProps`: one slot of `booking.card` as `CardSlot` props; issue counts |
| `SlotActions.tsx`               | A filled slot's menu (Edit, Winner ▸, Move up/down, Remove) and phone buttons   |
| `ValidationChecklist.tsx`       | `booking.validate` as checklist lines, then every problem with its slot         |
| `LockBar.tsx`                   | Lock card / Unlock card, "Fix N problems to lock", Clear card                   |
| `calendarAction.tsx`            | "Book this show" / "Edit card" in the calendar's show sheet                     |
| `bookingUrl.ts`                 | `bookingShowUrl(id)`: `/game/booking?event=<id>`                                |
| `registries/bookingPanels.ts`   | `registerBookingPanel`: feature panels beside or under the card                 |
| `sections/index.ts`             | The append-only list of feature files that register panels (and editor parts)   |
| `editor/editorStore.ts`         | `useSegmentEditor`: the seam the segment editor (EVT2-06) opens from            |
| `editor/SegmentEditorSheet.tsx` | A stand-in sheet until EVT2-06 replaces it                                      |

## Data

- `booking.shows` (limit 60) lists your shows to book. The screen opens on `?event=` when it names
  one of them, else on `nextToBookId`, else the first row, and writes that id back to the URL
  with `replace`. A show that has run drops out of the list, so after Next Day the screen moves
  on to the next show by itself.
- `booking.card` draws the card; `booking.validate` the checklist, the per-slot problem markers
  and whether Lock is on. Both refetch after every command and every simulated day.
- `match.finishes` and `match.catalog` are read per match row for the Winner menu's way of
  winning: the type's first method that can move a title (`defaultWinMethodKey`).
- Commands: `booking.moveSegment`, `booking.setResult`, `booking.removeSegment`,
  `booking.clearCard`, `booking.lockCard`, `booking.unlockCard`. A refusal is shown as the engine
  words it, in a dismissable notice (Remove and Clear show it inside their confirmation).

Nothing on the screen is a time (D-10). The only derived values are the slot role, the size class
("Short", "Standard", "Long") and the minimum filled count, each with its Why?.

## Reordering

Moves swap, as the engine does. A filled slot moves by its drag handle (`SortableList` in swap
mode, pointer and keyboard), or by Move up / Move down (the slot before or after it in its
section, open or not). Until the engine answers, the screen draws the swap from a local
override (`withPendingMove`); the query cache is never written. A newer `booking.card` answer
replaces the override; a refusal drops it and shows the reason. Each move is announced once:
by the drag's own live region, or by the shell's announcer for a button.

On a phone the drag handle is hidden and Move up / Move down are 44px buttons on each row.

## Locking

**Lock card** is disabled until `booking.validate` says `runnable`, with "Fix N problems to
lock" under it. Locked, the status reads Booked, every editing control hides and **Unlock card**
appears (only when the lock is the one thing stopping changes). **Clear card** asks first.

## Phone

One column. The checklist folds into a sticky bar above the tab bar ("3 problems" and Lock
card), the only sticky element on the screen; tapping the count opens the checklist in a bottom
sheet. Up to two registered `phoneSummary` lines sit above it; tapping one opens its panel in a
bottom sheet.

## Extension points

### Booking panels

```ts
registerBookingPanel({
  id: 'forecast.card', // feature-prefixed, unique
  order: 10,
  placement: 'side', // 'side': under the checklist; 'below': under the card
  title: 'Forecast', // optional: heads the panel as a named region
  render: ({ eventInstanceId, card, validation }) => <ForecastPanel ... />,
  phoneSummary: ({ card, validation }) => 'Forecast: 74, B', // optional, one line
});
```

Register from a file of your feature and add one import line to `sections/index.ts`. The call
returns an unregister function and throws for a taken id. `validation` is null while the checks
load. Expected users: EVT4's forecast, EVT6's venue and crowd, CRTV8's tournament matches, AIP4's
auto-fill.

### The segment editor (EVT2-06)

The card never imports the editor. Its add actions call
`useSegmentEditor.getState().openNew({ eventInstanceId, preShow, slot, kind })` (`slot` stored,
0-based; `kind` `match` or `angle`) and Edit calls `openExisting(segmentId)`. `BookingView`
draws `<SegmentEditorSheet card={card} />` with the loaded card, so the editor finds the slot or
the segment (and its `draft`, the editor's starting point) there. EVT2-06 replaces the body of
`editor/SegmentEditorSheet.tsx`, keeping its name and props, and saves through
`booking.addSegment` / `booking.updateSegment`; the card refetches on its own.

### The calendar

`calendarAction.tsx` registers `booking.book` (order 10) with the calendar's
`registerShowSheetAction`: "Book this show", or "Edit card" once something is booked, for your
own scheduled or booked shows dated today or later. It never edits `ShowDetailSheet.tsx`.
