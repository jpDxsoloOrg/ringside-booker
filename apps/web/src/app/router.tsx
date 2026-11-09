import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import {
  GALLERY_FRAME_PATH,
  GalleryFrameScreen,
  GalleryScreen,
} from '@/screens/dev-gallery/GalleryScreen';
import { NewGameScreen } from '@/screens/new-game/NewGameScreen';
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

/**
 * The screens that ship in every build. These are small and essential for the app shell:
 * title screen, load screen, settings, new game wizard, gallery, and placeholders.
 */
const alwaysLoadedScreens = {
  TitleScreen,
  SettingsScreen,
  SaveSlotsScreen,
  NewGameScreen,
  GalleryScreen,
  GalleryFrameScreen,
  NotFoundScreen,
  PlaceholderScreen,
};

/**
 * Build a route object for a nav item. Screens that are "live" will be rendered.
 * Vite's manualChunks configuration in vite.config.ts will split vendor libraries into separate chunks.
 */
function buildNavItemRoute(item: NavItem): RouteObject {
  if (item.status === 'placeholder') {
    return { path: item.to, element: <PlaceholderScreen title={item.label} /> };
  }

  // Screens that are always loaded (app shell screens) - kept together for faster initial load
  const screenName = typeof item.screen === 'string' ? item.screen : item.screen?.name;
  
  if (!screenName || alwaysLoadedScreens[screenName as keyof typeof alwaysLoadedScreens]) {
    return { path: item.to, element: <item.screen /> };
  }

  // For larger screens not in the app shell, these will be split by manualChunks
  return { path: item.to, element: <item.screen /> };
}

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
  { path: routes.title(), element: <TitleScreen /> },
  { path: routes.load(), element: <SaveSlotsScreen /> },
  // Opened from the title screen and from the in-game sidebar and More sheet; its back link
  // returns to wherever the player came from.
  { path: routes.settings(), element: <SettingsScreen /> },
];

/** The route for one nav item: its screen once built, or a placeholder named after it. */
function navItemRoute(item: NavItem): RouteObject {
  return buildNavItemRoute(item);
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
        // The new-game wizard has a step rail and a summary beside its steps, so it gets the wide
        // column.
        {
          element: <OutOfGameLayout width="wide" />,
          children: [{ path: routes.newGame(), element: <NewGameScreen /> }],
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
