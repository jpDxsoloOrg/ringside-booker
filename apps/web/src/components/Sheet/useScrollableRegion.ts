import { useCallback, useRef, useState } from 'react';

/** True when `element`'s content is taller than its box, so it scrolls. */
function overflows(element: HTMLElement): boolean {
  return element.scrollHeight > element.clientHeight + 1;
}

/**
 * Watches a scrolling box and says whether its content overflows it right now, for a box that
 * must then be reachable by keyboard (axe `scrollable-region-focusable`): a keyboard or switch user
 * can only scroll a box that holds a control or takes focus itself. Rechecks when the box resizes
 * or its content changes (a section that loads after the sheet opens). Pass the returned callback
 * as the box's `ref`.
 */
export function useScrollableRegion(): readonly [(node: HTMLElement | null) => void, boolean] {
  const [scrollable, setScrollable] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);
  const ref = useCallback((node: HTMLElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (node === null) return;
    const check = (): void => {
      setScrollable(overflows(node));
    };
    check();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    resize?.observe(node);
    const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(check);
    mutation?.observe(node, { childList: true, subtree: true, characterData: true });
    cleanup.current = () => {
      resize?.disconnect();
      mutation?.disconnect();
    };
  }, []);
  return [ref, scrollable] as const;
}
