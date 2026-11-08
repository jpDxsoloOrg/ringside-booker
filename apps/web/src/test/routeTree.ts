import type { RouteObject } from 'react-router-dom';

/** Every route in a route tree, depth first. */
export function flattenRoutes(routeList: readonly RouteObject[]): RouteObject[] {
  return routeList.flatMap((route) => [route, ...flattenRoutes(route.children ?? [])]);
}

/** The route registered at exactly `path` (the app writes every path in full), or undefined. */
export function findRouteByPath(
  routeList: readonly RouteObject[],
  path: string,
): RouteObject | undefined {
  return flattenRoutes(routeList).find((route) => route.path === path);
}
