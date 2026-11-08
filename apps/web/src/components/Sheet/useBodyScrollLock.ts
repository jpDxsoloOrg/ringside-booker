import { useEffect } from 'react';

/**
 * Class on `<html>` that stops the page behind an overlay from scrolling. `global.css` styles it;
 * script only adds and removes the class, never an inline style.
 */
export const SCROLL_LOCK_CLASS = 'scroll-locked';

/** How many overlays currently hold the lock. The class stays while this is above zero. */
let activeLockCount = 0;

/**
 * Takes one hold on the page scroll lock and returns the function that gives it back. Holds are
 * counted, so a dialog opened from inside a sheet keeps the page locked when the dialog closes and
 * the sheet is still open. Releasing the same hold twice does nothing.
 */
export function acquireBodyScrollLock(): () => void {
  activeLockCount += 1;
  document.documentElement.classList.add(SCROLL_LOCK_CLASS);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeLockCount = Math.max(0, activeLockCount - 1);
    if (activeLockCount === 0) {
      document.documentElement.classList.remove(SCROLL_LOCK_CLASS);
    }
  };
}

/** How many holds are active. For tests and debugging. */
export function bodyScrollLockCount(): number {
  return activeLockCount;
}

/** Locks page scroll while `active` is true and the component is mounted. */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    return acquireBodyScrollLock();
  }, [active]);
}
