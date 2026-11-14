import { useId, useState } from 'react';
import type { BookingCard, BookingValidation } from '@ringside/engine';
import { BACK_TO_SHOW_LABEL, GO_LIVE_LABEL } from '@/app/AppShell/day/dayControlState';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import styles from './Booking.module.css';

/** "Fix 3 problems to run the show", "Fix 1 problem to run the show". */
export function fixProblemsText(errors: number): string {
  return `Fix ${String(errors)} ${errors === 1 ? 'problem' : 'problems'} to run the show`;
}

/** The engine's edit block while the show is part-way through (EVT10-01). */
export const SHOW_LIVE_BLOCK_CODE = 'showLive';

/** True while the card's show is part-way through: it can only be finished on show night. */
export function isShowUnderWay(card: BookingCard): boolean {
  return card.editBlock?.code === SHOW_LIVE_BLOCK_CODE;
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
  /**
   * True when the show goes live (the Show night setting is Live, EVT10-02): the button reads
   * **Go live** and `onRun` opens the show night screen instead of running it all at once.
   */
  readonly goesLive?: boolean;
}

/**
 * **Run the show** on the day of a show you run (EVT2-09), disabled until `booking.validate` finds
 * no errors (warnings never block). Under the Live setting it reads **Go live** and opens show
 * night (EVT10-02); while the show is part-way through, **Back to the show**. Nothing on any other
 * day: there is no lock, and a card stays editable until its show has run.
 */
export function RunShowButton({
  card,
  validation,
  busy,
  onRun,
  describedBy,
  goesLive = false,
}: RunShowButtonProps) {
  if (isShowUnderWay(card)) {
    return (
      <Button variant="primary" iconStart="live" onClick={onRun}>
        {BACK_TO_SHOW_LABEL}
      </Button>
    );
  }
  if (!card.runsTonight) return null;
  const runnable = validation?.runnable === true;
  return (
    <Button
      variant="primary"
      iconStart={goesLive ? 'live' : 'play'}
      loading={busy}
      disabled={!runnable}
      aria-describedby={runnable ? undefined : describedBy}
      onClick={onRun}
    >
      {goesLive ? GO_LIVE_LABEL : 'Run the show'}
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
