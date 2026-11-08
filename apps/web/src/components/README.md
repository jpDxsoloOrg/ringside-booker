# Shared UI components

The building blocks every screen composes: buttons, icons, panels, badges, stat bars, empty
states, layout helpers and formatters. Screens use these instead of inventing their own controls,
so the whole game looks and behaves the same, on desktop and on a phone.

Every component is in the component gallery at `/dev/gallery`. It ships in every build but no
navigation links to it, so it can be checked on a deployed build from a real phone.

## Folder convention

One folder per component, named after it:

```
components/
└── Button/
    ├── Button.tsx          the component
    ├── Button.module.css   its styles
    ├── Button.test.tsx     its unit tests
    └── index.ts            the public exports: the component and its types
```

- Import a component through its folder: `import { Button } from '@/components/Button'`.
- A folder can hold a close relative that shares the styles, such as `IconButton` in `Button/`
  and `CountBadge` in `Badge/`.
- Small helpers that are not components live in lower-case folders: `layout/` (`Stack`,
  `Cluster`, `VisuallyHidden`) and `format/` (number, money and date formatters).
- Shared types sit at the top level: `tone.ts` (the colour roles: `neutral`, `data`, `action`,
  `prestige`, `positive`, `negative`; the older names `info`, `warning` and `accent` still work and
  draw as `data`, `prestige` and `action`) and `classNames.ts`.

## Rules

- **Named exports only.** No default exports.
- **Typed props.** Each component's props are an exported interface called `<Name>Props`.
  No `any`.
- **CSS Modules and semantic tokens only.** Colours, spacing, radii and type come from the
  `--color-*`, `--space-*`, `--radius-*` and `--font-*` tokens in `styles/tokens.css`, never from
  `--palette-*` values or raw hex. See `docs/design/ui-tokens.md`.
- **No inline styles.** The `style` prop is a lint error. Geometry that depends on data (such as
  the length of a `StatBar`) is drawn with SVG attributes, and choices from a fixed set (such as a
  `Stack` gap) map to classes.
- **Accessible by default.** Real buttons and headings, an accessible name on every control,
  decorative icons hidden from screen readers, and focus styles from `global.css`.
- **Icons through `Icon` only.** `<Icon name="..." />` draws a Lucide glyph from the name map in
  `Icon/icons.ts`. Pass `decorative` when text beside it already says the same thing, otherwise a
  `label`; the props type rejects an icon with neither. Only `components/Icon` may import
  `lucide-react`, and only glyph by glyph (lint enforced), so unused icons stay out of the bundle
  and the set can be swapped in one file.
- **Phone-ready.** Below `--bp-mobile` the component still fits a 390px screen, and on touch
  screens (`@media (pointer: coarse)`) every control is at least `--tap-target-min` tall. Buttons
  also keep that height below `--bp-mobile`, so a phone-width window meets the 44px target too.
- **Tested.** Unit tests sit next to the component; the gallery e2e spec
  (`apps/web/e2e/gallery.spec.ts`) opens every gallery entry and checks layout, console errors,
  keyboard reach and accessibility at desktop and phone sizes.
- **In the gallery.** Every new component ships with a gallery entry (see below).

## Gallery entries

Each UI ticket's checklist includes a **Gallery entry** item: the component ships with a
`*.gallery.tsx` file in `apps/web/src/screens/dev-gallery/entries/`. Adding the file is the only
step; `entries/index.ts` collects every file with `import.meta.glob`, so there is no shared list
to edit and parallel tickets never conflict on one.

```tsx
// apps/web/src/screens/dev-gallery/entries/my-widget.gallery.tsx
import { MyWidget } from '@/components/MyWidget';
import type { GalleryEntry } from '../galleryEntry';

function MyWidgetDemo() {
  return <MyWidget />; // every variant and state, as a screen would use it
}

export const galleryEntry: GalleryEntry = {
  id: 'my-widget', // unique kebab-case; also the #hash that deep links to it
  title: 'MyWidget',
  group: 'Primitives', // 'Tokens' | 'Primitives' | 'Broadcast' | 'Art' | 'Data' | 'Overlays' | 'Engine'
  notes: 'Optional: what to look for.',
  render: () => <MyWidgetDemo />,
};
```

