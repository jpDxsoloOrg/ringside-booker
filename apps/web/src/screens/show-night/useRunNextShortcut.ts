import { useEffect, useRef } from 'react';
import { isDialogOpen, isTextEntryTarget } from '@/app/AppShell/day/useDayShortcut';

/** Elements that do something of their own with Enter: the shortcut leaves them alone. */
const OWN_ENTER =
  'a[href], button, summary, select, textarea, input, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [contenteditable]';

/** The parts of a keyboard event the guard reads. */
export type RunNextKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat' | 'target' | 'defaultPrevented'
>;

/**
 * Whether a key press runs the next segment: Enter with no modifier, not held down, not already
 * handled, not on a control that answers Enter itself (focus on Run next segment presses it as
 * any button does), and with no dialog open.
 */
export function shouldRunNextOnKey(event: RunNextKeyEvent, root: ParentNode = document): boolean {
  if (event.key !== 'Enter' || event.defaultPrevented || event.repeat) return false;
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (isTextEntryTarget(event.target)) return false;
  if (event.target instanceof Element && event.target.closest(OWN_ENTER) !== null) return false;
  return !isDialogOpen(root);
}

/** Runs `onRunNext` when the player presses Enter on the show night screen. */
export function useRunNextShortcut(onRunNext: () => void, enabled: boolean): void {
  const latest = useRef(onRunNext);
  useEffect(() => {
    latest.current = onRunNext;
  }, [onRunNext]);

  useEffect(() => {
    if (!enabled) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!shouldRunNextOnKey(event)) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled]);
}
