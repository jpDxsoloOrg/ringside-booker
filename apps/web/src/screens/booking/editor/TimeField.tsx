/**
 * EVT4-08: the segment's time, Short / Standard / Long, never minutes (D-10). It starts at the
 * slot's usual time; a longer one takes more of the show's time, raises the star limit and what the
 * crowd expects, and asks more stamina of the workers. The main event always runs long.
 */
import { DURATION_CLASS_LABELS, DURATION_CLASSES } from '@ringside/engine';
import type { BookingSlotView, DurationClass } from '@ringside/engine';
import { RadioGroup } from '@/components/RadioGroup';
import styles from './SegmentEditor.module.css';

/** What each choice does, said beside it. */
export const TIME_HINTS: Readonly<Record<DurationClass, string>> = {
  short: 'Takes the least time. Lower star limit; the crowd expects less.',
  standard: 'A full match or segment.',
  long: 'Takes the most time. Highest star limit, but the crowd expects more and it is harder work.',
};

/** "Usual for the Midcard: Standard." */
export function usualTimeText(slot: Pick<BookingSlotView, 'roleLabel' | 'usualTime'>): string {
  return `Usual for the ${slot.roleLabel}: ${DURATION_CLASS_LABELS[slot.usualTime]}.`;
}

function isDurationClass(value: string): value is DurationClass {
  return DURATION_CLASSES.some((durationClass) => durationClass === value);
}

export interface TimeFieldProps {
  readonly slot: BookingSlotView;
  /** The draft's booked time, or undefined for the slot's usual time. */
  readonly value: DurationClass | undefined;
  readonly disabled: boolean;
  readonly onChange: (length: DurationClass) => void;
}

export function TimeField({ slot, value, disabled, onChange }: TimeFieldProps) {
  if (slot.timeLocked) {
    return <p className={styles['hint']}>Time: Long. The main event always runs long.</p>;
  }
  return (
    <div className={styles['field']}>
      <RadioGroup
        legend="Time"
        layout="row"
        options={DURATION_CLASSES.map((durationClass) => ({
          value: durationClass,
          label:
            durationClass === slot.usualTime
              ? `${DURATION_CLASS_LABELS[durationClass]} (usual)`
              : DURATION_CLASS_LABELS[durationClass],
          description: TIME_HINTS[durationClass],
        }))}
        value={value ?? slot.usualTime}
        disabled={disabled}
        onValueChange={(next) => {
          if (isDurationClass(next)) onChange(next);
        }}
      />
      <p className={styles['hint']}>
        {`${usualTimeText(slot)} The match type can still move it a step. It must fit the show's time.`}
      </p>
    </div>
  );
}
