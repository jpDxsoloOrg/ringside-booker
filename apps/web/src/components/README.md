# Shared UI components

The building blocks every screen composes: buttons, icons, panels, badges, stat bars, empty
states, layout helpers and formatters. Screens use these instead of inventing their own controls,
so the whole game looks and behaves the same, on desktop and on a phone.

Every component is in the dev gallery at `/dev/gallery` (dev and e2e builds only). Add a section
there when you add a component.

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
- **Phone-ready.** Below `--bp-mobile` the component still fits a 390px screen, and on touch
  screens (`@media (pointer: coarse)`) every control is at least `--tap-target-min` tall.
- **Tested.** Unit tests sit next to the component; the gallery e2e spec
  (`apps/web/e2e/gallery.spec.ts`) checks layout, keyboard reach and accessibility at desktop and
  phone sizes.

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
