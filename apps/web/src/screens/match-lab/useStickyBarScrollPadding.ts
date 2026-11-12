import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * While `ref`'s bar sticks to the bottom of the screen (the Match lab's Run bar on phones), keeps
 * the page's bottom scroll padding equal to the space the bar and the tab bar under it cover. A
 * control that takes focus or is scrolled into view then lands above the bar instead of under it.
 * On desktop the bar is not sticky and the padding is left alone.
 */
export function useStickyBarScrollPadding(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const bar = ref.current;
    if (bar === null || typeof window === 'undefined') return undefined;
    const root = document.documentElement;
    const before = root.style.scrollPaddingBlockEnd;

    const update = (): void => {
      const style = window.getComputedStyle(bar);
      if (style.position !== 'sticky') {
        root.style.scrollPaddingBlockEnd = before;
        return;
      }
      const offset = Number.parseFloat(style.bottom);
      const covered = bar.offsetHeight + (Number.isFinite(offset) ? offset : 0);
      root.style.scrollPaddingBlockEnd = `${String(Math.ceil(covered))}px`;
    };

    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(bar);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      root.style.scrollPaddingBlockEnd = before;
    };
  }, [ref]);
}
