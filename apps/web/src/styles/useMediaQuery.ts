import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { BP_MOBILE_QUERY } from './breakpoints';

type Unsubscribe = () => void;

const doNothing: Unsubscribe = () => undefined;

/** Without a window (server rendering, a Node test) nothing matches. */
function getServerSnapshot(): boolean {
  return false;
}

function createMediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(query);
}

/**
 * Whether a media query matches, kept current as the window changes.
 *
 * Use it only where the DOM itself differs by layout; styling differences belong in CSS with
 * `@media (--bp-mobile)`. Returns false when there is no `matchMedia`.
 */
export function useMediaQuery(query: string): boolean {
  const mediaQueryList = useMemo(() => createMediaQueryList(query), [query]);

  const subscribe = useCallback(
    (onStoreChange: () => void): Unsubscribe => {
      if (mediaQueryList === null) return doNothing;
      mediaQueryList.addEventListener('change', onStoreChange);
      return () => {
        mediaQueryList.removeEventListener('change', onStoreChange);
      };
    },
    [mediaQueryList],
  );

  const getSnapshot = useCallback(() => mediaQueryList?.matches ?? false, [mediaQueryList]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** True below the one layout breakpoint (`--bp-mobile`). */
export function useIsMobile(): boolean {
  return useMediaQuery(BP_MOBILE_QUERY);
}
