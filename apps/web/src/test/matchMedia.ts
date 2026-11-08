/**
 * A controllable `window.matchMedia` for jsdom, which has none.
 *
 * Every query starts out not matching. A responsive component test calls `setMatchMedia` to decide
 * which queries match; lists that were already handed out update and fire their `change`
 * listeners, the same as a real browser does when the window is resized.
 */

/** Decides whether a media query matches, for example `(query) => query === '(width < 48rem)'`. */
export type MediaQueryMatcher = (query: string) => boolean;

type LegacyMediaQueryListener = Parameters<MediaQueryList['addListener']>[0];

const matchNothing: MediaQueryMatcher = () => false;

let currentMatcher: MediaQueryMatcher = matchNothing;
const issuedLists = new Set<FakeMediaQueryList>();

class FakeMediaQueryListEvent extends Event implements MediaQueryListEvent {
  readonly matches: boolean;
  readonly media: string;

  constructor(media: string, matches: boolean) {
    super('change');
    this.media = media;
    this.matches = matches;
  }
}

class FakeMediaQueryList extends EventTarget implements MediaQueryList {
  readonly media: string;
  onchange: MediaQueryList['onchange'] = null;
  private lastMatches: boolean;
  private readonly legacyListeners = new Set<NonNullable<LegacyMediaQueryListener>>();

  constructor(media: string) {
    super();
    this.media = media;
    this.lastMatches = currentMatcher(media);
  }

  get matches(): boolean {
    return currentMatcher(this.media);
  }

  /** Deprecated in browsers but still used by some libraries, so it is kept working. */
  addListener(listener: LegacyMediaQueryListener): void {
    if (listener !== null) this.legacyListeners.add(listener);
  }

  removeListener(listener: LegacyMediaQueryListener): void {
    if (listener !== null) this.legacyListeners.delete(listener);
  }

  /** Fires `change` if the current matcher flipped this query since the last notification. */
  notifyIfChanged(): void {
    const matchesNow = this.matches;
    if (matchesNow === this.lastMatches) return;
    this.lastMatches = matchesNow;

    const changeEvent = new FakeMediaQueryListEvent(this.media, matchesNow);
    this.dispatchEvent(changeEvent);
    this.onchange?.call(this, changeEvent);
    for (const listener of this.legacyListeners) listener.call(this, changeEvent);
  }
}

function fakeMatchMedia(query: string): MediaQueryList {
  const mediaQueryList = new FakeMediaQueryList(query);
  issuedLists.add(mediaQueryList);
  return mediaQueryList;
}

/** Sets which media queries match and notifies every list whose result changed. */
export function setMatchMedia(matcher: MediaQueryMatcher): void {
  currentMatcher = matcher;
  for (const mediaQueryList of issuedLists) mediaQueryList.notifyIfChanged();
}

/** Puts the stub on `window` with nothing matching. Called from the test setup file. */
export function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: fakeMatchMedia,
  });
}

/** Back to "nothing matches" and forgets lists from the previous test, without notifying them. */
export function resetMatchMedia(): void {
  currentMatcher = matchNothing;
  issuedLists.clear();
}
