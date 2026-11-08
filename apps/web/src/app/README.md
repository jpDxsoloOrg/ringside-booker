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
| `layouts/OutOfGameLayout` | Title, load, new game and settings: centred, no navigation                 |
| `AppShell/`               | Desktop sidebar and top bar; phone top bar, bottom tab bar and More sheet  |
| `a11y/`                   | Skip link, focus on navigation, page titles and the live announcer         |
| `dev/EnterShellRoute.tsx` | Dev and e2e builds only: fake a loaded world and open the shell            |

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
  is true or the build sets `VITE_E2E=1`, which the Playwright web server does. A unit test checks
  the production route list leaves it out.
