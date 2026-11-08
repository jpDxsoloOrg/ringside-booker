import { createBrowserRouter } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import {
  GALLERY_FRAME_PATH,
  GalleryFrameScreen,
  GalleryScreen,
} from '@/screens/dev-gallery/GalleryScreen';
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

/**
 * The component gallery ships in every build on purpose: it is small, linked from no navigation,
 * and handy for checking a deployed build on a real phone.
 */
const galleryRoutes: RouteObject[] = [
  { path: '/dev/gallery', element: <GalleryScreen /> },
  { path: GALLERY_FRAME_PATH, element: <GalleryFrameScreen /> },
];

/** Every route in the app. Tests build a memory router from the same list. */
export const appRoutes: RouteObject[] = [
  { path: '/', element: <HomePlaceholderScreen /> },
  ...galleryRoutes,
];

/** The app's router. Browser history gives clean URLs such as /game/office, with no `#`. */
export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(appRoutes, { future: routerFutureFlags });
}
