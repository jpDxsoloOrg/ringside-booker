# Visual identity

Ringside Booker should feel like running a sports business, and then going live.
Most of the game is management (roster, contracts, money, inbox). That needs to
be calm and readable for long sessions. The moments that matter (booking a
show, show night, a title change, a draft, a season finale) get the energy of a
sports broadcast.

So the UI has two registers that share one palette and one type system:

| Register  | Used for                                                                                                                        | Feel                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Office    | Roster, worker profiles, contracts, finance, inbox, news, calendar, settings, world browser                                     | Front-office dashboard: rounded cards, sentence-case body text, clear tables, stat cards    |
| Broadcast | Booking screen, show night and results, title changes, drafts, brand-war scoreboard, season recap, the Next Day control, ticker | TV sports graphics: condensed uppercase, skewed bugs, lower-thirds, chamfered panels, glows |

Reference mockups live in [`mockups/`](mockups/). The dashboard mixes both:
office cards around a broadcast "Up next" lower-third and a live Next Day bug.

The theme is **dark only** for now, like an arena with the house lights down. The
tokens keep a theme layer so a light theme can be added later.

## Colour

### Roles

Colour carries meaning, so each hue has one job:

| Role            | Token                    | Hex       | Used for                                                             |
| --------------- | ------------------------ | --------- | -------------------------------------------------------------------- |
| Canvas          | `--color-bg`             | `#090D16` | Page background                                                      |
| Surface         | `--color-surface`        | `#0F172A` | Cards, panels                                                        |
| Surface raised  | `--color-surface-raised` | `#131D31` | Popovers, active panels, score bugs                                  |
| Surface hover   | `--color-surface-hover`  | `#1A2740` | Row and card hover                                                   |
| Border          | `--color-border`         | `#24334D` | Hairlines between and around things                                  |
| Border strong   | `--color-border-strong`  | `#3B4D6B` | Inputs, focusable outlines                                           |
| Text            | `--color-text`           | `#F1F5F9` | Body and headings                                                    |
| Text muted      | `--color-text-muted`     | `#94A3B8` | Secondary text, labels                                               |
| Text subtle     | `--color-text-subtle`    | `#64748B` | Large or decorative text only (4.1:1)                                |
| Action          | `--color-action`         | `#D7301A` | Primary button fills (white text, 4.9:1)                             |
| Action bright   | `--color-action-bright`  | `#FF3B1D` | Live states, glows, focus of attention, large display text, outlines |
| Data            | `--color-data`           | `#00E5FF` | Numbers, meters, charts, links, info                                 |
| Prestige        | `--color-prestige`       | `#FACC15` | Titles, champions, awards, top picks                                 |
| Up / positive   | `--color-positive`       | `#34D399` | Rising deltas, good outcomes                                         |
| Down / negative | `--color-negative`       | `#FB7185` | Falling deltas, injuries, losses                                     |
| Face            | `--color-face`           | `#00E5FF` | Alignment chip (same hue as data: the "cool" side)                   |
| Heel            | `--color-heel`           | `#FF3B1D` | Alignment chip (same hue as action: the "hot" side)                  |
| Tweener         | `--color-tweener`        | `#A78BFA` | Alignment chip                                                       |

All text colours pass WCAG AA on both the canvas and raised surfaces. The checks
live in `tokens.test.ts`.

### Why these colours

- **One warm accent against a cool field.** The navy neutrals sit near
  the cyan's hue, so the whole base reads cool and calm. The red-orange is
  nearly complementary to cyan. Against that field it's the one thing that
  pops, so it's saved for "act now / this is live".
- **Gold is the red-orange's warm neighbour.** It belongs to the same family
  but is lighter and calmer, which suits prestige: important without being
  urgent.
- **60-30-10.** About 60% navy canvas and surfaces, 30% text and borders, 10%
  accent. If a screen looks busy, there's too much accent.
- **Deltas are not the action colour.** Down uses rose (`#FB7185`), not the
  red-orange, so "this dropped" is never confused with "press this".
- **Never colour alone.** Every coloured state also has an icon, sign or label
  (▲ +4, ▼ −2, FACE/HEEL text).

## Type

| Use                                                   | Family           | Notes                                               |
| ----------------------------------------------------- | ---------------- | --------------------------------------------------- |
| Display, section headers, labels, chips, stat numbers | Barlow Condensed | 600–800, uppercase for labels and broadcast headers |
| Body, tables, forms, descriptions                     | Inter            | 400–600, sentence case                              |
| Numbers in tables and stats                           | either           | `font-variant-numeric: tabular-nums` always         |

Both fonts are self-hosted (Fontsource), so there are no runtime requests to a
font CDN.

In the office register, Barlow Condensed is used for headings, labels and big
numbers only. In the broadcast register it carries everything, uppercase with
wide tracking.

## Shape

- **Office:** 10px card radius, 8px controls, pill chips.
- **Broadcast:** square corners, 8px chamfers on panel corners, −12° skew on bugs,
  tabs and primary show actions (the text inside is un-skewed), 45° slash
  dividers.
- Borders are 1px hairlines in `--color-border`. Depth comes from the surface
  steps, not big soft shadows.

## Signature components

Broadcast:

- **Live bug button**: skewed red-orange button with a pulsing dot. Used for
  Next Day and for "Go live" on show night.
- **Lower-third header**: the "Up next" show card and results headers.
- **Score bug**: a compact strip of 2–4 key numbers, each with a Why? chip.
- **Ticker**: news crawl above the bottom edge. It pauses on hover and goes
  static with reduced motion.
- **Segmented meter**: hype, heat and fatigue shown as discrete ticks that shift
  from cyan to red-orange near the danger end.
- **Card slot**: a booking slot showing its role (Opener … Main Event), the
  matchup, chips and the chosen winner.

Office:

- **KPI card**: label, big number, delta chip, optional sparkline.
- **Stat table**: compact rows with tabular numbers that become stacked cards on
  phones.
- **Champion card**: belt placeholder, champion, reign length and prestige.
- **Alignment chip**: FACE / HEEL / TWEENER.

## Motion

Motion is sparing and only means something live or changing: the live-bug pulse,
the ticker crawl, meter fills animating to new values after a day advances.
Everything respects `prefers-reduced-motion`.

## Phones

- The left sidebar becomes a bottom tab bar (Office, Roster, Booking, Calendar,
  More), with the ticker sitting above it.
- KPI cards go to two columns, and tables become stacked cards.
- Champion strips and other wide rows become horizontal swipe rows.
- The Next Day bug stays in the top bar.

## Components come from proven libraries

Interactive behaviour comes from well-tested, unstyled libraries, and the look
is ours:

- **Radix UI** primitives for tabs, dialogs, sheets, dropdown menus, popovers,
  tooltips, selects and switches. They handle focus, keyboard and screen readers.
- **TanStack Table** for sorting, filtering and column logic in the data table.
- **Lucide** for icons.
- Styling stays in CSS Modules on top of the tokens.
