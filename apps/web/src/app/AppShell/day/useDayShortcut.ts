import { useEffect, useRef } from 'react';

/** The day control's shortcut, as `aria-keyshortcuts` writes it. */
export const DAY_SHORTCUT = 'Shift+N';

/** The input types that take typed text, where Shift+N is a capital N and nothing else. */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** True when `target` is somewhere the player types: a text input, a text area, a select or editable content. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return target.closest('[contenteditable=""], [contenteditable="true"]') !== null;
}

/** True when a modal or sheet is open, so the page behind it must not react to keys. */
export function isDialogOpen(root: ParentNode = document): boolean {
  return (
    root.querySelector(
      'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]',
    ) !== null
  );
}

/** The parts of a keyboard event the guard reads. */
export type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat' | 'target'
>;

/**
 * Whether a key press is the day shortcut and may run: Shift+N with no other modifier, not held
 * down, not typed into a text field, and with no dialog open.
 */
export function shouldHandleDayShortcut(
  event: ShortcutKeyEvent,
  root: ParentNode = document,
): boolean {
  const isN = event.code === 'KeyN' || event.key === 'N' || event.key === 'n';
  if (!isN || !event.shiftKey) return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return false;
  if (isTextEntryTarget(event.target)) return false;
  return !isDialogOpen(root);
}

/**
 * Runs `onShortcut` when the player presses Shift+N (see {@link shouldHandleDayShortcut}).
 * Listens only while `enabled`.
 */
export function useDayShortcut(onShortcut: () => void, enabled: boolean): void {
  const latest = useRef(onShortcut);
  useEffect(() => {
    latest.current = onShortcut;
  }, [onShortcut]);

  useEffect(() => {
    if (!enabled) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!shouldHandleDayShortcut(event)) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled]);
}
