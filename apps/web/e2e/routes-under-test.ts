/** One route the generic e2e sweep visits. */
export interface RouteUnderTest {
  /** Path to open, relative to the preview server root. */
  readonly path: string;
  /** Readable name used in test titles. */
  readonly name: string;
  /**
   * True when the route only makes sense inside a loaded game. The sweep enters the shell first
   * for these (the dev enter-shell helper, with a promotion), then navigates to the path.
   */
  readonly needsWorld: boolean;
  /** The text of the page's `h1`, when the sweep should check it. */
  readonly heading?: string;
}

/**
 * The in-game screens and their headings. Kept as plain data rather than imported from the app,
 * so the e2e project stays separate from the app's module graph; shell.spec.ts checks the
 * sidebar against this list, so a screen missing here fails there.
 */
export const gameRoutes: readonly RouteUnderTest[] = [
  { path: '/game/office', name: 'dashboard', heading: 'Dashboard', needsWorld: true },
  { path: '/game/inbox', name: 'inbox', heading: 'Inbox', needsWorld: true },
  { path: '/game/news', name: 'news', heading: 'News', needsWorld: true },
  { path: '/game/workers', name: 'workers', heading: 'Workers', needsWorld: true },
  { path: '/game/promotions', name: 'promotions', heading: 'Promotions', needsWorld: true },
  {
    path: '/game/event-history',
    name: 'event history',
    heading: 'Event history',
    needsWorld: true,
  },
  { path: '/game/roster', name: 'roster', heading: 'Roster', needsWorld: true },
  { path: '/game/booking', name: 'booking', heading: 'Booking', needsWorld: true },
  { path: '/game/calendar', name: 'calendar', heading: 'Calendar', needsWorld: true },
  { path: '/game/titles', name: 'titles', heading: 'Titles', needsWorld: true },
  { path: '/game/storylines', name: 'storylines', heading: 'Storylines', needsWorld: true },
  { path: '/game/teams', name: 'teams and stables', heading: 'Teams & stables', needsWorld: true },
  { path: '/game/tournaments', name: 'tournaments', heading: 'Tournaments', needsWorld: true },
  { path: '/game/brands', name: 'brands', heading: 'Brands', needsWorld: true },
  { path: '/game/finances', name: 'finances', heading: 'Finances', needsWorld: true },
  { path: '/game/contracts', name: 'contracts', heading: 'Contracts', needsWorld: true },
  { path: '/game/networks', name: 'networks', heading: 'Networks', needsWorld: true },
  { path: '/game/production', name: 'production', heading: 'Production', needsWorld: true },
  { path: '/game/match-lab', name: 'match lab', heading: 'Match lab', needsWorld: true },
];

/**
 * Every route the smoke sweep checks for one h1, no horizontal scroll and no serious
 * accessibility violations on desktop and phone. Add a line here when a screen gets a route.
 */
export const routesUnderTest: readonly RouteUnderTest[] = [
  { path: '/', name: 'title', heading: 'Ringside Booker', needsWorld: false },
  { path: '/load', name: 'saved games', heading: 'Saved games', needsWorld: false },
  { path: '/new', name: 'new game', heading: 'New game', needsWorld: false },
  { path: '/settings', name: 'settings', heading: 'Settings', needsWorld: false },
  { path: '/no-such-page', name: 'not found', heading: 'Page not found', needsWorld: false },
  { path: '/dev/gallery', name: 'component gallery', needsWorld: false },
  ...gameRoutes,
];