- Show every variant, size and state, including disabled, loading and empty.
- Keep `render` cheap and free of side effects; hooks go in a component it returns.
- Shared entry styles live in `entries/entries.module.css`.
- The gallery test (`galleryRegistry.test.ts`) fails on a missing `galleryEntry` export or a
  reused id, and the e2e spec opens the new entry on desktop and phone with no extra wiring.
- Check the entry in both themes and with the phone frame, which loads it in a 390px iframe so
  the `--bp-mobile` rules apply.

## What is here

| Component        | Use it for                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `Button`         | Every clickable action. Variants `primary`, `secondary`, `prestige`, `ghost`, `danger`; sizes `sm`, `md`, `lg` |
| `IconButton`     | An action shown as an icon only. Its `label` is required                                                       |
| `Icon`           | One of the inline SVG icons in `Icon/icons.ts`                                                                 |
| `Panel`          | A titled surface grouping related content, optionally collapsible. `office` card or `broadcast` (chamfered)    |
| `Badge`          | A short status chip in one of the colour roles (see `tone.ts`)                                                 |
| `CountBadge`     | A small count such as unread mail, capped at `99+`                                                             |
| `StatBar`        | A 0–100 value such as an attribute, popularity or condition. Cyan, red-orange when weak, gold when elite       |
| `EmptyState`     | What to show when a list, table or screen has nothing in it                                                    |
| `DataTable`      | Any dense list: sort, filter, checkboxes; a table on desktop, cards on phones                                  |
| `Tabs`           | `Tabs`, `TabList`, `Tab`, `TabPanel`: switch between views in one area                                         |
| `Sheet`          | A side panel over the page; a bottom sheet on phones                                                           |
| `ConfirmDialog`  | Ask before a destructive or irreversible action, with async `onConfirm`                                        |
| `Tooltip`        | A short hint on hover or focus. Never the only copy of anything                                                |
| `Popover`        | A small panel anchored to a button: detail, a filter, quick controls                                           |
| `DropdownMenu`   | A menu of actions behind a button, such as a row's "more" menu                                                 |
| `Select`         | Pick one option from a short list                                                                              |
| `Switch`         | An on/off setting that applies straight away                                                                   |
| `LiveBugButton`  | The skewed show action with a live dot: Next Day, Go Live                                                      |
| `LowerThird`     | Broadcast header block: kicker, big title, meta row, optional wedge                                            |
| `ScoreBug`       | A strip of 2–4 key numbers, each with an optional Why? chip                                                    |
| `Ticker`         | The news crawl; pauses on hover or focus, static with reduced motion                                           |
| `SegmentedMeter` | Hype, heat or fatigue as ticks that turn red-orange past a threshold                                           |
| `CardSlot`       | A booking slot: role, matchup, chips, winner, or the empty add actions                                         |
| `ChamferPanel`   | The broadcast container with chamfered corners (`Panel` is the office one)                                     |
| `SlashDivider`   | A band of 45° slashes, or the inline `//` between items                                                        |
| `Stack`          | Children in a column (or row) with a token gap                                                                 |
| `Cluster`        | A wrapping row with a token gap                                                                                |
| `VisuallyHidden` | Text for screen readers only                                                                                   |
| `format/`        | `formatMoney`, `formatNumber`, `formatPercent`, `formatSigned`, dates                                          |
| `Explained`      | A derived number with its Why? button: the one element a screen needs to show an explained number              |
| `WhyButton`      | The help button that opens a number's "Why?" panel; one panel is open at a time                                |
| `TracePanel`     | The "Why?" panel: a calculation trace as readable steps, inline or fetched by `traceRef`                       |

Money is integer `Cents` and dates are `GameDate` strings from `@ringside/engine`; the formatters
turn them into text at the edge and nowhere else.

## Why? panel

Every derived number can explain itself (see `docs/design/calculation-traces.md`). A screen shows
one with `<Explained value={...} label="Attendance" unit="people" trace={...} />`, or with
`traceRef={...}` when its query hands back a reference; with neither it shows just the number.

