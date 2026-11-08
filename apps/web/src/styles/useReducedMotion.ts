import { useSyncExternalStore } from 'react';

/** The OS-level setting, as a media query. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * The attribute on `<html>` that overrides the OS setting: `on` forces reduced motion, `off`
 * turns motion back on. global.css reads the same attribute, so script and CSS always agree.
 */
export const REDUCED_MOTION_ATTRIBUTE = 'data-reduced-motion';

type Unsubscribe = () => void;

function getRoot(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement;
}

function getMediaQueryList(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

/** Whether motion should be reduced right now: the `<html>` setting first, then the OS. */
export function prefersReducedMotion(): boolean {
  const setting = getRoot()?.getAttribute(REDUCED_MOTION_ATTRIBUTE);
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return getMediaQueryList()?.matches ?? false;
}

function subscribe(onChange: () => void): Unsubscribe {
  const mediaQueryList = getMediaQueryList();
  mediaQueryList?.addEventListener('change', onChange);

  const root = getRoot();
  const observer =
    root !== null && typeof MutationObserver === 'function' ? new MutationObserver(onChange) : null;
  if (root !== null && observer !== null) {
    observer.observe(root, { attributes: true, attributeFilter: [REDUCED_MOTION_ATTRIBUTE] });
  }

  return () => {
    mediaQueryList?.removeEventListener('change', onChange);
    observer?.disconnect();
  };
}

/** Without a document (server rendering, a Node test) motion is left on. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * True when the player wants less motion, from the OS or the in-game setting, kept current as
 * either changes.
 *
 * Use it only where the DOM itself differs, such as a ticker that becomes a static list. A
 * transition or a pulse needs no script: the `--motion-*` tokens are already 0ms under reduced
 * motion, and a looping animation adds its own `prefers-reduced-motion` rule in CSS.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, getServerSnapshot);
}
