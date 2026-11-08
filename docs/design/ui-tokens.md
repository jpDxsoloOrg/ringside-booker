# UI tokens

The visual language every screen builds on. Tokens are CSS custom properties defined in
`apps/web/src/styles/tokens.css`; the reset and base styles are in `global.css`, and the layout
breakpoints in `breakpoints.css`. `main.tsx` imports those three files once, in that order.

**[`visual-identity.md`](visual-identity.md) is the source of truth** for the look: the colour
roles and their hex values, the two type families, the shapes and the signature components (design
decision D-11). This doc covers how those decisions are turned into tokens and how components use
them. If the two disagree, visual-identity.md wins and this doc and `tokens.css` get fixed.

## Rules

- **Components use semantic tokens only, never palette tokens.** `--palette-*` values exist so the
  theme blocks have something to point at. A component that reads `--palette-navy-100` breaks
  the moment a theme remaps it. Use `--color-text`.
- **Sizes in rem so UI scale works.** The UI scale setting multiplies the root font size, so
  anything in `rem` grows with it. Hairlines (1px borders, the 2px focus ring) and corner shapes
  (radii, the chamfer) are the exception: they are in px because a corner reads the same at any
  scale.
- **One breakpoint, `--bp-mobile`.** Below it a screen switches to its phone layout. `--bp-wide`
  only caps widths on very large screens and never introduces a third layout.
- **Semantic colours are hex, not colour maths.** Theme blocks point at palette hex values (or a
  hex literal, as the overlay does). No `color-mix()` or HSL arithmetic, so the contrast test stays
  a small parser.
- **No inline styles.** Styling is CSS Modules plus tokens. The only place script writes a CSS
  variable is `applyUiScale` in `styles/theme.ts`.
- **Global CSS is imported once,** from `main.tsx`. Components never import `tokens.css`,
  `breakpoints.css` or `global.css`.

## Theme

The game is **dark only** for now (D-11). `tokens.css` has one theme block,
`:root, [data-theme='dark']`, so the dark values apply with or without the attribute, and it sets
`color-scheme: dark` so scrollbars and native form controls match.

The theme layer stays so a light theme can come back without touching components:

- `styles/theme.ts` keeps `ThemePreference` (`system`, `light`, `dark`) and `applyTheme`, which sets
  or removes `data-theme` on `<html>` and copies the resolved `--color-bg` into
  `<meta name="theme-color">`.
- `SHIPPED_THEMES` lists the themes `tokens.css` defines (`['dark']`), and `resolveTheme` turns a
  preference into one of them; anything that does not ship falls back to `DEFAULT_THEME` (dark),
  which is also what the CSS shows, since no block matches it.
- `SELECTABLE_THEME_PREFERENCES` is what a player may choose (`['dark']`). Settings and the
  gallery hide the theme choice while it has fewer than two entries.
- `main.tsx` applies `DEFAULT_THEME` at start-up.

To add a light theme: a `[data-theme='light']` block (and, to follow the OS, a
`@media (prefers-color-scheme: light)` copy for `:root:not([data-theme='dark'])`), `'light'` in
`ThemeName` and `SHIPPED_THEMES`, the choices in `SELECTABLE_THEME_PREFERENCES`, and the light
theme's entries in `tokens.test.ts` and the gallery's token catalog.

## Colour tokens

### Roles

These match the roles table in visual-identity.md exactly; `tokens.test.ts` fails if a hex drifts.

| Token                     | Purpose                                     | Value     |
| ------------------------- | ------------------------------------------- | --------- |
| `--color-bg`              | Page background                             | `#090d16` |
| `--color-surface`         | Cards, panels                               | `#0f172a` |
| `--color-surface-raised`  | Popovers, active panels, score bugs         | `#131d31` |
| `--color-surface-hover`   | Row and card hover                          | `#1a2740` |
| `--color-border`          | Hairlines between and around things         | `#24334d` |
| `--color-border-strong`   | Inputs, focusable outlines                  | `#3b4d6b` |
| `--color-text`            | Body and headings                           | `#f1f5f9` |
| `--color-text-muted`      | Secondary text, labels                      | `#94a3b8` |
| `--color-text-subtle`     | Large or decorative text only               | `#64748b` |
| `--color-action`          | Primary button fills                        | `#d7301a` |
| `--color-action-contrast` | Text and icons on `--color-action` (white)  | `#ffffff` |
| `--color-action-bright`   | Live states, glows, large display text      | `#ff3b1d` |
| `--color-data`            | Numbers, meters, charts, links, info        | `#00e5ff` |
| `--color-prestige`        | Titles, champions, awards, top picks        | `#facc15` |
| `--color-positive`        | Rising deltas, good outcomes                | `#34d399` |
| `--color-negative`        | Falling deltas, injuries, losses            | `#fb7185` |
| `--color-face`            | Face alignment chip (the data hue)          | `#00e5ff` |
| `--color-heel`            | Heel alignment chip (the action-bright hue) | `#ff3b1d` |
| `--color-tweener`         | Tweener alignment chip                      | `#a78bfa` |

