import type { PersonId } from '@ringside/engine';

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
    booking: (): string => gameScreenPath('booking'),
    titles: (): string => gameScreenPath('titles'),
    storylines: (): string => gameScreenPath('storylines'),
    teams: (): string => gameScreenPath('teams'),
    tournaments: (): string => gameScreenPath('tournaments'),
    brands: (): string => gameScreenPath('brands'),
    finances: (): string => gameScreenPath('finances'),
    contracts: (): string => gameScreenPath('contracts'),
    networks: (): string => gameScreenPath('networks'),
    production: (): string => gameScreenPath('production'),
    /** One worker's profile. */
    worker: (personId: PersonId): string =>
      `${gameScreenPath('workers')}/${encodeURIComponent(personId)}`,
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
} as const;

/** The name of the worker profile route's parameter. */
export const WORKER_ROUTE_PARAM = 'personId';
