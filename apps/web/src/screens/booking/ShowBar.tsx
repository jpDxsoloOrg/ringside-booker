import { useId, useState } from 'react';
import type { BookingCard, BookingValidation } from '@ringside/engine';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import styles from './Booking.module.css';

/** "Fix 3 problems to run the show", "Fix 1 problem to run the show". */
export function fixProblemsText(errors: number): string {
  return `Fix ${String(errors)} ${errors === 1 ? 'problem' : 'problems'} to run the show`;
}

/** How many segments are on the card, both sections. */
export function segmentCountOf(card: BookingCard): number {
  return card.sections.reduce(
    (count, section) => count + section.slots.filter((slot) => slot.segment !== null).length,
    0,
  );
}

export interface RunShowButtonProps {
  readonly card: BookingCard;
  /** Null while the checks run: Run the show waits for them. */
  readonly validation: BookingValidation | null;
  readonly busy: boolean;
  readonly onRun: () => void;
  /** Ids of the text that explains a disabled Run the show. */
  readonly describedBy?: string;
}

/**
 * **Run the show** on the day of a show you run (EVT2-09), disabled until `booking.validate` finds
 * no errors (warnings never block). Nothing on any other day: there is no lock, and a card stays
 * editable until its show has run.
 */
export function RunShowButton({ card, validation, busy, onRun, describedBy }: RunShowButtonProps) {
  if (!card.runsTonight) return null;
  const runnable = validation?.runnable === true;
  return (
    <Button
      variant="primary"
      iconStart="play"
      loading={busy}
      disabled={!runnable}
      aria-describedby={runnable ? undefined : describedBy}
      onClick={onRun}
    >
      Run the show
    </Button>
  );
}

export interface ShowBarProps extends Omit<RunShowButtonProps, 'describedBy'> {
  /** Resolves once cleared; rejects with the game's reason as the error's message. */
  readonly onClear: () => Promise<void>;
  /** Leaves Run the show out, for the phone, where it lives in the sticky bar. */
  readonly hideRun?: boolean;
}

/** The card's own actions: Run the show (tonight), why it is off, and Clear card (asks first). */
export function ShowBar({ hideRun = false, onClear, ...run }: ShowBarProps) {
  const hintId = useId();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const { card, validation } = run;
  const errors = validation?.errors.length ?? 0;
  const showHint = !hideRun && card.runsTonight && validation !== null && errors > 0;
  const canClear = card.canEdit && segmentCountOf(card) > 0;

  return (
    <div className={styles['showBar']}>
      {!hideRun && <RunShowButton {...run} describedBy={hintId} />}
      {showHint && (
        <p id={hintId} className={styles['runHint']}>
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
