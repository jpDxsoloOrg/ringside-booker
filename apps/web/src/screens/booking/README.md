# Booking screen

`/game/booking`: one of your shows at a time, its card slot by slot, the checklist and, on the
show's day, **Run the show**. It is also the show screen: Go to the show opens it (EVT2-09).
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
| `ShowBar.tsx`                   | Run the show (show day), "Fix N problems to run the show", Clear card           |
| `calendarAction.tsx`            | "Book this show" / "Edit card" / "Go to the show" in the calendar's show sheet  |
| `bookingUrl.ts`                 | `bookingShowUrl(id)`: `/game/booking?event=<id>`                                |
| `registries/bookingPanels.ts`   | `registerBookingPanel`: feature panels beside or under the card                 |
| `sections/index.ts`             | The append-only list of feature files that register panels (and editor parts)   |
| `editor/editorStore.ts`         | `useSegmentEditor`: the seam the segment editor (EVT2-06) opens from            |
| `editor/SegmentEditorSheet.tsx` | The segment editor: a match or talking segment for one slot, saved whole        |
| `editor/useSegmentDraft.ts`     | The editor's local draft and its pure reducers                                  |
| `editor/editorText.ts`          | Limits as short text, side names, the slot title                                |
| `editor/SideBuilder.tsx`        | One block per side with its people, hints from the catalog's limits             |
| `editor/EditorRosterPicker.tsx` | `RosterPicker` fed by `booking.availableWorkers` for the draft                  |
| `editor/TypeField.tsx`          | The type `Select` and its Long / Short chip from `match.slotRoles`              |
| `editor/TitlesField.tsx`        | Titles on the line, with the missing-champion note                              |
| `editor/PlannedResultField.tsx` | Winner, draw or no contest, and the method                                      |
| `editor/useRoster.ts`           | The show's roster by person and team, for names and availability                |
| `registries/cardSlotChips.tsx`  | `registerCardSlotChips`: chips features add to slots (CRTV4's storyline chips)  |

## Data

- `booking.shows` (limit 60) lists your shows to book. The screen opens on `?event=` when it names
  one of them, else on `nextToBookId`, else the first row, and writes that id back to the URL
  with `replace`. A show that has run drops out of the list; after Run the show the screen opens
  the results instead (and stops rewriting the URL while the results route loads).
- `booking.card` draws the card; `booking.validate` the checklist, the per-slot problem markers
  and whether Run the show is on. Both refetch after every command and every simulated day.
- `match.finishes` and `match.catalog` are read per match row for the Winner menu's way of
  winning: the type's first method that can move a title (`defaultWinMethodKey`).
- Commands: `booking.moveSegment`, `booking.setResult`, `booking.removeSegment`,
  `booking.clearCard`, `shows.runTonight`. A refusal is shown as the engine words it, in a
  dismissable notice (Remove and Clear show it inside their confirmation); a reason about one
  segment is a button that jumps to its slot.

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

## Show night

There is no Lock card (EVT2-09): a card stays editable until its show has run. On the show's day
Next Day stops with "Tonight: <Show>" and **Go to the show** (the day button, the advance banner,
the calendar sheet) opens the show here. The status reads Tonight and **Run the show**
(`shows.runTonight`) sits in the header (the sticky bar on a phone). It is disabled until
`booking.validate` says `runnable`, with "Fix N problems to run the show" as its description;
warnings never block. Once it has run, the results page opens with the reveal
(`/game/event-history/<id>?reveal=1`). On any other day there is no run button; the checklist is
guidance. **Clear card** asks first.

## Phone

One column. The checklist folds into a sticky bar above the tab bar ("3 problems" and, on show
day, Run the show), the only sticky element on the screen; tapping the count opens the checklist in a bottom
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

Registered so far: `shows.ranBanner` (side, order 5, `screens/show-results/bookingPanel.tsx`):
"This show has run" and "See results" on a completed show. `booking.card` already answers a
completed show with `canEdit: false`, so the board is read-only by itself.

`boxOffice.venueCrowd` (side, order 20, "Venue and crowd", `venue/register.tsx`, EVT6-06): the
show's venue, capacity, expected crowd with its Why? and fit, Change venue and Pick for me. See
`app/README.md#venue-and-crowd`.

`aip.autoFill` (side, order 50, "Auto-fill", `panels/register.tsx`, AIP4-07): Auto-fill empty
slots, Rebook whole card behind a confirmation, and the reasons sheet. It never picks a winner.
See `docs/design/rival-booking.md#auto-fill`.

### The segment editor (EVT2-06)

The card never imports the editor. Its add actions call
`useSegmentEditor.getState().openNew({ eventInstanceId, preShow, slot, kind })` (`slot` stored,
0-based; `kind` `match` or `angle`) and Edit calls `openExisting(segmentId)`. `BookingView`
draws `<SegmentEditorSheet card={card} />` with the loaded card, so the editor finds the slot or
the segment (and its `draft`, the editor's starting point) there. EVT2-06 replaces the body of
`editor/SegmentEditorSheet.tsx`, keeping its name and props, and saves through
`booking.addSegment` / `booking.updateSegment`; the card refetches on its own.

The editor (EVT2-06) works on a local copy of the engine's `SegmentDraft` and writes nothing
until **Save**, which sends the whole draft in one `booking.addSegment` or
`booking.updateSegment`. Its body, top to bottom: Kind (only when adding), Type, Sides, Titles
(matches whose type allows them), Result (matches), Billing line, then registered sections.

- **Type.** `match.catalog`'s types in catalog order with their limits ("2 sides · 1 each",
  "1–4 speakers"). A match type that moves the slot's size shows a Long or Short chip, read from
  `match.slotRoles` with the type in this slot, so it matches the card's own Why?. Changing the
  type drops sides past its most (and the people on them), clears a winner that no longer exists
  and takes titles off a type that can't carry them.
- **Sides.** One block per side, or Speakers (with an optional second side for a type that takes
  more than one speaker). Hints come from the catalog only ("Needs 1 more on this side"); Save
  needs people on two sides of a match, or one speaker. Everything finer is the engine's refusal
  or the checklist's problem, never the editor's own rule.
- **Roster picker.** `components/RosterPicker`, fed by `booking.availableWorkers` with the
  draft's kind and a 200 ms debounced search. Bookable only is on by default; unbookable rows are
  dimmed with the reason as their description. Hide booked is on by default too: people already
  in another segment of this card (and teams with such a member) are left out, and the list says
  how many; turning it off shows them with "On this card: …". A team adds every member with its `teamId`.
  Each person's row reads "High flyer · Pop 54 · Stamina 72" (`workerTypeLabel`, `workerStats`):
  the ring style through `STYLE_LABELS` (a manager or presenter shows their role), popularity in
  the show's region (`booking.availableWorkers`' `region`, named in a line under the filters) and,
  for wrestlers, stamina, rounded. Screen readers hear "Popularity in <region> 54". Most popular
  sorts by popularity. Fatigue (WRK6) is not tracked yet; when it is, it is one more entry in
  `workerStats`, and nothing stands in for it until then.
  The line starts with the worker's gender in the profile's words (`GENDER_LABELS`: "Woman ·
  High flyer · …"), and a team row says "Women", "Men" or "Mixed". Gender and Push chips open
  small menus (`genderAndPushFilters`): Gender is All, Men, Women or Non-binary, and a team
  matches when every member does; Push takes one or more pushes in `PUSH_LABELS`' words, and a
  team matches when any member does. They combine with the other filters, the list counts what
  they hide, and the choice holds while the editor is open. They only narrow the list: any
  gender or push mix can be booked (EVT2-11).
- **Phones.** The picker's search box takes focus as it opens, so on a touch screen it and the
  billing line are 16px: Safari on iPhone zooms the page in on a smaller text field and leaves it
  zoomed (EVT2-10). Long names wrap on a phone rather than being cut off, and
  `e2e/segment-editor.spec.ts` checks the editor and the open picker fit with no sideways scroll.
- **Teams by name and wrestlers.** A team side says "Team: Running Axe" above its wrestlers; the
  Result choice, the card row's Winner menu (`bookingSideText`) read "Side 1: Running Axe (Kai
  Moreno & Rex Hale)", and the card row puts the wrestlers under the team's name
  (`teamMembersText`).
  Until MTCH5 owns beats, changing a talking segment's speakers drops its beats so the engine
  writes the type's default beat.
