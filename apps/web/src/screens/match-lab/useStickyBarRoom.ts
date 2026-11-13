import { useEffect } from 'react';
import type { RefObject } from 'react';

/** The custom property, set on the bar's parent, that holds the room the sticky bar takes. */
export const STICKY_BAR_ROOM_PROPERTY = '--lab-run-bar-room';

/**
 * While `ref`'s bar sticks to the bottom of the screen (the Match lab's Run bar on phones), keeps
 * `--lab-run-bar-room` on the bar's parent equal to the space the bar and the tab bar under it
 * cover. The lab's other controls take it as their bottom scroll margin, so one that takes focus or
 * is scrolled into view lands above the bar instead of under it. On desktop the bar is not sticky
 * and the property is removed.
 *
 * The room is the lab's own, not the page's scroll padding: padding the page also counted the bar
 * as covering itself, so focusing Run or the Runs slider (or a test tapping them) scrolled the page
 * away from where the player was.
 */
export function useStickyBarRoom(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const bar = ref.current;
    const host = bar?.parentElement;
    if (bar === null || bar === undefined || host === null || host === undefined) return undefined;
    if (typeof window === 'undefined') return undefined;

    const update = (): void => {
      const style = window.getComputedStyle(bar);
      if (style.position !== 'sticky') {
        host.style.removeProperty(STICKY_BAR_ROOM_PROPERTY);
        return;
      }
      const offset = Number.parseFloat(style.bottom);
      const covered = bar.offsetHeight + (Number.isFinite(offset) ? offset : 0);
      host.style.setProperty(STICKY_BAR_ROOM_PROPERTY, `${String(Math.ceil(covered))}px`);
    };

    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(bar);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      host.style.removeProperty(STICKY_BAR_ROOM_PROPERTY);
    };
  }, [ref]);
}
