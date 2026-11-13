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
- `extensionRegistry.ts` builds the lists other features add to without editing a screen (the
  calendar's slots, `ShowChip` badges): `register` returns an unregister function and throws on
  a taken id.
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
  group: 'Primitives', // 'Tokens' | 'Primitives' | 'Broadcast' | 'Office' | 'Art' | 'Data' | 'Overlays' | 'Engine'
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

| Component              | Use it for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`               | Every clickable action. Variants `primary`, `secondary`, `prestige`, `ghost`, `danger`; sizes `sm`, `md`, `lg`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `IconButton`           | An action shown as an icon only. Its `label` is required                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Icon`                 | One of the inline SVG icons in `Icon/icons.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Panel`                | A titled surface grouping related content, optionally collapsible. `office` card or `broadcast` (chamfered)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Badge`                | A short status chip in one of the colour roles (see `tone.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `CountBadge`           | A small count such as unread mail, capped at `99+`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `StatBar`              | A 0–100 value such as an attribute, popularity or condition. Cyan, red-orange when weak, gold when elite                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `EmptyState`           | What to show when a list, table or screen has nothing in it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `DataTable`            | Any dense list: sort, filter, checkboxes; a table on desktop, cards on phones                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Tabs`                 | `Tabs`, `TabList`, `Tab`, `TabPanel`: switch between views in one area                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Sheet`                | A side panel over the page; a bottom sheet on phones. `phoneHeight="full"` fills a phone screen for a long form                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ConfirmDialog`        | Ask before a destructive or irreversible action, with async `onConfirm`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Tooltip`              | A short hint on hover or focus. Never the only copy of anything                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Popover`              | A small panel anchored to a button: detail, a filter, quick controls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `DropdownMenu`         | A menu of actions behind a button, such as a row's "more" menu; one level of submenus ("Winner ▸")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Select`               | Pick one option from a short list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Switch`               | An on/off setting that applies straight away                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `LiveBugButton`        | The skewed show action with a live dot: Next Day, Go Live                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `LowerThird`           | Broadcast header block: kicker, big title, meta row, optional wedge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ScoreBug`             | A strip of 2–4 key numbers, each with an optional Why? chip                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Ticker`               | The news crawl; pauses on hover or focus, static with reduced motion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `SegmentedMeter`       | Hype, heat or fatigue as ticks that turn red-orange past a threshold                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `CardSlot`             | A booking slot: role, matchup of any number of sides, chips, winner or result, an optional `result` area under the matchup (a rival's result line), problem marker, or the empty add actions                                                                                                                                                                                                                                                                                                                                                                                       |
| `ChamferPanel`         | The broadcast container with chamfered corners (`Panel` is the office one)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `SlashDivider`         | A band of 45° slashes, or the inline `//` between items                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `KpiCard`              | An office stat card: label, big number (tone `negative` for a figure in the red), delta chip (with its own Why? in `delta.why`), optional sparkline. `KpiCardGrid` lays them out                                                                                                                                                                                                                                                                                                                                                                                                   |
| `DeltaChip`            | A change in a number: ▲/▼, the signed amount and a note, in the positive or negative colour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Sparkline`            | A tiny inline-SVG line of a recent series, named by its ends and trend                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `AlignmentChip`        | FACE / HEEL / TWEENER in the alignment colours, always with the word                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `AvailabilityChip`     | Whether someone can work today: the status in words and colour, the first day back, the reason in a tooltip                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `WorkerLink`           | A person's name as a link to their profile. Use it wherever a screen shows a worker's name; `truncate` keeps a long name on one line with an ellipsis and the whole name as the tooltip                                                                                                                                                                                                                                                                                                                                                                                            |
| `ChampionCard`         | A title and its champion: belt, champion, reign, defences, prestige. `ChampionCardList` lays them out                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `Stack`                | Children in a column (or row) with a token gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Cluster`              | A wrapping row with a token gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `VisuallyHidden`       | Text for screen readers only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `format/`              | `formatMoney`, `formatSignedMoney` (with `spokenSignedMoney`: "minus $30,357"), `formatNumber`, `formatPercent`, `formatSigned`, dates                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Explained`            | A derived number with its Why? button: the one element a screen needs to show an explained number                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `WhyButton`            | The help button that opens a number's "Why?" panel; one panel is open at a time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `TracePanel`           | The "Why?" panel: a calculation trace as readable steps, inline or fetched by `traceRef`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `LazyWhyButton`        | A Why? button for a list cell: the trace is built by an engine query (`workers.explain`) only when the panel opens                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `PopularityDrilldown`  | A person's or promotion's popularity from the world down: continents open into countries, countries into regions, with a Why? on every worked-out figure                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ShowChip`             | One show on a calendar or in a list of shows: importance bar and tint, name, brand or promotion tag; struck through when cancelled, dashed when projected. Other features add badges with `registerShowChipBadge`                                                                                                                                                                                                                                                                                                                                                                  |
| `StarRating`           | A 0–5 star rating in quarter steps, filled by a CSS clip; named "3.75 stars out of 5", "No stars" for 0. Sizes `sm`, `md`, `lg`; tones `office`, `broadcast`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `Histogram`            | How values spread across bins: inline-SVG bars, ticks, an optional mean line and ±1 sd band, and a hidden table of the same numbers. "No runs yet" when empty                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `SegmentResultCard`    | One finished segment from `shows.results`: sides with the winner marked, the result line, stars with a Why? on each number and the title banner; `revealed={false}` keeps its height                                                                                                                                                                                                                                                                                                                                                                                               |
| `SortableList`         | Reorder a list by drag or keyboard: `SortableList`, `SortableItem`, `useSortableHandle`; `insert` or `swap` mode, every step announced. The only place that imports `@dnd-kit`                                                                                                                                                                                                                                                                                                                                                                                                     |
| `RosterPicker`         | Pick people or a team for a segment: debounced search, Bookable only / This brand / Teams filters (plus Hide booked with `bookedFilter`), type and stats ("High flyer · Pop 54 · Stamina 72", `typeLabel` and `stats`, each stat's full name for screen readers), an optional `sortStat` chip ("Most popular") and `statsNote`, gender in words first on the stats line, Gender and Push menu chips with `genderAndPushFilters` (a team shows "Mixed" when its members differ), push, alignment and availability; unbookable rows dimmed with the reason. Also `AvailabilityBadge` |
| `PopularityChangeList` | What one show did to its promotion's popularity (`popularity.showChange`): regions gained, lost and about the same, the worldwide change, then every region under its country with how it saw the show, expected vs score, before → after and a DeltaChip with Why?. Phones get the five biggest changes and Show all                                                                                                                                                                                                                                                              |
| ---------------------  | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------                                                                                                                                                                                                                                                                                                                                       |
| `RecentForm`           | A worker's last matches: a strip of W / L / D / NC pills named in full, or a list with each match's popularity and momentum change and a Why? while kept; "No matches yet" when empty                                                                                                                                                                                                                                                                                                                                                                                              |
| `VenueFitBadge`        | How well a venue suits a show's expected crowd: "Likely sell-out" (positive), "Good fit" (data) or "Will look empty" (negative), each with its own icon                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `PromotionLink`        | A promotion's name as a link to its profile, the twin of `WorkerLink`. From the Promotions list it carries the list's sort for the profile's back link; `truncate` keeps a long name on one line                                                                                                                                                                                                                                                                                                                                                                                   |
| `NeedsList`            | What a rival desk says a roster is short of (`aip.needs`): the wrestlers its largest show calls for with its Why?, then each need in words with a severity `StatBar` (0–100) and the severity's Why?. "No pressing needs" when empty; rows stack on a phone                                                                                                                                                                                                                                                                                                                        |
| `DecisionLogList`      | A rival desk's decisions (`aip.decisionLog`), newest first: filter chips built from the log's kinds (labels from the engine, so new kinds need nothing here; the row scrolls inside itself on a phone), date, kind `Badge`, the decision in words and its Why? while kept, "N plans hidden until they air", Load older                                                                                                                                                                                                                                                             |
| `InjuryCard`           | An injury (WRK6-05): name, body part, a severity badge that always has its word and "New" while unseen; Since, Back on, Time out and Days left, Condition lost, Can work angles and How it happened, each number with a Why? while its breakdown is kept. A healed one reads as history                                                                                                                                                                                                                                                                                            |

Money is integer `Cents` and dates are `GameDate` strings from `@ringside/engine`; the formatters
turn them into text at the edge and nowhere else.

Some screens keep components of their own that still get gallery entries: the Match lab's
`MatchResultBlock` (a simulated match: headline with a Why? on the winner, method and finish, then
the lab's score bug), `FinishSelect` (Auto or a finish, with the reset message in a live region)
and `WinnerSelect` live in `screens/match-lab/result/`, not here.

## Why? panel

Every derived number can explain itself (see `docs/design/calculation-traces.md`). A screen shows
one with `<Explained value={...} label="Attendance" unit="people" trace={...} />`, or with
`traceRef={...}` when its query hands back a reference; with neither it shows just the number.

- **Words, not formulas.** `Trace/wording.ts` turns each node into a sentence ("Capped 112 → 100
  (maximum)", "+6 Main event bonus"). The rows and the copy-as-text export both read it, so a bug
  report says what the player saw.
- **Settings are named.** A tunable's row ends with its key ("Ring work weight: 3 · Game setting ·
  `workers.rating.wrestler.ringwork`"), the name the tunables list and a balance profile know it
  by. An overridden one says "Custom setting" and its default before the key.
- **Choices read as words.** The engine names a decision's options with the codes the data uses
  (`mainEvent`, `lightHeavyweight`). `choiceText` in `Trace/wording.ts` turns a code into words
  ("Main event", "Light heavyweight") in the headline, the row and the options under it; text that
  is not a code is left alone. A choice setting's value reads the same way ("Midcard's duration
  class: Standard", not `standard`).
- **Every kind has a row.** `Trace/kinds.ts` picks the row for each node kind with an exhaustive
  switch, so a kind added in the engine fails the typecheck until it has a renderer.
- **Quiet checks are hidden.** Limits that changed nothing and branches not taken sit behind
  "Show checks that didn't apply". Groups start open down to depth 2, with Expand all and
  Collapse all, and the arrow keys move through the tree.
- **Names link in the game.** An input that points at an entity draws its name through the
  nearest `EntityLinkContext` (`app/entityLinks.tsx`). `AppShell` provides one that links people to
  their profiles; with no provider (the gallery, screens outside a game) names are plain text. A
  `renderEntityLink` prop still wins where a screen passes one.
- **One panel at a time.** `tracePanelStore` holds the open panel's id; opening another replaces
  it, and closing returns focus to the button that opened it.
- **Older results.** A `traceRef` whose trace has been summarised shows the summary with "Full
  breakdown is only kept for recent results".
- **Lists explain on demand.** A list query returns numbers only, so a few hundred rows stay
  small. A cell that shows a derived number puts a
  `<LazyWhyButton label="Overall" value={72} queryName="workers.explain" args={{ personId, metric: 'overall' }} />`
  beside it. It looks like `WhyButton` and shares the one open panel, but it asks the engine only
  when it is opened, shows the loading state meanwhile, and reuses the cached answer after that.
  `queryName` takes any query whose answer is `{ value, trace }` (`TraceQueryName`).
  A query may also answer null (`roster.explain` for a contract that has just ended); the panel
  then says "There is no breakdown for this number any more." instead of an error.

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
- **Stat-table look.** Headers are Barlow Condensed capitals with a little tracking over a strong
  hairline, as are the card stat labels. `numeric` columns sit on the right with the global
  `.tabular` class. A hovered, selected or checked row lifts to `--color-surface-hover`, and
  `striped` adds zebra rows on the desktop table.
- **Sorting** (`sortable`, on by default; start with `initialSort`): numbers numerically, text
  naturally ("Worker 2" before "Worker 10"), empty values last in both directions, ties by row id
  (or by `compareTies` first, when a screen has its own order for equal rows).
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
  A screen with a bulk-action bar of its own (the roster's) passes `checkedSummary={false}` so the
  count and "Clear selection" are not shown twice.
- **Hidden header** (`headerHidden` on a column): the header is read by screen readers but not
  shown, for a column whose cells say what they are, such as a row's actions menu.
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
`SegmentedMeter`, `CardSlot`, `ChamferPanel`, `SlashDivider` and `StarRating`. They sit in the
gallery's **Broadcast** group.

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

## Office kit

The components for the management screens (see the office register in
`docs/design/visual-identity.md`): `KpiCard` (with `KpiCardGrid`), `DeltaChip`, `Sparkline`,
`AlignmentChip`, `AvailabilityChip`, `ChampionCard` (with `ChampionCardList`) and the stat-table
look of `DataTable`.
They sit in the gallery's **Office** group.

- **Calm.** Rounded cards (`--radius-card`), hairlines and surface steps; no skew, no glow, and
  nothing loops. Labels are Barlow Condensed capitals, body text is Inter, and every number is
  Barlow Condensed with tabular figures. `officeKit.test.ts` checks these rules for every
  stylesheet.
- **Never colour alone.** A delta has an arrow and a sign (rose, not the action red, for bad
  news; `goodWhen="down"` for numbers that are better lower, such as payroll). A sparkline's
  accessible name gives its first and last values and the trend. An alignment chip always says
  FACE, HEEL or TWEENER. Prestige is a number as well as stars.
- **Data in, no game types.** Screens pass formatted values, `ImageSubject`s and slots (`why`,
  `footer`), so a finance or titles query can feed the kit directly. `AlignmentChip` takes the
  engine's `Alignment`, and `AvailabilityChip` the engine's `Availability` (what `availabilityOf`
  or `workers.profile` returns). Its tooltip is never the only copy of the reason: a screen that
  must show it on a phone prints it too, as the profile's Overview tab does.
- **Sparklines draw with SVG attributes**, like `StatBar`, so there are no inline styles and no
  chart library. Fewer than two points draw nothing.
- **People placeholders are ringed initials**: a ring and initials in a category colour from the
  id, on the raised surface. `personStyle="silhouette"` still draws a silhouette.
- **Stat tables.** `DataTable` headers are condensed capitals over a strong hairline, a hovered
  row lifts to `--color-surface-hover`, and `striped` adds zebra rows, worked out from each row's
  place so sorting never moves a stripe. Use `DeltaChip variant="plain"` in signed columns.
- **Phones.** `KpiCardGrid` goes 2-up below `--bp-mobile`, and `ChampionCardList` becomes a
  horizontal swipe row that scrolls inside itself and snaps each card. On a phone the row is a
  focusable region, so the arrow keys scroll it too. `apps/web/e2e/office.spec.ts` checks both
  layouts in a real browser.
