import { routes } from '../routes';

/**
 * Settings is one route outside the game, opened from the title screen and from inside a game.
 * Links to it carry the page they came from in the location state, and the screen's back link
 * returns there: to the title screen, or to the game screen the player left.
 */
export interface SettingsLinkState {
  readonly from: string;
}

/** The location state for a link to Settings from `fromPath` (pathname plus any search). */
export function settingsLinkState(fromPath: string): SettingsLinkState {
  return { from: fromPath };
}

function isInAppPath(path: string): boolean {
  // One leading slash only: `//host` would be read as another site.
  return path.startsWith('/') && !path.startsWith('//');
}

/**
 * Where the settings back link goes: the `from` path in the location state when it is an in-app
 * path other than Settings itself, otherwise the title screen.
 */
export function settingsReturnPath(locationState: unknown): string {
  if (typeof locationState !== 'object' || locationState === null) return routes.title();
  if (!('from' in locationState)) return routes.title();
  const { from } = locationState;
  if (typeof from !== 'string' || !isInAppPath(from)) return routes.title();
  const fromPathname = from.split(/[?#]/)[0] ?? from;
  return fromPathname === routes.settings() ? routes.title() : from;
}

/** True when the back link leads into the game rather than to the title screen. */
export function returnsToGame(returnPath: string): boolean {
  const gameRoot = routes.game.root();
  return returnPath === gameRoot || returnPath.startsWith(`${gameRoot}/`);
}
