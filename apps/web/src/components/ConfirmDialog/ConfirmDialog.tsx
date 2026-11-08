import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../Button';
import { useModalDialog } from '../Sheet';
import styles from './ConfirmDialog.module.css';

/** `danger` for destructive or irreversible actions: a red confirm button and Cancel focused first. */
export type ConfirmDialogTone = 'default' | 'danger';

export interface ConfirmDialogProps {
  /** Whether the dialog is showing. The parent owns this and clears it in `onClose`. */
  readonly open: boolean;
  /** Cancel, Escape, or a confirm that finished. Set `open` to false here. */
  readonly onClose: () => void;
  /**
   * Does the action. While a returned promise is pending the confirm button shows a spinner and
   * the dialog cannot be dismissed. Resolving closes the dialog; rejecting keeps it open and shows
   * the error's message.
   */
  readonly onConfirm: () => Promise<void> | void;
  /** The question, such as "Release this worker?". */
  readonly title: ReactNode;
  /** What will happen, in a sentence or two. */
  readonly body: ReactNode;
  /** Names the action, such as "Release". Avoid a bare "OK". */
  readonly confirmLabel: string;
  /** `Cancel` by default. */
  readonly cancelLabel?: string;
  /** `default` by default. */
  readonly tone?: ConfirmDialogTone;
}

/** Shown when a rejected `onConfirm` gives no message of its own. */
export const CONFIRM_FALLBACK_ERROR = 'That did not work. Try again.';

type InitialFocusTarget = 'cancel' | 'confirm';

function errorMessageFrom(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  if (typeof error === 'string' && error.trim() !== '') return error;
  return CONFIRM_FALLBACK_ERROR;
}

function actionButton(
  dialog: HTMLDialogElement | null,
  action: InitialFocusTarget,
): HTMLElement | null {
  return dialog?.querySelector<HTMLElement>(`[data-confirm-action="${action}"]`) ?? null;
}

/**
 * A small centred dialog that asks before an action happens. Built on the native `<dialog>`, so it
 * traps focus, closes on Escape, and returns focus to whatever opened it. It can open on top of a
 * `Sheet`; the page stays scroll-locked until both have closed.
 *
 * Nothing is rendered while it is closed.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null;
  return <OpenConfirmDialog {...props} />;
}

function OpenConfirmDialog({
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const initialFocus: InitialFocusTarget = tone === 'danger' ? 'cancel' : 'confirm';

  useModalDialog(dialogRef, {
    onRequestClose: onClose,
    // A confirmation is a decision; a stray click outside should not count as one.
    closeOnBackdrop: false,
    dismissible: !isPending,
    getInitialFocus: (dialog) => actionButton(dialog, initialFocus),
  });

  // After a failure the buttons are enabled again; put focus back where it started.
  useEffect(() => {
    if (errorMessage !== null) actionButton(dialogRef.current, initialFocus)?.focus();
  }, [errorMessage, initialFocus]);

  const handleConfirm = async () => {
    if (isPending) return;
    setIsPending(true);
    setErrorMessage(null);
    try {
      await onConfirm();
    } catch (error: unknown) {
      setErrorMessage(errorMessageFrom(error));
      setIsPending(false);
      return;
    }
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className={styles['dialog']}
      data-tone={tone}
    >
      <div className={styles['content']}>
        <h2 id={titleId} className={styles['title']}>
          {title}
        </h2>
        <div id={bodyId} className={styles['body']}>
          {body}
        </div>
        {errorMessage !== null && (
          <p role="alert" className={styles['error']}>
            {errorMessage}
          </p>
        )}
      </div>
      <div className={styles['actions']}>
        <Button data-confirm-action="cancel" disabled={isPending} onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button
          data-confirm-action="confirm"
          variant={tone === 'danger' ? 'danger' : 'primary'}
          loading={isPending}
          onClick={() => {
            void handleConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