- **Titles and result.** `booking.card`'s `titleOptions`, with "Add the champion, … to a side"
  as a heads-up (the engine's `championMissing` decides). A new win starts on the first method
  that can move a title; one that can't says "(titles can't change)" when titles are on the line.
  On a Random winners show (`booking.card`'s `randomWinners`) the Result choice is replaced by
  "Decided on the night (Random winners)" and the card row's menu has no Winner entry.
- **Saving.** Refusals show at the top of the sheet word for word, and the part of the sheet a
  reason's `field` names gets a red edge. Success closes the sheet and announces "Saved to slot
  3". Remove asks first. Closing with changes asks "Discard changes?". The draft is taken from
  the card once, when the sheet opens; a refetch never replaces what is being edited.
- **Phone.** The sheet fills the screen (`Sheet` `phoneHeight="full"`); the picker is a bottom
  sheet over it.

### Editor sections

```ts
registerSegmentEditorSection({
  id: 'match.finish', // feature-prefixed, unique
  order: 10, // after the Result field, lowest first, then by id
  appliesTo: 'match', // 'match' | 'angle' | 'both'
  title: 'Finish',
  render: ({ draft, patch, show, slot, disabled, randomWinners }) => <FinishField ... />,
});
```

`randomWinners` is true when Random winners decides the show's results, for a section that plans
part of the result. Wired so far (EVT2-07): MTCH2's Finish section,
`sections/BookingFinishSection.tsx`; see `docs/design/booking.md#integration`.

A section changes only its part of the draft with `patch` (`label`, `storylineIds`, `crew`,
`outcome`, or fields of `match` / `angle` for its own kind) and never calls a command: the sheet
saves it with everything else. If a section needs a field the draft lacks, it widens
`SegmentDraftSchema`. Register from a feature file listed in `sections/index.ts`; the registry is
`registries/segmentEditorSections.ts`.

### The calendar

`calendarAction.tsx` registers `booking.book` (order 10) with the calendar's
`registerShowSheetAction`: "Book this show", or "Edit card" once something is booked, or "Go to
the show" on the show's day, for your own open shows dated today or later (`booked` only comes
from a save made before the lock was removed). It never edits `ShowDetailSheet.tsx`.
