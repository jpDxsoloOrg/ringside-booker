import { useEffect, useLayoutEffect, useRef } from 'react';
import { NavigationType, useLocation, useNavigationType } from 'react-router-dom';
import { MAIN_CONTENT_ID } from './SkipLink';

/** Screens mark their page heading with this attribute (and `tabIndex={-1}`) for RouteFocus. */
export const ROUTE_HEADING_ATTRIBUTE = 'data-route-heading';

interface ScrollPosition {
  readonly window: number;
  readonly main: number;
}

/** Where a page with no saved position starts. */
const TOP: ScrollPosition = { window: 0, main: 0 };

function mainElement(): HTMLElement | null {
  return document.getElementById(MAIN_CONTENT_ID);
}

function readScroll(): ScrollPosition {
  return { window: window.scrollY, main: mainElement()?.scrollTop ?? 0 };
}

function applyScroll(position: ScrollPosition): void {
  // The shell scrolls its main area on desktop and the window on phones, so both are set.
  window.scrollTo({ top: position.window, left: 0 });
  const main = mainElement();
  if (main !== null) main.scrollTop = position.main;
}

/** The page heading to focus after a navigation, or the main content area when there is none. */
export function routeFocusTarget(): HTMLElement | null {
  const main = mainElement();
  const heading =
    (main ?? document).querySelector<HTMLElement>(`[${ROUTE_HEADING_ATTRIBUTE}]`) ??
    document.querySelector<HTMLElement>(`[${ROUTE_HEADING_ATTRIBUTE}]`);
  return heading ?? main;
}

/**
 * Accessibility and scroll handling for client-side navigation, mounted once at the root.
 *
 * - After a navigation (never on the first load or a redirect during it, so the page does not
 *   jump past the skip link), focus moves to the new screen's heading, or to the main area if it
 *   has none. A screen reader
 *   then reads the new page, and the next Tab starts from the content.
 * - A new page starts scrolled to the top; back and forward restore where that page was left,
 *   remembered per history entry.
 */
export function RouteFocus() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const pagePath = `${location.pathname}${location.search}`;
  const previousRef = useRef<ShownPage | null>(null);
  const currentKeyRef = useRef(location.key);
  const savedScrollRef = useRef(new Map<string, ScrollPosition>());
  // Redirects while the app starts (/game to /game/office, a guard to the title screen) replace
  // the location before the player has done anything; they are still part of the page load.
  const playerHasNavigatedRef = useRef(false);

  // Remember the scroll position of the page being shown, for when the player comes back to it.
  useEffect(() => {
    const remember = () => {
      savedScrollRef.current.set(currentKeyRef.current, readScroll());
    };
    // Capture so scrolls of the main area (which do not bubble) are seen too.
    document.addEventListener('scroll', remember, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', remember, { capture: true });
    };
  }, []);

  // Scroll before paint, so the new page never flashes at the old position.
  useLayoutEffect(() => {
    const isNewPage = isPageChange(previousRef.current, location.key, pagePath);
    currentKeyRef.current = location.key;
    if (!isNewPage) return;
    const saved = savedScrollRef.current.get(location.key);
    applyScroll(navigationType === NavigationType.Pop && saved !== undefined ? saved : TOP);
  }, [location.key, pagePath, navigationType]);

  useEffect(() => {
    const isNewPage = isPageChange(previousRef.current, location.key, pagePath);
    previousRef.current = { key: location.key, path: pagePath };
    if (!isNewPage) return;
    if (navigationType !== NavigationType.Replace) playerHasNavigatedRef.current = true;
    if (!playerHasNavigatedRef.current) return;
    routeFocusTarget()?.focus({ preventScroll: true });
  }, [location.key, pagePath, navigationType]);

  return null;
}

/** The history entry on screen, and its path without the hash. */
interface ShownPage {
  readonly key: string;
  readonly path: string;
}

/**
 * Whether the location moved to another page. Not on the first render (the page load, where
 * focus stays where the browser put it) and not when only the hash changed (an in-page link,
 * which the browser scrolls to itself).
 */
function isPageChange(previous: ShownPage | null, key: string, path: string): boolean {
  return previous !== null && previous.key !== key && previous.path !== path;
}
