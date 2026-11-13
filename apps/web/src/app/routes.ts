import type { EventInstanceId, PersonId } from '@ringside/engine';

/**
 * Every URL in the app, built here and nowhere else. Screens, links and tests call these builders
 * (`routes.game.roster()`) instead of writing path strings, so a renamed path is one edit.
 *
 * In-game screens live under `/game`. Their last path segment is listed once in
 * `GAME_SCREEN_SEGMENTS`; the router and the navigation config both read it.
 */

/** The in-game screens and the path segment each one lives at under `/game`. */
export const GAME_SCREEN_SEGMENTS = {
  office: 'office',
  inbox: 'inbox',
  news: 'news',
  workers: 'workers',
  promotions: 'promotions',
  eventHistory: 'event-history',
  roster: 'roster',
  calendar: 'calendar',
  booking: 'booking',
  titles: 'titles',
  storylines: 'storylines',
  teams: 'teams',
  tournaments: 'tournaments',
  brands: 'brands',
  finances: 'finances',
  contracts: 'contracts',
  networks: 'networks',
  production: 'production',
  matchLab: 'match-lab',
} as const;

export type GameScreenId = keyof typeof GAME_SCREEN_SEGMENTS;

function isGameScreenId(value: string): value is GameScreenId {
  return Object.hasOwn(GAME_SCREEN_SEGMENTS, value);
}

/** The id of every in-game screen, in the order they are declared above. */
export const GAME_SCREEN_IDS: readonly GameScreenId[] =
  Object.keys(GAME_SCREEN_SEGMENTS).filter(isGameScreenId);

const GAME_ROOT = '/game';

function gameScreenPath(screenId: GameScreenId): string {
  return `${GAME_ROOT}/${GAME_SCREEN_SEGMENTS[screenId]}`;
}

/** What a link into the calendar can ask for. Anything left out takes the screen's default. */
export interface CalendarLinkOptions {
  /** The month to open on, as `YYYY-MM`. The month of the game's date when left out. */
  readonly month?: string;
  /** Whose shows to list: the viewer's own (`mine`, the default) or every promotion's. */
  readonly scope?: 'mine' | 'world';
  /** A stored show whose sheet opens straight away. */
  readonly show?: EventInstanceId;
}

/** The names of the calendar's search parameters. */
export const CALENDAR_PARAMS = { month: 'month', scope: 'scope', show: 'show' } as const;

/** The names of the results page's search parameters. */
export const SHOW_RESULTS_PARAMS = { reveal: 'reveal' } as const;

/** What a link into Finances can ask for: the tab, and for the Ledger its month and category. */
export interface FinancesLinkOptions {
  /** `overview` (the default), `monthly`, `ledger`, `policies`, or a tab another feature added. */
  readonly tab?: string;
  /** The Ledger's month filter, as `YYYY-MM`. */
  readonly month?: string;
  /** The Ledger's category filter: a ledger category key such as `wages`. */
  readonly category?: string;
}

/** The names of the Finances screen's search parameters. */
export const FINANCES_PARAMS = { tab: 'tab', month: 'month', category: 'category' } as const;

