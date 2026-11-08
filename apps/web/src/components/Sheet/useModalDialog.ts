import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useBodyScrollLock } from './useBodyScrollLock';

export interface ModalDialogOptions {
  /** The player asked to close: Escape, or a click on the backdrop when that is allowed. */
  readonly onRequestClose: () => void;
  /** Whether a click on the backdrop asks to close. */
  readonly closeOnBackdrop: boolean;
  /** The element to focus once the dialog is open. Null leaves the browser's choice. */
  readonly getInitialFocus: (dialog: HTMLDialogElement) => HTMLElement | null;
  /**
   * While false, Escape and the backdrop do nothing, for example while a confirm action is still
   * running. True by default.
   */
  readonly dismissible?: boolean;
}

/** Elements that take focus from the keyboard, for picking a dialog's first focus target. */
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

/**
 * Runs a native `<dialog>` as a modal for as long as the calling component is mounted.
 *
 * `showModal()` gives the focus trap, Escape and the top layer. On top of that this hook moves
 * focus to the chosen first element, turns Escape (`cancel`) into `onRequestClose` so the parent
 * stays in charge of `open`, closes on a backdrop click when asked, holds the page scroll lock, and
 * on unmount puts focus back on whatever had it before the dialog opened.
 */
export function useModalDialog(
  dialogRef: RefObject<HTMLDialogElement>,
  options: ModalDialogOptions,
): void {
  // The listeners read the latest options without re-running the open/close effect.
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  useBodyScrollLock(true);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    optionsRef.current.getInitialFocus(dialog)?.focus();

    const isDismissible = () => optionsRef.current.dismissible !== false;

    const handleCancel = (event: Event) => {
      if (event.target !== dialog) return;
      // The parent decides whether the dialog closes, by changing `open`.
      event.preventDefault();
      if (isDismissible()) optionsRef.current.onRequestClose();
    };

    // Browsers may close a modal themselves, for example after Escape is pressed twice in a row.
    const handleClose = (event: Event) => {
      if (event.target !== dialog || !dialog.isConnected) return;
      if (isDismissible()) {
        optionsRef.current.onRequestClose();
      } else {
        dialog.showModal();
      }
    };

    // Clicks on the backdrop target the dialog itself; its content fills the rest of the box.
    // Both ends of the click must be on the backdrop, so a text selection dragged out of the
    // dialog does not close it.
    let pressStartedOnBackdrop = false;
    const handlePointerDown = (event: PointerEvent) => {
      pressStartedOnBackdrop = event.target === dialog;
    };
    const handleClick = (event: MouseEvent) => {
      const isBackdropClick = pressStartedOnBackdrop && event.target === dialog;
      pressStartedOnBackdrop = false;
      if (isBackdropClick && optionsRef.current.closeOnBackdrop && isDismissible()) {
        optionsRef.current.onRequestClose();
      }
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('pointerdown', handlePointerDown);
    dialog.addEventListener('click', handleClick);

    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('pointerdown', handlePointerDown);
      dialog.removeEventListener('click', handleClick);
      if (dialog.open) dialog.close();
      if (opener?.isConnected === true) opener.focus();
    };
  }, [dialogRef]);
}
