# UI tokens

The visual language every screen builds on. Tokens are CSS custom properties defined in
`apps/web/src/styles/tokens.css`; the reset and base styles are in `global.css`, and the layout
breakpoints in `breakpoints.css`. `main.tsx` imports those three files once, in that order.

The look is calm and original: warm neutral greys with one burnt-orange accent, dark surfaces in
the dark theme, and enough contrast that dense tables stay readable.

## Rules

- **Components use semantic tokens only, never palette tokens.** `--palette-*` values exist so the
  theme blocks have something to point at. A component that reads `--palette-neutral-900` breaks
  the moment a theme remaps it. Use `--color-text`.
- **Sizes in rem so UI scale works.** The UI scale setting multiplies the root font size, so
  anything in `rem` grows with it. Hairlines (1px borders, the 2px focus ring) are the exception.
- **One breakpoint, `--bp-mobile`.** Below it a screen switches to its phone layout. `--bp-wide`
  only caps widths on very large screens and never introduces a third layout.
- **Semantic colours are hex, not colour maths.** Theme blocks point at palette hex values (or a
  hex literal, as the overlay does). No `color-mix()` or HSL arithmetic, so the contrast test stays
  a small parser.
- **No inline styles.** Styling is CSS Modules plus tokens. The only place script writes a CSS
  variable is `applyUiScale` in `styles/theme.ts`.
- **Global CSS is imported once,** from `main.tsx`. Components never import `tokens.css`,
  `breakpoints.css` or `global.css`.

## Themes

| Theme  | How it is chosen                                                      |
| ------ | --------------------------------------------------------------------- |
| Light  | The default, and `data-theme="light"` on `<html>`                     |
| Dark   | `data-theme="dark"` on `<html>`                                       |
| System | No `data-theme` attribute: follows `prefers-color-scheme`, with no JS |

The dark declarations appear twice in `tokens.css`, once for `[data-theme='dark']` and once inside
`@media (prefers-color-scheme: dark)` for `:root:not([data-theme='light'])`. `tokens.test.ts` fails
if the two copies differ. Each theme sets `color-scheme`, so scrollbars and native form controls
match.

`applyTheme(preference)` in `styles/theme.ts` sets or removes the attribute and copies the
resolved `--color-bg` into `<meta name="theme-color">`. While the preference is `system` it also
refreshes that meta when the OS setting changes. `main.tsx` applies `system` at start-up until the
settings screen restores a saved choice.

## Colour tokens

| Token                     | Purpose                                        | Light value | Dark value  |
| ------------------------- | ---------------------------------------------- | ----------- | ----------- |
| `--color-bg`              | Page background                                | `#f6f5f3`   | `#131312`   |
| `--color-surface`         | Panels, cards, table bodies                    | `#ffffff`   | `#1d1c1a`   |
| `--color-surface-raised`  | Menus, popovers, sheets (above a surface)      | `#ffffff`   | `#262523`   |
| `--color-surface-sunken`  | Wells, input backgrounds, table headers        | `#ecebe7`   | `#131312`   |
| `--color-border`          | Dividers and quiet outlines                    | `#dcdad5`   | `#302e2b`   |
| `--color-border-strong`   | Input outlines and borders that must be seen   | `#7d7970`   | `#7d7970`   |
| `--color-text`            | Body text                                      | `#1d1c1a`   | `#ecebe7`   |
| `--color-text-muted`      | Secondary text, captions, column headers       | `#5f5b54`   | `#a19d95`   |
| `--color-text-inverse`    | Text on a `--color-text` background (tooltips) | `#ffffff`   | `#131312`   |
| `--color-accent`          | Primary actions, links, the selected item      | `#964512`   | `#f29652`   |
| `--color-accent-contrast` | Text and icons on `--color-accent`             | `#ffffff`   | `#131312`   |
| `--color-positive`        | Gains, wins, healthy                           | `#1f6639`   | `#5fbf7f`   |
| `--color-negative`        | Losses, errors, injuries                       | `#962d29`   | `#eb7772`   |
| `--color-warning`         | Needs attention soon                           | `#7a5b0e`   | `#e8bb45`   |
| `--color-info`            | Neutral notices                                | `#245594`   | `#6ea6ea`   |
| `--color-focus`           | Keyboard focus ring                            | `#2f6bb8`   | `#f8b682`   |
| `--color-overlay`         | Scrim behind sheets and dialogs                | `#1d1c1a99` | `#000000a6` |
| `--color-cat-1`           | Categorical series 1 (charts, tags)            | `#2f6bb8`   | `#6ea6ea`   |
| `--color-cat-2`           | Categorical series 2                           | `#b95a17`   | `#f29652`   |
| `--color-cat-3`           | Categorical series 3                           | `#217d75`   | `#4fbdb3`   |
| `--color-cat-4`           | Categorical series 4                           | `#6b4fbf`   | `#a68ce8`   |
| `--color-cat-5`           | Categorical series 5                           | `#b04683`   | `#e584b6`   |
| `--color-cat-6`           | Categorical series 6                           | `#6a7526`   | `#a9b85a`   |
| `--color-cat-7`           | Categorical series 7                           | `#9a7413`   | `#e8bb45`   |
| `--color-cat-8`           | Categorical series 8                           | `#5f5b54`   | `#a19d95`   |

