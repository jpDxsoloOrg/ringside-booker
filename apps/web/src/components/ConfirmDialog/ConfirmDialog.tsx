import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../Button';
import { useBodyScrollLock, useOverlayFocus } from '../Sheet';
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

function actionButton(content: HTMLElement | null, action: InitialFocusTarget): HTMLElement | null {
  return content?.querySelector<HTMLElement>(`[data-confirm-action="${action}"]`) ?? null;
}

/**
 * A small centred dialog that asks before an action happens. It is a modal Radix dialog with the
 * `alertdialog` role, so it traps focus, closes on Escape, and returns focus to whatever opened
 * it. A click outside does nothing: a confirmation is a decision, and a stray click should not
 * count as one. It can open on top of a `Sheet`; the page stays scroll-locked until both have
 * closed.
 *
 * Nothing is rendered while it is closed.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
}: ConfirmDialogProps) {
  const initialFocus: InitialFocusTarget = tone === 'danger' ? 'cancel' : 'confirm';
  const focusHandlers = useOverlayFocus(open, (content) => actionButton(content, initialFocus));
  // Read by the Escape handler: while the action runs the dialog cannot be dismissed.
  const isPendingRef = useRef(false);
  useBodyScrollLock(open);

  useLayoutEffect(() => {
    if (open) isPendingRef.current = false;
  }, [open]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles['overlay']} />
        <Dialog.Content
          role="alertdialog"
          className={styles['dialog']}
          data-tone={tone}
          {...focusHandlers}
          onInteractOutside={(event) => {
            event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (isPendingRef.current) event.preventDefault();
          }}
        >
          <ConfirmBody
            onClose={onClose}
            onConfirm={onConfirm}
            title={title}
            body={body}
            confirmLabel={confirmLabel}
            cancelLabel={cancelLabel}
            tone={tone}
            initialFocus={initialFocus}
            onPendingChange={(isPending) => {
              isPendingRef.current = isPending;
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ConfirmBodyProps {
  readonly onClose: () => void;
  readonly onConfirm: () => Promise<void> | void;
  readonly title: ReactNode;
  readonly body: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly tone: ConfirmDialogTone;
  readonly initialFocus: InitialFocusTarget;
  readonly onPendingChange: (isPending: boolean) => void;
}

/** What is inside the dialog. Radix mounts it only while open, so each opening starts clean. */
function ConfirmBody({
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel,
  tone,
  initialFocus,
  onPendingChange,
}: ConfirmBodyProps) {
  const actionsRef = useRef<HTMLDivElement>(null);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // After a failure the buttons are enabled again; put focus back where it started.
  useEffect(() => {
    if (errorMessage !== null) actionButton(actionsRef.current, initialFocus)?.focus();
  }, [errorMessage, initialFocus]);

  const updatePending = (nextPending: boolean) => {
    setIsPending(nextPending);
    onPendingChange(nextPending);
  };

  const handleConfirm = async () => {
    if (isPending) return;
    updatePending(true);
    setErrorMessage(null);
    try {
      await onConfirm();
    } catch (error: unknown) {
      setErrorMessage(errorMessageFrom(error));
      updatePending(false);
      return;
    }
    onClose();
  };

  return (
    <>
      <div className={styles['content']}>
        <Dialog.Title className={styles['title']}>{title}</Dialog.Title>
        <Dialog.Description asChild>
          <div className={styles['body']}>{body}</div>
        </Dialog.Description>
        {errorMessage !== null && (
          <p role="alert" className={styles['error']}>
            {errorMessage}
          </p>
        )}
      </div>
      <div ref={actionsRef} className={styles['actions']}>
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
    </>
  );
}
