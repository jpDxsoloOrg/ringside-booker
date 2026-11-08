import { createBrowserRouter } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { DevGalleryScreen } from '@/screens/dev-gallery/DevGalleryScreen';
import { HomePlaceholderScreen } from '@/screens/home-placeholder/HomePlaceholderScreen';

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

/** Dev-only screens ship in dev builds and in the end-to-end build, never in a release build. */
export const includeDevRoutes: boolean = import.meta.env.DEV || import.meta.env.VITE_E2E === '1';

const devRoutes: RouteObject[] = [{ path: '/dev/gallery', element: <DevGalleryScreen /> }];

/** Every route in the app. Tests build a memory router from the same list. */
export const appRoutes: RouteObject[] = [
  { path: '/', element: <HomePlaceholderScreen /> },
  ...(includeDevRoutes ? devRoutes : []),
];

/** The app's router. Browser history gives clean URLs such as /game/office, with no `#`. */
export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(appRoutes, { future: routerFutureFlags });
}
