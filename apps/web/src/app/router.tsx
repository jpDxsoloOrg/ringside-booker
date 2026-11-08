import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import {
  GALLERY_FRAME_PATH,
  GalleryFrameScreen,
  GalleryScreen,
} from '@/screens/dev-gallery/GalleryScreen';
import { HomePlaceholderScreen } from '@/screens/home-placeholder/HomePlaceholderScreen';
import { NotFoundScreen } from '@/screens/not-found/NotFoundScreen';
import { PlaceholderScreen } from '@/screens/placeholder/PlaceholderScreen';
import { SettingsScreen } from '@/screens/settings/SettingsScreen';
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
 * The component gallery ships in every build on purpose: it is small, linked from no navigation,
 * and handy for checking a deployed build on a real phone.
 */
const galleryRoutes: RouteObject[] = [
  { path: routes.dev.gallery(), element: <GalleryScreen /> },
  { path: GALLERY_FRAME_PATH, element: <GalleryFrameScreen /> },
];

/** The screens outside a game, in the centred layout with no navigation. */
const outOfGameRoutes: RouteObject[] = [
  { path: routes.title(), element: <HomePlaceholderScreen /> },
  { path: routes.load(), element: <PlaceholderScreen title="Load game" /> },
  // The new-game wizard replaces this placeholder when it lands.
  { path: routes.newGame(), element: <PlaceholderScreen title="New game" /> },
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

/** The app's router. Browser history gives clean URLs such as /game/office, with no `#`. */
export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(appRoutes, { future: routerFutureFlags });
}
