/** One route the generic e2e sweep visits. */
export interface RouteUnderTest {
  /** Path to open, relative to the preview server root. */
  readonly path: string;
  /** Readable name used in test titles. */
  readonly name: string;
  /**
   * True when the route only makes sense inside a loaded game. The sweep skips these until the
   * harness can start a world (the dev shell helper, then real saves).
   */
  readonly needsWorld: boolean;
}

/**
 * Every route the smoke sweep checks for one h1, no horizontal scroll and no serious
 * accessibility violations on desktop and phone. Add a line here when a screen gets a route.
 */
export const routesUnderTest: readonly RouteUnderTest[] = [
  { path: '/', name: 'home', needsWorld: false },
  { path: '/dev/gallery', name: 'component gallery', needsWorld: false },
];
