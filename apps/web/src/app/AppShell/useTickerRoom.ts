import { useEffect } from 'react';

/** The custom property, set on the shell, that holds the height the docked phone ticker takes. */
export const TICKER_ROOM_PROPERTY = '--shell-ticker-room';

/**
 * While the ticker slot is fixed to the bottom of a phone screen, keeps `--shell-ticker-room` on
 * the shell equal to the slot's real height. It takes the element rather than a ref, so a shell
 * that remounts is measured afresh. The strip is usually one line, but with reduced
 * motion it grows to fit a wrapped headline (UI-34), and the content's bottom padding and the
 * screens' own sticky bars must clear all of it. On desktop the slot sits in the grid and the
 * property is removed, so the shell falls back to its fixed ticker height.
 */
export function useTickerRoom(slot: HTMLElement | null, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || slot === null || typeof window === 'undefined') return undefined;
    const shell = slot.parentElement;
    if (shell === null) return undefined;

    const update = (): void => {
      if (window.getComputedStyle(slot).position !== 'fixed') {
        shell.style.removeProperty(TICKER_ROOM_PROPERTY);
        return;
      }
      shell.style.setProperty(TICKER_ROOM_PROPERTY, `${String(Math.ceil(slot.offsetHeight))}px`);
    };

    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(slot);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      shell.style.removeProperty(TICKER_ROOM_PROPERTY);
    };
  }, [slot, enabled]);
}
