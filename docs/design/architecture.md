# Ringside Booker: architecture

Ringside Booker is a wrestling promotion management sim that runs in the browser.
You book the shows for one promotion, and the rest of the world runs itself
around you. Saves stay on your machine. There is no server.

This doc covers how the code is laid out and the rules every part of it follows.
Game design (what the formulas are and why) lives in `docs/design/` next to this file,
one doc per system.

## Goals

1. **Every number explains itself.** Match ratings, attendance, popularity
   changes, wage demands, AI decisions: each one comes with a breakdown of
   inputs and steps that the UI can show in a "Why?" panel. If I can't explain
   a number, it doesn't ship.
2. **Deterministic.** Same save + same seed + same inputs = same result. This
   makes bugs reproducible and lets the balance harness run years of game time
   and compare runs.
3. **One engine, with a lighter path for rival promotions.** Rival (AI) shows
   run through the same formulas as the player's, but some player-only systems
   are skipped for them so long skips stay fast (see
   `design-decisions.md` D-01). Every shortcut is a named tunable that defaults
   on, so a "level playing field" setting can switch them all off.
4. **Desktop browser first, playable on a phone.** Every screen is designed for
   a desktop window first and then gets a mobile layout. Nothing is
   desktop-only.
5. **Data, not code, for content.** Workers, promotions, titles, gimmicks,
   finishes, match stories, random events and balance numbers are data that can
   be edited and shared as packs.

## Repository layout

npm workspaces monorepo:

```
ringside-booker/
├── packages/
│   └── engine/            @ringside/engine: the simulation. Pure TypeScript, no DOM, no React.
│       ├── src/
│       │   ├── core/      ids, rng, tunables, trace, pipeline, event bus, errors
│       │   ├── model/     entity types + zod schemas, the World store
│       │   ├── systems/   one folder per game system (workers, matches, shows, economy, ...)
│       │   ├── persistence/  save format, versioning, migrations
│       │   └── index.ts   public API
│       └── test/
├── apps/
│   └── web/               the game UI. React + Vite. Talks to the engine through a Web Worker.
│       └── src/
│           ├── app/       shell, routing, layout, providers
│           ├── screens/   one folder per screen
│           ├── components/ shared UI building blocks
│           ├── worker/    engine host running in a Web Worker
│           ├── storage/   IndexedDB save slots, import/export
│           └── styles/    design tokens, global CSS
├── content/               the shipped fictional world and base data packs (JSON)
├── tools/                 headless runners: balance harness, data validation
└── docs/
    ├── design/            game + technical design docs
    ├── dev-journal/       dated build notes
    └── blog/              blog series
```

## Stack

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript 5, `strict`, no `any` | One language end to end; the engine is the riskiest code and needs types most |
| Engine tests | Vitest | Fast, same config style as the web app |
| Validation | zod | One schema gives types plus runtime checks for saves, data packs and tunables |
| UI | React 18 + React Router 6 | What I already use everywhere |
| Build | Vite | Fast dev server, Web Worker support out of the box |
| UI state | Zustand for UI-only state; game data is read from the engine | Keeps the engine the single source of truth |
| Engine ↔ UI | Web Worker + Comlink | Multi-day skips and AI turns run off the main thread so the UI never freezes |
| Styling | CSS Modules + CSS custom properties (design tokens) | No inline styles; tokens make themes and the mobile layout manageable |
| Saves | IndexedDB (via `idb`), gzip-compressed JSON via `CompressionStream` | Big saves, no quota issues with localStorage, export to a file |
| Lint/format | ESLint flat config + typescript-eslint, Prettier | `@typescript-eslint/no-explicit-any` is an error |
| E2E | Playwright with a desktop and a phone viewport project | The phone layout is tested, not assumed |
| CI | GitHub Actions: lint, typecheck, test, build | Every PR |

## Engine rules

### The World store

All game state lives in one `World` object made of typed tables
(`Map<Id, Entity>` per entity type) plus world metadata (date, seed, settings).
Entities reference each other **only by ID**. There are no nested copies and no
names used as keys.

Systems change the world through a `Tx` (transaction) handle. The pipeline opens
a transaction per step. If a step throws, its writes are rolled back from the
undo journal, the error is recorded, and the day keeps going. One broken step
never cancels the rest of the day.

### IDs

