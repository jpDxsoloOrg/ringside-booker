import { useCallback, useLayoutEffect, useRef } from 'react';

/** Elements that take focus from the keyboard, for picking an overlay's first focus target. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** The first keyboard-focusable element inside `container` that is not hidden, or null. */
export function firstFocusableIn(container: Element | null): HTMLElement | null {
  if (container === null) return null;
  for (const candidate of Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))) {
    if (candidate.closest('[hidden], [inert]') === null) return candidate;
  }
  return null;
}

/** The handlers a Radix overlay content element takes for its open and close focus moves. */
export interface OverlayFocusHandlers {
  readonly onOpenAutoFocus: (event: Event) => void;
  readonly onCloseAutoFocus: (event: Event) => void;
}

/**
 * Where focus goes when a controlled Radix overlay opens and closes.
 *
 * Radix traps focus while the overlay is open, but it only hands focus back to its own `Trigger`
 * part. Our overlays are opened by whatever control the screen likes, so this hook remembers the
 * element that had focus when `open` turned true and focuses it again once the overlay has
 * closed, unless something else (a route change, say) has taken focus in the meantime.
 *
 * `getInitialFocus` picks the element to focus on open, given the overlay's content element; null
 * leaves the content itself focused.
 */
export function useOverlayFocus(
  open: boolean,
  getInitialFocus: (content: HTMLElement) => HTMLElement | null,
): OverlayFocusHandlers {
  const openerRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);
  const getInitialFocusRef = useRef(getInitialFocus);

  useLayoutEffect(() => {
    openRef.current = open;
    getInitialFocusRef.current = getInitialFocus;
  });

  // A layout effect runs before Radix moves focus into the content (in a passive effect), so the
  // opener is still the active element here. Only the first run per opening counts: StrictMode
  // re-runs effects after focus has already moved inside.
  useLayoutEffect(() => {
    if (!open || openerRef.current !== null) return;
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;
  }, [open]);

  const onOpenAutoFocus = useCallback((event: Event) => {
    const content = event.currentTarget;
    if (!(content instanceof HTMLElement)) return;
    const target = getInitialFocusRef.current(content);
    if (target === null) return;
    event.preventDefault();
    target.focus();
  }, []);

  const onCloseAutoFocus = useCallback((event: Event) => {
    // Radix would focus its own Trigger part, which these overlays do not use.
    event.preventDefault();
    // StrictMode unmounts and remounts the content once while it stays open; nothing to return.
    if (openRef.current) return;
    const opener = openerRef.current;
    openerRef.current = null;
    const active = document.activeElement;
    const focusIsFree = active === null || active === document.body;
    if (focusIsFree && opener?.isConnected === true) opener.focus();
  }, []);

  return { onOpenAutoFocus, onCloseAutoFocus };
}