- **Words, not formulas.** `Trace/wording.ts` turns each node into a sentence ("Capped 112 → 100
  (maximum)", "+6 Main event bonus"). The rows and the copy-as-text export both read it, so a bug
  report says what the player saw.
- **Every kind has a row.** `Trace/kinds.ts` picks the row for each node kind with an exhaustive
  switch, so a kind added in the engine fails the typecheck until it has a renderer.
- **Quiet checks are hidden.** Limits that changed nothing and branches not taken sit behind
  "Show checks that didn't apply". Groups start open down to depth 2, with Expand all and
  Collapse all, and the arrow keys move through the tree.
- **One panel at a time.** `tracePanelStore` holds the open panel's id; opening another replaces
  it, and closing returns focus to the button that opened it.
- **Older results.** A `traceRef` whose trace has been summarised shows the summary with "Full
  breakdown is only kept for recent results".

## DataTable

`DataTable<Row>` takes rows, column definitions, `getRowId` and a `caption`, and gives both
layouts: a captioned, sortable table with sticky headers on desktop, and a labelled list of
stacked cards with a "Sort by" select below `--bp-mobile`. The cards are their own DOM, not
restyled table cells, so each layout keeps its screen reader semantics.

[TanStack Table](https://tanstack.com/table) (see `docs/design/visual-identity.md`) does the row
work: sorting, the filter, checked rows and hidden columns. It is headless, so the markup and the
look stay ours. Screens never import `@tanstack/*`; they pass our `ColumnDef` and props, and
`tableModel.ts` / `useDataTableModel.ts` translate them. Every piece of state can be left to the
table or controlled by the screen (`sort` / `filter` / `checkedRowIds` / `hiddenColumnIds`, each
with its `on…Change`).

- **Card roles are chosen by the screen.** Each column says where it goes on a phone card:
  `media`, `title`, `subtitle`, `stat` (the first six are shown, labelled with `cardLabel` or the
  header), `meta` or `hidden`. Only the screen knows which few numbers matter most on a phone.
- **Stat-table look.** Headers are Barlow Condensed capitals with a little tracking, as are the
  card stat labels. `numeric` columns sit on the right with the global `.tabular` class.
- **Sorting** (`sortable`, on by default; start with `initialSort`): numbers numerically, text
  naturally ("Worker 2" before "Worker 10"), empty values last in both directions, ties by row id.
  A header click cycles through the column's first direction (high to low for `numeric` columns,
  A to Z otherwise), the other direction, then no sort. On phones the "Sort by" select and a
  direction toggle do the same. For big engine-side lists, control `sort` and pass it to the query
  through `onSortChange` instead.
- **Filter** (`filterable`): a search box above the rows that matches any searched column,
  ignoring case and accents. Columns are searched by their `filterValue`, or by their text
  `sortValue` when they have no `filterValue`; numbers are only searched when a column asks for it
  through `filterValue`. Escape clears the box, and "No matches" offers "Clear filter".
- **Checked rows** (`selectable`): a checkbox per row and "select all" in the header, for bulk
  actions. Shift-click checks a range, Space checks the current row from the keyboard, and the
  toolbar shows the count with "Clear selection". This is separate from the current row
  (`selectedRowId` / `onSelect`), which the arrow keys move and Enter opens. On a card the
  checkbox sits in the corner as the card's sibling, so the card stays one clean button.
- **Hidden columns** (`columnPicker`, `defaultHiddenColumnIds`): a "Columns" popover lists every
  column whose `hideable` is not false. The `title` column cannot be hidden. Hidden columns leave
  the cards too.
- **Keyboard:** the table is one Tab stop. Up and Down move the selection, Home and End jump,
  Enter opens the selected row, Space checks it when `selectable`. A click on a link, button or
  checkbox inside a cell does not open the row.
- **Keep `columns` and `getRowId` stable** (module level or `useMemo`) so rows only re-render
  when their own data, selection or checkbox changes.
- **Size:** built and benchmarked for 500 rows by 10 columns (`DataTable.bench.ts`). There is no
  windowing yet. `rowWindow.ts` is the hook point: from `WINDOWING_ROW_THRESHOLD` (300) rows a
  roster should switch on `@tanstack/react-virtual` there, and the comment in that file lists the
  steps. Nothing outside that file has to change.

## Overlays and Radix

The interactive behaviour of `Tabs`, `Sheet`, `ConfirmDialog`, `Tooltip`, `Popover`,
`DropdownMenu`, `Select` and `Switch` comes from [Radix UI](https://www.radix-ui.com/primitives)
(see `docs/design/visual-identity.md`): focus management, keyboard handling and screen reader
semantics. Radix ships no styles, so the look is still ours, in each component's CSS Module on the
tokens. Screens import our wrappers, never `@radix-ui/*` directly, so the props stay ours too.

- `Sheet` and `ConfirmDialog` are modal Radix dialogs. Both are controlled: the parent owns `open`
  and clears it in `onClose`. Nothing renders while they are closed. They trap focus, close on
  Escape (the topmost one only), and hide the rest of the page from screen readers.
- Radix only returns focus to its own `Trigger` part. Our overlays are opened by any control, so
  `useOverlayFocus` (in `Sheet/`) remembers what had focus on open and focuses it again on close,
  and picks the first element to focus. A new modal overlay reuses it. When a `DropdownMenu` item
  opens a `Sheet` or `ConfirmDialog`, focus goes back to the menu's trigger, because the item has
  gone by then (the menu marks itself with `RETURN_FOCUS_ATTRIBUTE`).
- A screen that wants "a side panel" uses `Sheet` with a `side`. On phones the sheet decides to
  open from the bottom instead (turn that off with `responsiveSide={false}`).
- While any overlay is open, `useBodyScrollLock` puts the `scroll-locked` class on `<html>`. Holds
  are counted, so a `ConfirmDialog` opened from inside a `Sheet` keeps the page locked when it
  closes.
- Stacking uses the `--z-sheet`, `--z-overlay` and `--z-popover` tokens, so a confirm opens above
  a sheet and a menu or select opened inside either sits above both.
- Animate a Radix part only in its open state (`[data-state='open']`). Radix keeps a closing part
  mounted until an animation running on it ends, so an animation that also matched the closed
  state would leave it on screen.
- `Tooltip`, `Popover` and `DropdownMenu` take their trigger as a single element that forwards its
  ref, such as `Button` or `IconButton`.
- Radix sets a few inline styles of its own (positioning, `pointer-events` while modal). The
  no-`style` rule is about our markup; it never applies to what a library does at run time.
- jsdom lacks pointer capture, `scrollIntoView` and `ResizeObserver`; `src/test/domStubs.ts` stubs
  them for unit tests. Layout, positioning and pointer behaviour are checked by the e2e specs
  (`gallery.spec.ts` and `overlays.spec.ts`) in a real browser.

## Broadcast kit

The components for show moments (see the broadcast register in
`docs/design/visual-identity.md`): `LiveBugButton`, `LowerThird`, `ScoreBug`, `Ticker`,
`SegmentedMeter`, `CardSlot`, `ChamferPanel` and `SlashDivider`. They sit in the gallery's
**Broadcast** group.

- **Generic on purpose.** None of them knows a game type. A screen passes text, numbers, image
  subjects and slots (`children`, `footer`, `why`, `dragHandle`, `actions`), so booking and results
  screens compose them from whatever their queries return.
- **Motion.** Transitions use the `--motion-*` tokens, which reduced motion sets to 0ms. Looping
  animations (the live dot, the ticker crawl) also have their own reduced-motion rules for the OS
  setting and for `data-reduced-motion="on"`. Where the DOM itself changes, `useReducedMotion()`
  from `styles/useReducedMotion.ts` decides: the ticker drops its loop copy and pause button and
  becomes a wrapping static list. `broadcastKit.test.ts` checks these rules for every stylesheet.
- **Never colour alone.** The meter adds a warning icon and a word in the danger zone, and the
  card slot's winner marker says "Winner" (or the label you pass).
- **Phones.** `CardSlot` stacks its sides, a four-stat `ScoreBug` wraps to 2×2, and a `docked`
  `Ticker` sticks above the bottom tab bar.
