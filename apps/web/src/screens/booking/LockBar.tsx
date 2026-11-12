import { useId, useState } from 'react';
import type { BookingCard, BookingValidation } from '@ringside/engine';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import styles from './Booking.module.css';

/** "Fix 3 problems to lock", "Fix 1 problem to lock". */
export function fixProblemsText(errors: number): string {
  return `Fix ${String(errors)} ${errors === 1 ? 'problem' : 'problems'} to lock`;
}

/** How many segments are on the card, both sections. */
export function segmentCountOf(card: BookingCard): number {
  return card.sections.reduce(
    (count, section) => count + section.slots.filter((slot) => slot.segment !== null).length,
    0,
  );
}

/** True when the only thing stopping changes is the lock itself, so the card can be unlocked. */
export function canUnlock(card: BookingCard): boolean {
  return card.locked && card.editBlock?.code === 'cardLocked';
}

export interface LockButtonProps {
  readonly card: BookingCard;
  /** Null while the checks run: Lock waits for them. */
  readonly validation: BookingValidation | null;
  readonly busy: boolean;
  readonly onLock: () => void;
  readonly onUnlock: () => void;
  /** Ids of the text that explains a disabled Lock. */
  readonly describedBy?: string;
}

/**
 * **Lock card** while the card is open (disabled until `booking.validate` says it can run),
 * **Unlock card** once it is locked. Nothing for a show that has run or gone past.
 */
export function LockButton({
  card,
  validation,
  busy,
  onLock,
  onUnlock,
  describedBy,
}: LockButtonProps) {
  if (card.locked) {
    if (!canUnlock(card)) return null;
    return (
      <Button iconStart="unlock" loading={busy} onClick={onUnlock}>
        Unlock card
      </Button>
    );
  }
  if (!card.canEdit) return null;
  const runnable = validation?.runnable === true;
  return (
    <Button
      variant="primary"
      iconStart="lock"
      loading={busy}
      disabled={!runnable}
      aria-describedby={runnable ? undefined : describedBy}
      onClick={onLock}
    >
      Lock card
    </Button>
  );
}

export interface LockBarProps extends Omit<LockButtonProps, 'describedBy'> {
  /** Resolves once cleared; rejects with the game's reason as the error's message. */
  readonly onClear: () => Promise<void>;
  /** Leaves Lock and Unlock out, for the phone, where they live in the sticky bar. */
  readonly hideLock?: boolean;
}

/** The card's own actions: Lock or Unlock, why Lock is off, and Clear card (asks first). */
export function LockBar({ hideLock = false, onClear, ...lock }: LockBarProps) {
  const hintId = useId();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const { card, validation } = lock;
  const errors = validation?.errors.length ?? 0;
  const showHint = !hideLock && !card.locked && card.canEdit && validation !== null && errors > 0;
  const canClear = card.canEdit && segmentCountOf(card) > 0;

  return (
    <div className={styles['lockBar']}>
      {!hideLock && <LockButton {...lock} describedBy={hintId} />}
      {showHint && (
        <p id={hintId} className={styles['lockHint']}>
          {fixProblemsText(errors)}
        </p>
      )}
      {canClear && (
        <>
          <Button
            variant="ghost"
            iconStart="trash"
            onClick={() => {
              setConfirmingClear(true);
            }}
          >
            Clear card
          </Button>
          <ConfirmDialog
            open={confirmingClear}
            onClose={() => {
              setConfirmingClear(false);
            }}
            onConfirm={onClear}
            tone="danger"
            title={`Clear the card for ${card.show.name}?`}
            body="Every segment comes off the card and every slot is open again."
            confirmLabel="Clear card"
            cancelLabel="Keep card"
          />
        </>
      )}
    </div>
  );
}
