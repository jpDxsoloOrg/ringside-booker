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
- Shared types sit at the top level: `tone.ts` (the colour tones) and `classNames.ts`.

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
  screens (`@media (pointer: coarse)`) every control is at least `--tap-target-min` tall.
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
  group: 'Primitives', // 'Tokens' | 'Primitives' | 'Art' | 'Data' | 'Overlays' | 'Engine'
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

| Component        | Use it for                                                                 |
| ---------------- | -------------------------------------------------------------------------- |
| `Button`         | Every clickable action. Variants `primary`, `secondary`, `ghost`, `danger` |
| `IconButton`     | An action shown as an icon only. Its `label` is required                   |
| `Icon`           | One of the inline SVG icons in `Icon/icons.ts`                             |
| `Panel`          | A titled surface grouping related content, optionally collapsible          |
| `Badge`          | A short status label in one of the tones                                   |
| `CountBadge`     | A small count such as unread mail, capped at `99+`                         |
| `StatBar`        | A 0–100 value such as an attribute, popularity or condition                |
| `EmptyState`     | What to show when a list, table or screen has nothing in it                |
| `DataTable`      | Any dense list: a sortable table on desktop, stacked cards on phones       |
| `Tabs`           | `Tabs`, `TabList`, `Tab`, `TabPanel`: switch between views in one area     |
| `Sheet`          | A side panel over the page; a bottom sheet on phones                       |
| `ConfirmDialog`  | Ask before a destructive or irreversible action, with async `onConfirm`    |
| `Tooltip`        | A short hint on hover or focus. Never the only copy of anything            |
| `Popover`        | A small panel anchored to a button: detail, a filter, quick controls       |
| `DropdownMenu`   | A menu of actions behind a button, such as a row's "more" menu             |
| `Select`         | Pick one option from a short list                                          |
| `Switch`         | An on/off setting that applies straight away                               |
| `Stack`          | Children in a column (or row) with a token gap                             |
| `Cluster`        | A wrapping row with a token gap                                            |
| `VisuallyHidden` | Text for screen readers only                                               |
| `format/`        | `formatMoney`, `formatNumber`, `formatPercent`, `formatSigned`, dates      |

Money is integer `Cents` and dates are `GameDate` strings from `@ringside/engine`; the formatters
turn them into text at the edge and nowhere else.

## DataTable

`DataTable<Row>` takes rows, column definitions, `getRowId` and a `caption`, and gives both
layouts: a captioned, sortable table with sticky headers on desktop, and a labelled list of
stacked cards with a "Sort by" select below `--bp-mobile`. The cards are their own DOM, not
restyled table cells, so each layout keeps its screen reader semantics.

- **Card roles are chosen by the screen.** Each column says where it goes on a phone card:
  `media`, `title`, `subtitle`, `stat` (the first six are shown, labelled with `cardLabel` or the
  header), `meta` or `hidden`. Only the screen knows which few numbers matter most on a phone.
- **Sorting** happens on the rows the screen passes in: numbers numerically, text naturally
  ("Worker 2" before "Worker 10"), empty values last in both directions, ties by row id. A header
  click cycles through the column's first direction (high to low for `numeric` columns, A to Z
  otherwise), the other direction, then no sort. For big engine-side lists, control `sort` and
  pass it to the query through `onSortChange` instead.
- **Keyboard:** the table is one Tab stop. Up and Down move the selection, Home and End jump,
  Enter opens the selected row. A click on a link or button inside a cell does not open the row.
- **Keep `columns` and `getRowId` stable** (module level or `useMemo`) so rows only re-render
  when their own data or selection changes.
- **Size:** built and benchmarked for 500 rows by 10 columns (`DataTable.bench.ts`). There is no
  windowing yet; a screen that needs thousands of rows should page them, or windowing should be
  added behind the same props.

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
