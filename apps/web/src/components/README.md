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
| `Tabs`           | `Tabs`, `TabList`, `Tab`, `TabPanel`: switch between views in one area     |
| `Sheet`          | A side panel over the page; a bottom sheet on phones                       |
| `ConfirmDialog`  | Ask before a destructive or irreversible action, with async `onConfirm`    |
| `Stack`          | Children in a column (or row) with a token gap                             |
| `Cluster`        | A wrapping row with a token gap                                            |
| `VisuallyHidden` | Text for screen readers only                                               |
| `format/`        | `formatMoney`, `formatNumber`, `formatPercent`, `formatSigned`, dates      |

Money is integer `Cents` and dates are `GameDate` strings from `@ringside/engine`; the formatters
turn them into text at the edge and nowhere else.

## Overlays

`Sheet` and `ConfirmDialog` are built on the native `<dialog>` element opened with `showModal()`,
which gives the focus trap, Escape and the top layer without a library. Both are controlled: the
parent owns `open` and clears it in `onClose`. Nothing renders while they are closed, and on close
focus goes back to the control that opened them.

- A screen that wants "a side panel" uses `Sheet` with a `side`. On phones the sheet decides to
  open from the bottom instead (turn that off with `responsiveSide={false}`).
- While any overlay is open, `useBodyScrollLock` puts the `scroll-locked` class on `<html>`. Holds
  are counted, so a `ConfirmDialog` opened from inside a `Sheet` keeps the page locked when it
  closes.
- A new overlay reuses `useModalDialog` from `Sheet/` rather than wiring `<dialog>` again.
- jsdom has no `showModal()`; `src/test/dialog.ts` stubs it (and Escape) for unit tests. Focus
  trapping and layout are checked by the gallery e2e spec in a real browser.
