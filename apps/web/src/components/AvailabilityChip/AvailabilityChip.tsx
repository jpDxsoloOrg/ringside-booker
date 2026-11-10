import type { Availability, AvailabilityStatus } from '@ringside/engine';
import { Badge } from '../Badge';
import { classNames } from '../classNames';
import { formatGameDate } from '../format';
import { VisuallyHidden } from '../layout';
import type { RoleTone } from '../tone';
import { Tooltip } from '../Tooltip';
import styles from './AvailabilityChip.module.css';

/** The word on the chip for each status. The chip always shows it: colour is never alone. */
export const AVAILABILITY_LABELS: Readonly<Record<AvailabilityStatus, string>> = {
  available: 'Available',
  injured: 'Injured',
  rehab: 'In rehab',
  personalLeave: 'Personal leave',
  suspended: 'Suspended',
  timeOff: 'Time off',
  notDebuted: 'Not debuted',
  retired: 'Retired',
};

/**
 * The colour role for each status: green for someone who can work, red for an injury, gold for a
 * spell away that ends by itself, and plain for someone who is not in the business right now.
 */
export const AVAILABILITY_TONES: Readonly<Record<AvailabilityStatus, RoleTone>> = {
  available: 'positive',
  injured: 'negative',
  rehab: 'prestige',
  personalLeave: 'prestige',
  suspended: 'prestige',
  timeOff: 'prestige',
  notDebuted: 'neutral',
  retired: 'neutral',
};

/** "back Apr 14, 2026": when someone returns, or null when there is no known day. */
export function availabilityReturnText(until: Availability['until']): string | null {
  return until === null ? null : `back ${formatGameDate(until)}`;
}

export interface AvailabilityChipProps {
  /** What the engine's `availabilityOf` (or a query built on it) returned. */
  readonly availability: Pick<Availability, 'status' | 'reason' | 'until'>;
  readonly className?: string | undefined;
}

/**
 * Whether someone can work today, as a chip: the status in words and its colour, the first day
 * back when there is one, and the reason in a tooltip. The reason is also read out to screen
 * readers; a screen that must show it on a phone prints it beside the chip, since touch has no
 * hover.
 */
export function AvailabilityChip({ availability, className }: AvailabilityChipProps) {
  const { status, reason, until } = availability;
  const returnText = availabilityReturnText(until);
  return (
    <Tooltip content={reason}>
      {/* A button so the tooltip can be reached by keyboard and by touch; it does nothing else. */}
      <button
        type="button"
        className={classNames(styles['availabilityChip'], className)}
        data-status={status}
      >
        <Badge tone={AVAILABILITY_TONES[status]}>{AVAILABILITY_LABELS[status]}</Badge>
        {returnText !== null && <span className={styles['until']}>{returnText}</span>}
        {/* Read out too, unless it only repeats the word on the chip. */}
        {reason !== AVAILABILITY_LABELS[status] && <VisuallyHidden>{reason}</VisuallyHidden>}
      </button>
    </Tooltip>
  );
}
