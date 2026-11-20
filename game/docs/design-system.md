# Design system (UNITY-11)

The look and the shared components for the Windows game. Phase 1 (this) is the style guide, the
component set and mockups for the owner to review. Phase 2, after the owner signs off, moves the
real screens onto these components. Until then the existing screens keep the UNITY-07 styles
(`Assets/UI/Styles/*.uss`). The new classes all start with `ds-`, so the two sets don't clash.

## Principles

- **Keep the web identity.** Dark navy base, the red-orange accent for "act now / live", cyan for
  data, gold for prestige, Barlow Condensed capitals for headings and numbers, Inter for body text,
  the skewed call to action, and a Why? on every number.
- **A broadcast and sports-site feel, all original.** Scoreboard strips, a ticker, matchup cards with
  both sides facing off, a LIVE bar, reveal cards for results. This is inspiration only: never copy
  another game's screens, art, logos or branding.
- **Don't overwhelm the player.** Each screen leads with the decision at hand. Detail is one step
  away (an expanding row, a details panel, a side sheet, a tooltip). The Why? is quiet: a small "?"
  that appears on hover or focus. Tables show a short set of columns, with more in a column picker.
  Filters sit behind one button. Words come before numbers ("Huge star 73"). Colour and an icon show
  state (good, warning, problem), so the player can scan instead of read. Colour is never used on
  its own.
- **PC density.** Designed at 1920×1080 logical pixels. 1080p draws 1:1, 1440p at 1.33× and 720p at
  0.67×, and the UI scale setting applies on top. Table rows are 30 px, controls are 30 px (36 px for
  large ones) and the top bar is 48 px.

## Files