The categorical hues are placeholders until the chart components settle on a final set.

### Contrast

`tokens.test.ts` resolves every semantic colour to its hex value per theme and checks WCAG 2
contrast ratios:

| Pair                                                   | Minimum |
| ------------------------------------------------------ | ------- |
| `text` on `bg`, `surface`, `surface-raised`            | 4.5     |
| `accent-contrast` on `accent`                          | 4.5     |
| `positive`, `negative`, `warning`, `info` on `surface` | 4.5     |
| `text-muted` on `surface`                              | 3.0     |
| `focus` on `bg`                                        | 3.0     |
| `border-strong` on `surface`                           | 3.0     |

## Other tokens

These are the same in both themes.

| Token                                      | Purpose                            | Value                                   |
| ------------------------------------------ | ---------------------------------- | --------------------------------------- |
| `--space-0` … `--space-10`                 | Spacing scale, 0.25rem per step    | `0` … `2.5rem`                          |
| `--radius-sm` / `md` / `lg` / `pill`       | Corner radius                      | `0.25rem` / `0.5rem` / `0.75rem` / pill |
| `--font-family-ui`                         | Interface text (system font stack) | `system-ui, …`                          |
| `--font-family-mono`                       | Code, IDs, seeds                   | `ui-monospace, …`                       |
| `--font-size-xs` … `--font-size-3xl`       | Type scale                         | `0.75rem` … `2.25rem` (`md` is `1rem`)  |
| `--line-height-tight` / `snug` / `normal`  | Headings / dense rows / body text  | `1.2` / `1.35` / `1.5`                  |
| `--font-weight-regular` … `bold`           | Weights                            | `400` / `500` / `600` / `700`           |
| `--shadow-1` … `--shadow-3`                | Elevation, low to high             | Layered shadows                         |
| `--z-nav`                                  | Navigation bars                    | `100`                                   |
| `--z-sheet`                                | Sheets and side panels             | `400`                                   |
| `--z-toast`                                | Toasts                             | `500`                                   |
| `--z-overlay`                              | Dialogs and their scrim            | `600`                                   |
| `--motion-fast` / `--motion-base`          | Transition durations               | `120ms` / `200ms` (`0ms` reduced)       |
| `--easing-standard`                        | Default easing curve               | `cubic-bezier(0.2, 0, 0, 1)`            |
| `--sidebar-width`                          | Desktop sidebar                    | `15rem`                                 |
| `--topbar-height`                          | Top bar                            | `3.5rem`                                |
| `--bottom-nav-height`                      | Phone bottom navigation            | `3.75rem`                               |
| `--content-max-width`                      | Cap on content width               | `90rem`                                 |
| `--tap-target-min`                         | Smallest touch target              | `2.75rem`                               |
| `--safe-top` / `right` / `bottom` / `left` | Notch and home-indicator insets    | `env(safe-area-inset-*, 0px)`           |
| `--ui-scale`                               | UI scale, set by `applyUiScale`    | `0.8` to `1.5`, default `1`             |

Body text is `--font-size-md` (1rem, so 16px at scale 1). Table cells and anything marked
`data-numeric` use tabular numbers so columns of figures line up.

Reduced motion sets both durations to `0ms`, either from the OS (`prefers-reduced-motion: reduce`,
unless `<html data-reduced-motion="off">`) or from the setting (`data-reduced-motion="on"`).
Components animate with the motion tokens so they inherit this for free.

## Breakpoints

```css
@custom-media --bp-mobile (width < 48rem);
@custom-media --bp-wide (width >= 90rem);
```

`postcss.config.js` makes these available in every CSS file, so a CSS Module writes
`@media (--bp-mobile) { ... }` without importing anything. For components whose DOM differs by
layout, `styles/breakpoints.ts` exports `BP_MOBILE_QUERY` and `BP_WIDE_QUERY`, and
`styles/useMediaQuery.ts` has `useMediaQuery(query)` and `useIsMobile()`. `breakpoints.test.ts`
fails if the CSS and the TypeScript disagree.

Media queries in rem resolve against the browser's default font size, not the scaled root, so a
desktop player at 150% UI scale keeps the desktop layout. That is on purpose.

## UI scale

`applyUiScale(scale)` clamps to 0.8–1.5 and sets `--ui-scale` on `<html>`. `global.css` sets the
root font size to `calc(var(--ui-scale, 1) * 100%)`, so at 1.25 every rem-based size (text,
spacing, layout sizes) is 25% larger. It also respects the browser's own font size setting,
because the base is `100%` rather than a fixed pixel size.
