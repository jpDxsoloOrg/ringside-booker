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
| `Stack`          | Children in a column (or row) with a token gap                             |
| `Cluster`        | A wrapping row with a token gap                                            |
| `VisuallyHidden` | Text for screen readers only                                               |
| `format/`        | `formatMoney`, `formatNumber`, `formatPercent`, `formatSigned`, dates      |

Money is integer `Cents` and dates are `GameDate` strings from `@ringside/engine`; the formatters
turn them into text at the edge and nowhere else.