| What                                           | Where                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| Tokens (colours, type, spacing, radii, layout) | `Assets/UI/Design/DsTokens.uss`                                      |
| Component styles                               | `Assets/UI/Design/DsComponents.uss`                                  |
| App shell styles                               | `Assets/UI/Design/DsShell.uss`                                       |
| Mockup page layout (`mk-` classes)             | `Assets/UI/Design/DsMockups.uss`                                     |
| App shell UXML                                 | `Assets/UI/Design/Resources/Design/AppShell.uxml`                    |
| Icons (path data)                              | `Assets/UI/Design/Resources/Design/Icons.txt`                        |
| Components (C#)                                | `Assets/Scripts/UI/Design/` (namespace `RingsideBooker.UI.Design`)   |
| Mockups (C#)                                   | `Assets/Scripts/UI/Mockups/` (namespace `RingsideBooker.UI.Mockups`) |

`RingsideTheme.tss` imports the four stylesheets, so every panel can use them.

## Tokens

Every token is prefixed `--ds-`. Components use tokens, never raw hex. Painted shapes (the skew,
gradients, portraits) take their colours from custom properties, so USS can restyle them.

### Colour

| Group                 | Tokens                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surfaces by elevation | `--ds-elev-0` `#080c15` (canvas), `-1` `#0e1628` (panels), `-2` `#131d33` (raised, hover, sheets), `-3` `#19253f` (controls, popovers), `-4` `#1f2d4b` (tooltips, hover on controls)          |
| Lines                 | `--ds-line` `#22314b`, `--ds-line-strong` `#34476a`, `--ds-line-subtle` `#172238`                                                                                                             |
| Text                  | `--ds-text` `#f1f5f9`, `--ds-text-2` `#b6c2d4` (secondary), `--ds-text-3` `#7d8ca3` (labels), `--ds-text-4` `#56657d` (quiet)                                                                 |
| Accents               | `--ds-action` `#d7301a` / `--ds-action-hover` `#ff3b1d` (act now, live, current page), `--ds-data` `#00e5ff` (data, focus, selected), `--ds-gold` `#facc15` (titles, champions, star ratings) |
| States                | `--ds-good` `#34d399`, `--ds-warn` `#fbbf24`, `--ds-bad` `#fb7185`, `--ds-info` `#38bdf8`, `--ds-neutral` `#94a3b8`, `--ds-live` `#ff3b1d`. Each has a `-soft` background.                    |
| Sides                 | `--ds-face` `#60a5fa` (blue), `--ds-heel` `#a78bfa` (violet). Heel is not red, so it can't be read as "problem".                                                                              |

The state classes `.ds-state--good|warn|bad|info|neutral|live|gold` set `--ds-state` and
`--ds-state-soft` on an element. Pills, dots, stat tiles, toasts, trends and meters read those two
properties, so one class colours the whole component.

### Type (px at 1080p)

| Role        | Size              | Face                                             | Class              |
| ----------- | ----------------- | ------------------------------------------------ | ------------------ |
| Display     | 44                | Barlow Condensed ExtraBold, capitals             | `ds-type-display`  |
| Headline    | 28                | Barlow Condensed ExtraBold, capitals             | `ds-type-headline` |
| Title       | 20                | Barlow Condensed Bold, capitals                  | `ds-type-title`    |
| Subtitle    | 16                | Inter SemiBold                                   | `ds-type-subtitle` |
| Body        | 14 (13 in tables) | Inter Regular                                    | `ds-type-body`     |
| Caption     | 12                | Inter Regular                                    | `ds-type-caption`  |
| Micro label | 11                | Barlow Condensed Bold, capitals, 1.4 px tracking | `ds-type-micro`    |
| Stat number | 30 / 20           | Barlow Condensed ExtraBold                       | `ds-stat__value`   |

USS has no text-transform, so code uppercases display text (`TextFormat.Upper`). Put the face class
on the label itself, because faces don't inherit. **Unity measures text without letter-spacing,** so
a label that can ellipsize must have `letter-spacing: 0`.

### Spacing, radii, elevation, motion

- Spacing is a 4 px grid: `--ds-space-0..12` = 2, 4, 8, 12, 16, 20, 24, 32, 48. Panels sit 16 px
  apart, a panel's padding is 14×16 and table cells have 10 px of padding.
- Radii: `--ds-radius-xs` 2 (tags), `sm` 4 (controls), `md` 6 (panels, tiles), `lg` 10 (cards) and
  `pill` 999.
- Elevation: USS has no shadows, so elevation is a lighter surface plus a stronger line (levels
  0–4 above). Sheets and modals add the scrim (`rgba(4,7,13,0.72)`).
- Motion: 120 ms for hover and press, 180 ms for expand, tabs and the sidebar, and 300 ms for sheets
  and reveals, all with an ease-out curve. Only the ticker and the loading spinner loop.
- Layout: top bar 48 px, sidebar 216 px (a 60 px rail when collapsed), rows 30 px, controls 30 px,
  large controls 36 px.

## Components (`RingsideBooker.UI.Design`)

| Component                        | API                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buttons                          | `Ds.Button(text, onClick, DsButtonKind.Primary/Secondary/Ghost/Danger, icon)`. `Ds.IconButton(icon, tooltip, onClick, quiet)`. Use `Ds.Cta(text, onClick, icon)` (a `SkewButton`) for the one skewed call to action per screen, and add `ds-cta--lg` for a big one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Chips, badges, pills, tags, dots | `Ds.Chip(text, selected, onClick, count, icon)`, `Ds.Badge(text, state)`, `Ds.Pill(state, word, icon, solid)`, `Ds.Tag(text, "face"/"heel"/"gold"/"live")`, `Ds.Dot(state, word)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Headings, panels                 | `Ds.SectionHeader(title, linkText, onLink)` (a red tick, capitals and a rule), `Ds.Panel(title, ...)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Numbers                          | `Ds.StatTile(label, value, words, state, trend, trendState, why)`, `Ds.Meter(fraction, state, word)`, `Stars(rating)` (halves)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Quiet Why?                       | `Ds.Why(host, WhyBreakdown, into)` adds a "?" that shows on host hover or "?" focus. Hovering it previews the summary; a click opens the breakdown in a side sheet (`DsOverlay.OpenWhy`). Phase 2 feeds it from UNITY-08's `WhySource` / `WhyPanel`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Tabs                             | `new DsTabs()` (underlined, with counts) or `new DsTabs(segmented: true)` (view switch). `.Add(id, label, count, icon)`, `Selected` event, arrow keys.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Table                            | `new DsTable<T>(columns, rows, details)`. `DsColumn<T>` has `Width` or `Grow`, `Align`, `SortKey` (click a header to sort), `Default` (false = only in the column picker), `Pinned` and `Help` (header tooltip). It has `RowClicked`, `SetExpanded(row)`, `SortBy`, `OpenColumnPicker(anchor)` and `ResetColumns`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Overlays                         | `DsOverlay.SideSheet(any, title, body, eyebrow, footer, width)`, `DsOverlay.Modal(any, title, body, buttons…)`, `DsOverlay.Popover(anchor, content)` and `DsOverlay.Toast(any, text, state, detail, seconds)`. They open into UNITY-07's `OverlayLayer`, which closes them with Escape or the scrim and moves focus inside.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Tooltip                          | `DsTooltip.Attach(element, text, title, when)` shows after 350 ms of hover or on keyboard focus. Add `DsTooltip.NoFocusTipClass` to skip the focus tooltip. Unity's own `tooltip` only shows in the editor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Cards                            | `DsCards.PortraitCard(WorkerCard)`, `DsCards.MatchupCard(Matchup, big)` (the title on the line in gold, a VS skew, pills only when something's wrong, the winner on the left with DEF. for results), `DsCards.ShowCard(ShowCardData, wide)`, `DsCards.NewsCard(item, lead, picture, tone, feature)`, `DsCards.Scoreboard(cells)`, `DsCards.Ticker(label, items)` and `DsCards.Logo(monogram, colour, size, picture)`                                                                                                                                                                                                                                                                                                                                                                                                             |
| Portraits                        | `new Portrait(texture, PortraitTone, name, style)` shows the workshop mod's picture. With no picture it draws a placeholder on a gradient in the side's colour (face blue, heel violet, neutral navy, champions gold). The default placeholder is `Portrait.DefaultStyle` = `PortraitStyle.Monogram`: initials with a faint sports-card stripe. `Silhouette` is a head over shoulders with no neck, and `MonogramSilhouette` is initials over a faint silhouette. A portrait with no name falls back to the silhouette. `Portrait.Initials(name)` takes the first and last words, gives two letters for a one-word name, and skips a leading "The" and quoted nicknames. `DsCards.PortraitBox(picture, side, size, gold, name)` sizes it (`ds-portrait--xs/sm/md/lg/xl`); pass the name. The comparison page is mockup screen 8. |
| Empty, loading                   | `Ds.Empty(icon, title, hint, action…)`, `Ds.Loading(text)`, `Ds.Skeleton(width%)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| App shell                        | `new AppShell(root)` clones `AppShell.uxml` with a sidebar from `NavigationModel` (`SetNav`, `SetCurrent`, `Collapsed`) and a top bar (`SetCrumbs`, `SetScore(ShellScore)`, `SetActions(cta, …)`). `Show(screen)` swaps the screen, and `Overlay` is its `OverlayLayer`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Form kit (EVT8, `UI/Design/Forms/`, stylesheet `Resources/Design/DsForm.uss` with `dsf-` classes; each
component adds it to itself, so it works inside overlays):

- `new DsTextField(label, value, changed, hint, name, maxLength, placeholder)` with `SetError` / `SetHint`.
- `new NumberStepper(label, value, min, max, onChange, minTooltip, maxTooltip, name)`: − and +, a typed
  input that accepts values outside the range (so the engine's words can show), Up/Down keys, `SetError`.
- `new DateField(label, value, min, max, onChange, name)`: `YYYY-MM-DD` with the day in words under it;
  `DateField.Check(text, min, max, out date)` is the pure rule.
- `new RecurrenceBuilder(RecurrenceValue, onChange, effectiveFrom, maxDate, name)`: Weekly, Every few
  weeks, Monthly and Yearly with their fields. `RecurrenceValue` is the engine's `Recurrence`
  (`ToJson`/`FromJson`; weekdays 0 = Monday).
- `new UpcomingDates(name)`: "Every Friday" and date chips; `SetDates(text, dates)`, `SetLoading(bool)`.

Painted pieces, which USS can't draw: `SkewShape` (`--skew-fill`, `--skew-edge`), `GradientFill`
(`--grad-top`, `--grad-bottom`) and `Icon`.

## Icons

There are 98 Lucide icons (ISC licence; the notice is in `docs/licenses/THIRD-PARTY-NOTICES.txt`).
They are stored as SVG path data and stroked at run time with Painter2D (`new Icon("roster",
"ds-icon--md")`). Each icon is 2 px on a 24 px grid with round caps, drawn in the element's
`color`. That keeps them sharp at every UI scale with no texture assets. Use `Filled = true` to fill
the shape instead (stars). Sizes are `ds-icon--xs/sm/md/lg/xl/2xl/3xl` = 12, 14, 16, 20, 24, 32 and
48 px. Names follow the web's `IconName` where the web has one, so the sidebar's `NavItem.Icon` values
work as they are.

To add an icon, put the name in the map in `game/tools/icons/build-icons.mjs`, then run
`node game/tools/icons/build-icons.mjs <path to node_modules/lucide-react>`. The default path is the
repo root's `node_modules`, which the web app installs.

## Mockups

Run them with `RingsideBooker.exe -rbMockups` (Boot opens the `Mockups` scene instead of the title),
or open `Assets/Scenes/Mockups.unity` in the editor. Rebuild that scene with the menu item
**Ringside Booker > Build Mockups Scene**, or in batch mode with
`-executeMethod RingsideBooker.UI.EditorTools.UiSceneBuilder.BuildMockups`.

The keys are 1 Office, 2 Roster, 3 Booking, 4 Show night, 5 Results, 6 Style guide and 7 Components.
Ctrl+B collapses the sidebar and Escape closes a sheet.

The sample data comes from the default world: the player runs Altura Wrestling Entertainment, and
the names, titles, shows, venues, attributes, contracts, reigns and TV deals are the world's own.
Morale, form, results and news are made up for the mockups.

To take the screenshot tour, build the player, then run `game/tools/mockup-shots.sh <dir>
[1920x1080 1280x720 …]`. It runs the player with
`-rbMockupShots <win dir>` at each size and saves 15 PNGs per size: Office, collapsed sidebar, cash
Why? hover, Roster cards, the Roster table with an expanded row and a Why? preview, the column picker,
the worker side sheet, Booking, the checklist with a problem, Show night, Results, the Results Why?
sheet, the style guide, components, and a modal with a toast.

## The game's shell (phase 2a)

The Game scene now uses the approved shell. `ShellController` clears the document root and builds an
`AppShell`. `Shell.uxml` is left as an empty tree asset. The old views are adapters onto it:

- `SidebarView(AppShell, …)` draws the promotion block (logo picture via `SidebarView.LogoTexture`,
  else a monogram plate; a SAMPLE tag for demo data). It also builds the icon nav from
  `NavigationModel.Visible(hasPromotion)` and sets the badges from `NavItem.BadgeKey`.
- `TopBarView(AppShell)` sets the crumbs and the scoreboard. The cash cell is named `cash-chip`,
  holds the exact amount as a tooltip and the trace ref as `userData`, and still gets
  `TopBarView.CashChipDecorator`, which adds a quiet Why? in its corner.
- `DayControlView` is unchanged apart from its skip button, which is now an icon button. It sits in
  `AppShell.Actions` after the bell.
- The bell (`AppShell.SetBell`) counts the day's stops. Clicking it opens Needs attention, or the
  inbox when nothing is waiting.
- The news ticker (`AppShell.SetTicker`) shows the headlines of an `IShellData` that also implements
  `IShellNews`. `EngineShellData` reads `news.top` (stories with names only) and `DemoGame` has
  sample lines. With no headlines, the ticker hides.
- The sidebar collapses with the Collapse link or Ctrl+B. The choice is remembered in PlayerPrefs
  as `rb.ui.sidebarCollapsed`.

Screens put their content in `AppShell.ScreenHost`, as before through `ScreenRegistry`. The
advance summary goes in `AppShell.SummarySlot`. Every `Ds*` component and `ds-` class is available
to screens, because `RingsideTheme.tss` imports the design system for all panels. The screen
restyles belong to the screen tickets.