/** Path builders for every route. */
export const routes = {
  /** The title screen. */
  title: (): string => '/',
  load: (): string => '/load',
  newGame: (): string => '/new',
  settings: (): string => '/settings',
  game: {
    /** `/game` itself, which redirects to the office. */
    root: (): string => GAME_ROOT,
    office: (): string => gameScreenPath('office'),
    inbox: (): string => gameScreenPath('inbox'),
    news: (): string => gameScreenPath('news'),
    workers: (): string => gameScreenPath('workers'),
    promotions: (): string => gameScreenPath('promotions'),
    eventHistory: (): string => gameScreenPath('eventHistory'),
    roster: (): string => gameScreenPath('roster'),
    calendar: (): string => gameScreenPath('calendar'),
    /**
     * The calendar on a chosen month, scope or show: `/game/calendar?month=2027-01&show=evi_…`.
     * With no options it is the same URL as `calendar()`.
     */
    calendarAt: (options: CalendarLinkOptions = {}): string => {
      const search = new URLSearchParams();
      if (options.month !== undefined) search.set(CALENDAR_PARAMS.month, options.month);
      if (options.scope !== undefined) search.set(CALENDAR_PARAMS.scope, options.scope);
      if (options.show !== undefined) search.set(CALENDAR_PARAMS.show, options.show);
      const query = search.toString();
      return query === '' ? gameScreenPath('calendar') : `${gameScreenPath('calendar')}?${query}`;
    },
    booking: (): string => gameScreenPath('booking'),
    titles: (): string => gameScreenPath('titles'),
    storylines: (): string => gameScreenPath('storylines'),
    teams: (): string => gameScreenPath('teams'),
    tournaments: (): string => gameScreenPath('tournaments'),
    brands: (): string => gameScreenPath('brands'),
    /**
     * Business > Finances, optionally on a tab and, for the Ledger, a month and category:
     * `/game/finances?tab=ledger&month=2027-01&category=wages`. With no options it is the bare path.
     */
    finances: (options: FinancesLinkOptions = {}): string => {
      const search = new URLSearchParams();
      if (options.tab !== undefined) search.set(FINANCES_PARAMS.tab, options.tab);
      if (options.month !== undefined) search.set(FINANCES_PARAMS.month, options.month);
      if (options.category !== undefined) search.set(FINANCES_PARAMS.category, options.category);
      const query = search.toString();
      return query === '' ? gameScreenPath('finances') : `${gameScreenPath('finances')}?${query}`;
    },
    contracts: (): string => gameScreenPath('contracts'),
    networks: (): string => gameScreenPath('networks'),
    production: (): string => gameScreenPath('production'),
    /** The Match lab: rate a hypothetical segment before booking it. */
    matchLab: (): string => gameScreenPath('matchLab'),
    /** One worker's profile. */
    worker: (personId: PersonId): string =>
      `${gameScreenPath('workers')}/${encodeURIComponent(personId)}`,
    /**
     * One show's results page, under Event history. `reveal` plays the segments in one at a time,
     * the way the Next Day summary opens it: `/game/event-history/evi_…?reveal=1`.
     */
    showResults: (
      eventInstanceId: EventInstanceId,
      options: { readonly reveal?: boolean } = {},
    ): string => {
      const path = `${gameScreenPath('eventHistory')}/${encodeURIComponent(eventInstanceId)}`;
      return options.reveal === true ? `${path}?${SHOW_RESULTS_PARAMS.reveal}=1` : path;
    },
  },
  dev: {
    /** The component gallery: in every build, linked from no navigation. */
    gallery: (): string => '/dev/gallery',
    /** The bare page the gallery's phone frame loads: one entry, no gallery chrome. */
    galleryFrame: (): string => '/dev/gallery/frame',
    /** Dev and e2e builds only: fake a loaded world and open the shell. */
    enterShell: (options: { readonly promotion?: string } = {}): string =>
      options.promotion === undefined
        ? '/dev/enter-shell'
        : `/dev/enter-shell?promotion=${encodeURIComponent(options.promotion)}`,
  },
} as const;

/** Route path patterns the router registers, for routes whose builder takes arguments. */
export const routePatterns = {
  enterShell: '/dev/enter-shell',
  /** One worker's profile; `routes.game.worker(personId)` builds the URL. */
  worker: `${gameScreenPath('workers')}/:personId`,
  /** One show's results; `routes.game.showResults(eventInstanceId)` builds the URL. */
  showResults: `${gameScreenPath('eventHistory')}/:eventInstanceId`,
} as const;

/** The name of the worker profile route's parameter. */
export const WORKER_ROUTE_PARAM = 'personId';

/** The name of the results page route's parameter. */
export const SHOW_RESULTS_ROUTE_PARAM = 'eventInstanceId';
