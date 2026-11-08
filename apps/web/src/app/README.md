# App shell and routing

The frame every screen lives in: the route map, the in-game shell, the session store and the
accessibility plumbing that every page shares.

| File                      | What it does                                                               |
| ------------------------- | -------------------------------------------------------------------------- |
| `routes.ts`               | Every URL, as builders (`routes.game.roster()`). No path strings elsewhere |
| `navigation.ts`           | The in-game navigation as data: sections, items, phone tab bar slots       |
| `router.tsx`              | The route tree, built from `routes.ts` and `navigation.ts`                 |
| `RequireWorld.tsx`        | Sends `/game/*` to the title screen when no world is loaded                |
| `session/sessionStore.ts` | Zustand: is a world loaded, and the local seat (whose promotion, if any)   |
| `settings/`               | Viewer settings: schema, store (localStorage), effects on `<html>`         |
| `layouts/OutOfGameLayout` | Title, load, new game and settings: centred, no navigation                 |
| `AppShell/`               | Desktop sidebar and top bar; phone top bar, bottom tab bar and More sheet  |
| `AppShell/day/`           | The day button, Skip days, the progress overlay and the advance summary    |
| `AppShell/status/`        | The status chips (date, cash, popularity) and the chip registry            |
| `a11y/`                   | Skip link, focus on navigation, page titles and the live announcer         |
| `dev/EnterShellRoute.tsx` | Dev and e2e builds only: fake a loaded world and open the shell            |
| `engine/`                 | Engine provider, query cache, status store and the engine hooks            |

## Adding a screen

1. Add its path segment to `GAME_SCREEN_SEGMENTS` and a builder to `routes.game` in `routes.ts`.
2. Add an item to the right section in `navigation.ts`, with `status: 'live'` and `screen` set to
   the component (or `status: 'placeholder'` until it is built).
3. Build the screen. Its heading is a `RouteHeading` (the page's one `h1`, which focus moves to
   after a navigation) and it calls `useDocumentTitle(label)`.
4. Add the path to `apps/web/e2e/routes-under-test.ts` so the smoke sweep checks it.

Nothing in `AppShell/` changes. Detail pages that are not nav items (a worker's profile at
`routes.game.worker(id)`) get a route next to the screen routes in `router.tsx`; the top bar and
sidebar treat them as part of the item they sit under.

## Talking to the engine

The engine runs in a Web Worker (`src/worker/engine.worker.ts`). The worker's host owns the world,
works out the local seat when a world is installed (`resolveLocalViewer`) and passes its viewer
and controller into every call, so screens never handle either. React code reaches it only
through the hooks in `engine/`:

| Hook                                | What it gives                                                         |
| ----------------------------------- | --------------------------------------------------------------------- |
| `useEngineQuery(name, args, opts?)` | `{ status, data, error, revision, isStale }`, cached and kept current |
| `useEngineCommand(name)`            | `{ run, pending, lastResult }`; refusals resolve, never throw         |
| `useAdvanceDays()`                  | `{ start, cancel, progress, running }` for multi-day skips            |
| `useEngineStatus(selector)`         | Revision, busy (`idle`, `query`, `command`, `advancing`), last error  |

Every applied command and every simulated day raises the world revision; a mounted query whose
result is older refetches and keeps showing the old data (`isStale`) meanwhile. If the worker
dies, `EngineProvider` shows the "simulation stopped" screen in place of the routes. Only
`src/worker` may import `createEngine` (a lint rule checks it). Tests use
`createInProcessTransport` with `src/test/fakeEngine.ts` instead of a worker.

## Saves

The title screen (`screens/title`) and the saved games list at `/load` (`screens/saves`) are the
way into a game. Loading and saving run in the engine worker, so a save's bytes go from IndexedDB
through the engine's staged checks into a running engine without visiting the main thread:

| Host method                   | What it does                                                          |
| ----------------------------- | --------------------------------------------------------------------- |
| `loadFromSlot(slotId, which)` | Reads `latest` or a backup, runs `loadSave`, installs the engine      |
| `saveToSlot(slotId)`          | `exportState` → `createSaveDocument` → `encodeSave` → manual save     |
| `createSlot(label)`           | The same, into a new slot (the new-game flow)                         |
| `autosave(slotId, options)`   | The same, into the slot's autosave (monthly backup on request)        |
| `inspectSave(bytes)`          | Reads a file's header for an import                                   |
| `unloadWorld()`               | Stops the game; the revision moves on so every cached query refetches |

A load that fails comes back as the stage that refused it and up to 50 issues with document paths;
the screens show the first 20 in `LoadErrorSheet`. Listing, deleting, exporting and importing run
on the main thread through `screens/saves/saveStorage.tsx`, which tests replace with
`src/test/fakeStorage.ts`. "Main menu" in the sidebar and the More sheet saves into the session's
slot, unloads the world and returns to the title screen; a failed save keeps the player in the game.

## Moving time

The end of the top bar (`AppShell/TopBarStatus.tsx`) shows the game's status and the control that
moves time. Status comes from two engine built-ins, `sim.status` (date, season, the seat's cash and
popularity) and `sim.pendingGates` (why Next Day would stop today), read by
`status/useShellStatus.ts`; the web app adds no engine queries of its own.

- **The day button** (`day/DayControl.tsx`) reads "Next day" until a gate waits. Then
  `day/dayControlState.ts` turns the gates into a button by their route hint: `inbox` ("2 decisions
  waiting", which outranks everything), `booking` ("Go to show"), and anything else "Needs
  attention" with the gate's reason. Shift+N presses it outside text fields and dialogs.
- **Skip days** (`day/SkipDaysSheet.tsx`) takes a length (1 to 3,650 days) and an optional stop
  date, both checked against the engine's rules, with the calendar maths from `@ringside/engine`.
- **One controller** (`day/DayAdvanceProvider.tsx`) runs every advance: the overlay reads its
  progress, `AdvanceSummary` shows the result under the top bar and the live region announces it.
  After each advance that moved a day it asks `shouldAutosave` and, when told to, calls the host's
  `autosave`.
- **Status chips** come from `status/StatusChips.tsx`. Another system adds one with
  `registerStatusChip({ id, order, render })` (`status/statusChipRegistry.ts`) instead of editing
  the shell.

## Rules

- **Sections that need a promotion hide while unemployed.** `requiresPromotion` on a section and
  `useHasPromotion()` (the local seat's `promotionId`) decide it; nothing else checks employment.
- **Phone tab bar.** Four slots plus More. An item claims a slot with `mobilePrimary`; when that
  item is hidden, the item marked `mobileFallback` for the slot takes it.
- **Focus.** After a navigation `RouteFocus` focuses the `[data-route-heading]` element, or `#main`.
  It leaves focus alone on the first load, on redirects during start-up and on hash-only changes.
- **Announcements.** `useAnnounce()` speaks short status text (`announce('Advanced to Monday')`),
  politely by default.
- **The dev helper never ships.** `/dev/enter-shell` is registered only when `import.meta.env.DEV`
  is true or the build sets `VITE_E2E=1`, which the Playwright web server does (into `dist-e2e/`,
  never `dist/`). A unit test checks the production route list leaves it out.
