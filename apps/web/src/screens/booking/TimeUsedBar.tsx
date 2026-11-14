/**
 * EVT4-08: "Time used: 14 of 16", the card's time against the show's, as a bar with a Why? for
 * each number. Never minutes (D-10): the numbers are the show's own time units. Over the time, the
 * reason is said in visible text, not only in a tooltip.
 */
import type { BookingTimeView } from '@ringside/engine';
import { StatBar } from '@/components/StatBar';
import { WhyButton } from '@/components/Trace';
import styles from './Booking.module.css';

/** "14 of 16". */
export function timeUsedText(time: Pick<BookingTimeView, 'used' | 'budget'>): string {
  return `${String(time.used)} of ${String(time.budget)}`;
}

/** What the bar says under it: room left, a full show, or how far over it is and what to do. */
export function timeNoteText(time: Pick<BookingTimeView, 'used' | 'budget' | 'over'>): string {
  if (time.over > 0) {
    return `Over the show's time by ${String(time.over)}: shorten a match or drop a segment.`;
  }
  const spare = time.budget - time.used;
  if (spare === 0) return 'The show is full. Shorten a match to make another one longer.';
  return `Room for ${String(spare)} more. A longer match raises its star limit and what the crowd expects.`;
}

export interface TimeUsedBarProps {
  readonly time: BookingTimeView;
}

export function TimeUsedBar({ time }: TimeUsedBarProps) {
  const over = time.over > 0;
  return (
    <section className={styles['timeUsed']} aria-label="Show time">
      <div className={styles['timeUsedRow']}>
        <StatBar
          label="Time used"
          value={time.used}
          max={Math.max(time.budget, 1)}
          showValue={false}
          tone={over ? 'action' : 'data'}
          className={styles['timeUsedBar']}
        />
        <span className={styles['timeUsedValue']}>{timeUsedText(time)}</span>
        <WhyButton
          label="Time used"
          value={time.used}
          unit="count"
          panelTitle="Why the card uses this much time"
          source={{ trace: time.usedTrace }}
        />
        <WhyButton
          label="the show's time"
          value={time.budget}
          unit="count"
          panelTitle="Why the show has this much time"
          source={{ trace: time.budgetTrace }}
        />
      </div>
      <p
        className={styles['timeUsedNote']}
        data-over={over ? (time.extended ? 'error' : 'warning') : undefined}
      >
        {timeNoteText(time)}
      </p>
    </section>
  );
}