### Older names

These came before D-11. They are mapped onto the roles so existing components keep working until
they are restyled; new code uses the roles.

| Token                     | Now follows                                 | Value       |
| ------------------------- | ------------------------------------------- | ----------- |
| `--color-accent`          | `--color-action-bright`                     | `#ff3b1d`   |
| `--color-accent-contrast` | Dark ink on the bright accent               | `#090d16`   |
| `--color-surface-sunken`  | `--color-bg` (wells, input backgrounds)     | `#090d16`   |
| `--color-text-inverse`    | Dark ink on light fills (tooltips, avatars) | `#090d16`   |
| `--color-warning`         | `--color-prestige`                          | `#facc15`   |
| `--color-info`            | `--color-data`                              | `#00e5ff`   |
| `--color-focus`           | `--color-data` (keyboard focus ring)        | `#00e5ff`   |
| `--color-overlay`         | Scrim behind sheets and dialogs             | `#05080fb3` |

The focus ring is cyan rather than red-orange so it never reads as "live" and stays visible around
a red-orange primary button.

### Categorical, metal and glow tokens

| Token                                                | Purpose                                 | Value                                             |
| ---------------------------------------------------- | --------------------------------------- | ------------------------------------------------- |
| `--color-cat-1` … `--color-cat-8`                    | Placeholder avatars, chart series, tags | sky, orange, teal, violet, pink, lime, gold, navy |
| `--color-metal-gold` / `silver` / `bronze` / `plain` | Belt plates by tier                     | `#d9b54a` / `#c4c8cd` / `#c99062` / `#cbd5e1`     |
| `--color-metal-ink`                                  | Engraving and outlines on metal         | `#090d16`                                         |
| `--color-belt-strap`                                 | Belt strap                              | `#3b4d6b`                                         |
| `--glow-action`                                      | Live-state glow (box-shadow)            | ring + halo in `#ff3b1d`                          |
| `--glow-data`                                        | Highlighted-data glow (box-shadow)      | ring + halo in `#00e5ff`                          |

The metal colours are a deliberate exception to "category palette only": a belt's tier is
information, not decoration, so gold, silver and bronze have their own tokens. Glows are static
shadows; anything that pulses one animates over `--motion-pulse`, which reduced motion sets to 0.

### Contrast

`tokens.test.ts` resolves every semantic colour to its hex value and checks WCAG 2 contrast ratios:

| Pair                                                                                                                                                                                             | Minimum |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Every text role (`text`, `text-muted`, `action-bright`, `data`, `prestige`, `positive`, `negative`, `face`, `heel`, `tweener`, `accent`, `warning`, `info`) on `bg`, `surface`, `surface-raised` | 4.5     |
| `text-subtle` on `bg`, `surface`, `surface-raised` (large text only)                                                                                                                             | 3.0     |
| `action-contrast` (white) on `action`                                                                                                                                                            | 4.5     |
| `accent-contrast` on `accent`                                                                                                                                                                    | 4.5     |
| `text-inverse` on `text`                                                                                                                                                                         | 4.5     |
| `text-inverse` on `data`, `prestige`, `positive`, `negative` (prestige and danger buttons, solid badges)                                                                                         | 4.5     |
| `focus` on `bg`, `surface` and `surface-raised`                                                                                                                                                  | 3.0     |
| `text-inverse` on each of `cat-1` … `cat-8`                                                                                                                                                      | 4.5     |
| `metal-ink` on each `metal-*` tier                                                                                                                                                               | 4.5     |