Branded string types per entity (`PersonId`, `PromotionId`, ...) with a short
prefix (`per_`, `pro_`, `tit_`, ...). New IDs come from the seeded RNG so a
replay creates the same IDs.

### Randomness

No `Math.random()` anywhere in the engine (lint rule). All randomness comes
from a seeded, serialisable RNG with **named streams** (`rng.stream('injuries')`),
so adding a new random call in one system doesn't shift the results of another.
Helpers state odds exactly: `chance(0.15)`, `intBetween(1, 6)` with both ends
included and documented.

### Tunables

Every balance number lives in a typed tunables registry with a key, default,
allowed range, unit and description. Saves can override tunables, and the
override is validated. A value of 0 means 0, never "use the default". The
tunables editor and balance profiles read this registry.

### Formulas and calculation traces

Every game formula is a pure function in `systems/*` that takes plain inputs
and returns `Traced<T>`:

```ts
interface Traced<T> {
  value: T;
  trace: TraceNode; // label, value, inputs, and child steps (modifiers, clamps, rolls)
}
```

The trace records the inputs, each modifier with its reason, every clamp that
applied, and every random roll with its range and result. The UI renders traces
in the "Why?" panel. Traces are kept for the latest results and summarised for
history, so saves don't fill up with them.

Formula functions are unit tested at their edges (clamps, branch boundaries,
zero, maximum). Each formula has a design doc section that the tests point at.

### The day pipeline

Advancing time runs an ordered list of registered **phases** (housekeeping,
world events, AI turns, contracts, shows, growth, money, weekly/monthly/yearly
jobs, ...). Each phase is a named step with a transaction and its own error
report. Multi-day skip runs the pipeline in a loop and stops at gates: the
player's show day, a decision waiting in the inbox, or a user-set stop.

### Event bus

Systems publish domain events (`match.completed`, `title.changed`,
`contract.signed`, `worker.injured`, ...). News, the social feed, achievements
and mods subscribe to these instead of reaching into other systems. The bus
runs inside the engine, so it works the same for player and AI shows and inside
the Web Worker.

### Engine API

The web app never touches the World directly. The engine exposes:

- **queries**: read-only views shaped for screens (roster rows, card forecast,
  finance summary). These are plain serialisable objects that cross the worker
  boundary.
- **commands**: intent-based changes (`bookSegment`, `offerContract`,
  `advanceDays`) that are validated and either fully applied or rejected with
  reasons.

### Controllers and commands (multiplayer-ready)

Every promotion and brand has a **controller**: a human player or the computer
(see `design-decisions.md` D-07). The engine never assumes a single player.
Every player action is a command recorded in a command log with the controller
that issued it, and queries take the viewing controller so each player sees
only what their promotion would know. The engine package has no browser
dependencies, so it can also run on a server for online multiplayer later.

Floating-point note: `Math.exp`, `Math.pow`, `Math.log` and similar can return
slightly different results in different JavaScript engines. Determinism is
promised for the same engine build. Online play is server-authoritative, so
clients never need to match each other bit for bit.

## Persistence

- A save is one document: format version, engine version, seed, the World
  tables, and recent traces.
- Saves are gzip-compressed JSON stored in IndexedDB save slots, with autosave
  and a few rotating backups.
- Export/import a save as an `.rbsave` file so you can move a game between
  computers or from desktop to phone.
- Every format change bumps the version and adds a tested migration. Loading
  validates with zod and reports what's wrong instead of crashing.

## UI rules

- The desktop browser layout is the primary design. Each screen also has a
  mobile layout below the `--bp-mobile` breakpoint: dense tables become stacked
  cards, side panels become sheets or tabs, and the main nav becomes a
  compact menu.
- Every screen ticket's acceptance criteria include "usable at phone width
  (390px)". The Playwright phone project checks it.
- Placeholder art until real images arrive: generated initials/silhouette
  avatars for people, generic belt and logo shapes for titles and promotions.
  One `ImageSlot` component resolves an entity's image, so swapping in real
  images later doesn't change any screen.
- Every derived number shown on screen can open its "Why?" trace.
- CSS Modules and design tokens only. No inline styles.

## Code style

- No `any`; use `unknown` and narrow.
- Functional React components with hooks.
- async/await, no `.then` chains.
- Descriptive names; single letters only for loop indexes.
- Engine code has no imports from `apps/` and no DOM APIs.
