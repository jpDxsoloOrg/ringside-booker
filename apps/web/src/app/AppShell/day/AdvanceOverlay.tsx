import { useEffect, useId, useRef } from 'react';
import type { SyntheticEvent } from 'react';
import type { GameDate } from '@ringside/engine';
import { Button } from '@/components/Button';
import { formatGameDate, formatNumber } from '@/components/format';
import styles from './DayControl.module.css';

export interface AdvanceOverlayProps {
  /** Shows the overlay. The parent sets it while a skip of more than one day runs. */
  readonly open: boolean;
  /** The game date the skip has reached. */
  readonly currentDate: GameDate;
  /** Days simulated so far. */
  readonly daysDone: number;
  /** The most days the skip will run. */
  readonly daysRequested: number;
  /** True once Stop was pressed: the skip ends after the day it is on. */
  readonly stopping: boolean;
  readonly onStop: () => void;
}

/** "Day 3 of 30": the day being simulated, never past the last one. */
export function dayOfLabel(daysDone: number, daysRequested: number): string {
  const current = Math.min(daysDone + 1, daysRequested);
  return `Day ${formatNumber(current)} of ${formatNumber(daysRequested)}`;
}

/**
 * The progress of a multi-day skip: the date it has reached, "Day X of N", a progress bar and
 * Stop. It is a modal `<dialog>`, so the page behind can't be used while days move. Escape asks
 * to stop, like the button. A single day never shows it; the day button shows that it is busy.
 */
export function AdvanceOverlay({
  open,
  currentDate,
  daysDone,
  daysRequested,
  stopping,
  onStop,
}: AdvanceOverlayProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    // Escape: stop after today rather than hide a skip that is still running.
    event.preventDefault();
    if (!stopping) onStop();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles['overlay']}
      aria-labelledby={titleId}
      data-testid="advance-overlay"
      onCancel={handleCancel}
    >
      {open && (
        <div className={styles['overlayBody']}>
          <h2 id={titleId} className={styles['overlayTitle']}>
            Skipping days
          </h2>
          <p className={styles['overlayDate']}>{formatGameDate(currentDate, 'long')}</p>
          <p className={styles['overlayCount']}>{dayOfLabel(daysDone, daysRequested)}</p>
          <progress
            className={styles['progress']}
            value={daysDone}
            max={daysRequested}
            aria-label="Days simulated"
          />
          <Button
            variant="secondary"
            size="lg"
            iconStart="stop"
            className={styles['stopButton']}
            disabled={stopping}
            onClick={onStop}
          >
            {stopping ? 'Stopping after today…' : 'Stop'}
          </Button>
        </div>
      )}
    </dialog>
  );
}