`--color-border-strong` (`#3b4d6b`) is a hairline at about 2.1:1 on `--color-surface`, below the
3:1 that WCAG asks of a control's only visible boundary. A control that relies on its outline
alone needs a second cue (a fill, a label, or a stronger outline); the component restyles handle
that per component.

## Other tokens

These do not change with the theme.

| Token                                      | Purpose                                   | Value                                  |
| ------------------------------------------ | ----------------------------------------- | -------------------------------------- |
| `--space-0` … `--space-10`                 | Spacing scale, 0.25rem per step           | `0` … `2.5rem`                         |
| `--radius-card` / `control` / `pill`       | Office corners: cards, controls, chips    | `10px` / `8px` / `999px`               |
| `--radius-sm` / `md` / `lg`                | Older names (`md` = control, `lg` = card) | `4px` / `8px` / `10px`                 |
| `--chamfer`                                | Broadcast panel corner cut                | `8px`                                  |
| `--skew-broadcast`                         | Skew on bugs, tabs, show actions          | `-12deg` (text inside un-skews)        |
| `--font-family-display`                    | Headings, labels, chips, stat numbers     | Barlow Condensed, then system stacks   |
| `--font-family-ui`                         | Body, tables, forms                       | Inter, then the system UI stack        |
| `--font-family-mono`                       | Code, IDs, seeds                          | `ui-monospace, …`                      |
| `--font-feature-tabular`                   | Tabular figures (`.tabular`, `td`)        | `tabular-nums`                         |
| `--font-size-xs` … `--font-size-3xl`       | Type scale                                | `0.75rem` … `2.25rem` (`md` is `1rem`) |
| `--line-height-tight` / `snug` / `normal`  | Headings / dense rows / body text         | `1.2` / `1.35` / `1.5`                 |
| `--font-weight-regular` … `extrabold`      | Weights                                   | `400` / `500` / `600` / `700` / `800`  |
| `--shadow-1` … `--shadow-3`                | Elevation, low to high                    | Layered shadows                        |
| `--z-nav`                                  | Navigation bars                           | `100`                                  |
| `--z-sheet`                                | Sheets and side panels                    | `400`                                  |
| `--z-toast`                                | Toasts                                    | `500`                                  |
| `--z-overlay`                              | Dialogs and their scrim                   | `600`                                  |
| `--z-popover`                              | Popovers, menus, selects, tooltips        | `700`                                  |
| `--motion-fast` / `--motion-base`          | Transition durations                      | `120ms` / `200ms` (`0ms` reduced)      |
| `--motion-pulse`                           | One cycle of a live pulse                 | `1600ms` (`0ms` reduced)               |
| `--easing-standard`                        | Default easing curve                      | `cubic-bezier(0.2, 0, 0, 1)`           |
| `--sidebar-width`                          | Desktop sidebar                           | `15rem`                                |
| `--topbar-height`                          | Top bar                                   | `3.5rem`                               |
| `--bottom-nav-height`                      | Phone bottom navigation                   | `3.75rem`                              |
| `--content-max-width`                      | Cap on content width                      | `90rem`                                |
| `--tap-target-min`                         | Smallest touch target                     | `2.75rem`                              |
| `--image-size-xs` … `--image-size-xl`      | ImageSlot sizes                           | `1.5` / `2` / `3` / `5` / `8rem`       |
| `--safe-top` / `right` / `bottom` / `left` | Notch and home-indicator insets           | `env(safe-area-inset-*, 0px)`          |
| `--ui-scale`                               | UI scale, set by `applyUiScale`           | `0.8` to `1.5`, default `1`            |

Body text is `--font-size-md` (1rem, so 16px at scale 1) in Inter; headings (`h1`–`h6`) use the
display family. Both fonts are self-hosted: `main.tsx` imports the `@fontsource/barlow-condensed`
(600, 700, 800) and `@fontsource/inter` (400, 500, 600) weight files, Vite bundles them, and the
game never contacts a font CDN. Table cells, anything marked `data-numeric` and anything with the
global `.tabular` class use tabular numbers so columns of figures line up.

