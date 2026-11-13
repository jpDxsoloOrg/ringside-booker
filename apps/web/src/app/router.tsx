import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { NotFoundScreen } from '@/screens/not-found/NotFoundScreen';
import { PlaceholderScreen } from '@/screens/placeholder/PlaceholderScreen';
import { SaveSlotsScreen } from '@/screens/saves/SaveSlotsScreen';
import { SettingsScreen } from '@/screens/settings/SettingsScreen';
import { TitleScreen } from '@/screens/title/TitleScreen';
import { LiveAnnouncer } from './a11y/LiveAnnouncer';
import { RouteFocus } from './a11y/RouteFocus';
import { AppShell } from './AppShell/AppShell';
import { devRoutesEnabled, EnterShellRoute } from './dev/EnterShellRoute';
import type { DevRouteFlags } from './dev/EnterShellRoute';
import { OutOfGameLayout } from './layouts/OutOfGameLayout';
import { allNavItems, navigationSections } from './navigation';
import type { NavItem } from './navigation';
import { RequireWorld } from './RequireWorld';
import { routePatterns, routes } from './routes';
import { SettingsEffects } from './settings/SettingsEffects';
// The results page's calendar section, action and chip badge, registered before any calendar draws.
import '@/screens/show-results/calendarHooks';
// The calendar show sheet's Crowd section (EVT6-06).
import '@/screens/box-office/ShowCrowdSection';
// The worker profile's Form tab (MTCH3-04); its panel loads with the tab.
import '@/screens/workers/profile/tabs/recentFormTab';
// The Fan base sheet's "This month" figure (DAY2-06, for EVT5).
import '@/screens/promotion-popularity/fanBaseColumn';

/**
 * Opt in to the React Router 7 behaviours now, so the upgrade later changes nothing and the
 * router does not log a deprecation warning for each flag.
 */
export const routerFutureFlags = {
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_relativeSplatPath: true,
  v7_skipActionErrorRevalidation: true,
} as const;

/** The matching flag for `<RouterProvider future={...}>`. */
export const routerProviderFutureFlags = { v7_startTransition: true } as const;

/**
 * Everything every route shares: the live announcer, focus handling on navigation, and the viewer
 * settings kept applied to the document.
 */
function RootLayout() {
  return (
    <LiveAnnouncer>
      <SettingsEffects />
      <RouteFocus />
      <Outlet />
    </LiveAnnouncer>
  );
}

/**
 * The component gallery ships in every build on purpose: it is linked from no navigation and
 * handy for checking a deployed build on a real phone. It renders every component entry, so it
 * loads as its own chunk the first time it is opened instead of sitting in the main bundle (UI-21).
 */
const galleryRoutes: RouteObject[] = [
  {
    path: routes.dev.gallery(),
    lazy: async () => {
      const { GalleryScreen } = await import('@/screens/dev-gallery/GalleryScreen');
      return { Component: GalleryScreen };
    },
  },
  {
    path: routes.dev.galleryFrame(),
    lazy: async () => {
      const { GalleryFrameScreen } = await import('@/screens/dev-gallery/GalleryScreen');
      return { Component: GalleryFrameScreen };
    },
  },
];

/** The screens outside a game, in the centred layout with no navigation. */
const outOfGameRoutes: RouteObject[] = [
  { path: routes.title(), element: <TitleScreen /> },
  { path: routes.load(), element: <SaveSlotsScreen /> },
  // Opened from the title screen and from the in-game sidebar and More sheet; its back link
  // returns to wherever the player came from.
  { path: routes.settings(), element: <SettingsScreen /> },
];

/** The route for one nav item: its screen once built, or a placeholder named after it. */
function navItemRoute(item: NavItem): RouteObject {
  if (item.status === 'live') {
    const Screen = item.screen;
    return { path: item.to, element: <Screen /> };
  }
  return { path: item.to, element: <PlaceholderScreen title={item.label} /> };
}

/** Every in-game screen, built from the navigation config. */
export const gameScreenRoutes: RouteObject[] = allNavItems(navigationSections).map(navItemRoute);

/**
 * Detail pages that sit under a navigation item without being one, such as one worker's profile
 * under Workers (`/game/workers/:personId`). `findNavLocation` gives each to the item whose path
 * it starts with, so the sidebar highlight needs nothing here.
 */
export const gameDetailRoutes: RouteObject[] = [
  {
    path: routePatterns.worker,
    // Its own chunk: the profile pulls in the tabs, the drill-down and the career tables (UI-21).
    lazy: async () => {
      const { WorkerProfileScreen } = await import('@/screens/workers/profile/WorkerProfileScreen');
      return { Component: WorkerProfileScreen };
    },
  },
  {
    path: routePatterns.showResults,
    // Its own chunk: the results page, its reveal and the sections other features add (EVT3-06).
    lazy: async () => {
      const { ShowResultsScreen } = await import('@/screens/show-results/ShowResultsScreen');
      return { Component: ShowResultsScreen };
    },
  },
  {
    path: routePatterns.promotion,
    // Its own chunk: the profile pulls in its tabs, the needs, the roster and the decision log.
    lazy: async () => {
      const { PromotionProfileScreen } =
        await import('@/screens/promotions/profile/PromotionProfileScreen');
      return { Component: PromotionProfileScreen };
    },
  },
];

const gameRoute: RouteObject = {
  path: routes.game.root(),
  element: (
    <RequireWorld>
      <AppShell />
    </RequireWorld>
  ),
  children: [
    { index: true, element: <Navigate to={routes.game.office()} replace /> },
    ...gameScreenRoutes,
    ...gameDetailRoutes,
  ],
};

/** Dev server and e2e build only. */
const devOnlyRoutes: RouteObject[] = [
  { path: routePatterns.enterShell, element: <EnterShellRoute /> },
];

export interface AppRouteOptions {
  /** Register the dev-only routes, such as the enter-shell helper. */
  readonly includeDevRoutes: boolean;
}

/** Builds the full route list. Tests build a memory router from it. */
export function buildAppRoutes({ includeDevRoutes }: AppRouteOptions): RouteObject[] {
  return [
    {
      element: <RootLayout />,
      children: [
        { element: <OutOfGameLayout />, children: outOfGameRoutes },
        // The new-game wizard has a step rail and a summary beside its steps, so it gets the wide
        // column.
        {
          element: <OutOfGameLayout width="wide" />,
          children: [
            {
              path: routes.newGame(),
              lazy: async () => {
                const { NewGameScreen } = await import('@/screens/new-game/NewGameScreen');
                return { Component: NewGameScreen };
              },
            },
          ],
        },
        gameRoute,
        ...galleryRoutes,
        ...(includeDevRoutes ? devOnlyRoutes : []),
        { element: <OutOfGameLayout />, children: [{ path: '*', element: <NotFoundScreen /> }] },
      ],
    },
  ];
}

/** The flags of the running build. */
export const buildFlags: DevRouteFlags = {
  DEV: import.meta.env.DEV,
  VITE_E2E: import.meta.env.VITE_E2E,
};

/** Every route in this build. */
export const appRoutes: RouteObject[] = buildAppRoutes({
  includeDevRoutes: devRoutesEnabled(buildFlags),
});

/**
 * The router's basename: Vite's base URL without its trailing slash, so a build served under
 * `/ringside-booker/` (GitHub Pages) matches the same routes as one served at `/`.
 */
export function routerBasename(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** The app's router. Browser history gives clean URLs such as /game/office, with no `#`. */
export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(appRoutes, {
    basename: routerBasename(import.meta.env.BASE_URL),
    future: routerFutureFlags,
  });
}