Reduced motion sets all three durations to `0ms`, either from the OS (`prefers-reduced-motion: reduce`,
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

## Viewer settings

The Settings screen (`/settings`, `apps/web/src/screens/settings`) is where the player picks the
UI scale (80% to 150% in 5% steps), reduced motion (match device, on, off) and how money is
written (compact `$1.2M` or full `$1,234,567`). The theme choice stays hidden while dark is the
only theme (D-11); the preference and `applyTheme` are still there for when a light theme ships.

- **Per browser, never in a save.** Settings describe the device, not the world, so they live in
  `localStorage['rb.settings']` as a versioned object. A save moved to a phone keeps the phone's
  own settings.
- **Validated field by field.** `parseSettings` keeps each valid field and defaults the rest, so a
  hand-edited or corrupt entry never breaks the app or resets the other settings.
- **Applied before the first paint.** `main.tsx` reads and applies them synchronously before
  React renders; `SettingsEffects` keeps `<html>` in step after that.
- **Storage can fail.** In a private window or with site data blocked the store keeps working in
  memory and the screen says the settings won't be remembered.
- **Motion.** `on` sets `data-reduced-motion="on"`; `off` sets `data-reduced-motion="off"`, which
  keeps full motion even when the OS asks for less; `match device` removes the attribute and
  leaves it to the media query.
- **Money.** Screens format money with `useMoneyFormatter()`, which fills in the chosen style.

## Placeholder art

Until real images exist, every entity picture is drawn by `ImageSlot`
(`apps/web/src/components/ImageSlot`). Screens always render `<ImageSlot subject={...} size="sm" />`
and never draw entity art themselves, so swapping in real images later changes no screen.

| Kind                                         | Generator          | What it draws                                                                                                                                        |
| -------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `person`                                     | `PersonInitials`   | Initials on a category colour (the default)                                                                                                          |
| `person` with `personStyle="silhouette"`     | `PersonSilhouette` | One of three head-and-shoulders outlines: short hair, long hair, hooded and masked                                                                   |
| `title`                                      | `Belt`             | Strap, two side plates, a centre plate (oval, shield, hexagon or circle) engraved with initials, in the `tier` metal                                 |
| `promotion`, `brand`, `event`, `network`     | `LogoMark`         | An outer shape (circle, shield, star-burst, diamond or hexagon) with a smaller copy inside in a second colour, and a monogram of up to three letters |
| `venue`, and any kind the build doesn't know | `GenericPlace`     | A simple arena outline                                                                                                                               |

**Seeded by id, not name.** Every choice (background colour, silhouette variant, plate shape, logo
shape, inner colour) comes from a 32-bit FNV-1a hash of the entity id, re-hashed with a different
salt per choice so they vary independently. Renaming a worker or a promotion keeps its colour and
shape, which players use as a visual anchor; only the initials follow the new name. The hash lives
in the UI and never touches the engine's random streams, so changing the art can't change game
results.

**Theme-aware.** The art is inline SVG, not image files or data URLs, and every fill is a CSS
Module class that reads a semantic token (`--color-cat-*`, `--color-text-inverse`, the metal and
strap tokens). Shapes stay the same across themes; colours follow the theme. SVG stays sharp at
any size and on high-density screens, and slot sizes are in rem, so they grow with the UI scale.

**Accessibility.** The SVG or `<img>` is named after the entity (`role="img"` and `aria-label`, or
`alt`). Pass `decorative` when the name is already printed next to the slot; the art is then
hidden from assistive tech.

### Real images: registering a resolver

`resolver.ts` holds a small registry of resolvers. A resolver is a synchronous function from the
subject to a URL, or `null` to pass:

```ts
import { registerImageResolver } from '@/components/ImageSlot';

const unregister = registerImageResolver((subject) => {
  const path = packManifest.get(`${subject.kind}:${subject.id}`); // indexed when the pack loads
  return path === undefined ? null : `/packs/my-pack/${path}`;
});
```

- Resolvers are asked in registration order and the first URL wins. With none registered (the
  default) every slot draws its placeholder.
- The engine's `imageRef` is passed through as an opaque string; `placeholder:<kind>` references
  reach resolvers as no reference at all.
- Registering or removing a resolver re-renders every mounted slot, so a pack loaded mid-game
  swaps images in place.
- A resolver that throws is skipped and logged once.
- An image that fails to load falls back to the placeholder, and the URL is remembered for the
  session so long lists don't flicker between the two.

Packs keep the resolver cheap: index the manifest once when the pack loads, then look up by kind
and id.
