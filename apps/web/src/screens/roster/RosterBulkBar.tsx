import { Button } from '@/components/Button';
import { classNames } from '@/components/classNames';
import { formatNumber } from '@/components/format';
import { SET_PUSH_LABEL } from './rosterColumns';
import { WAIT_FOR_DAY_TEXT } from './rosterRowActions';
import styles from './SetPush.module.css';

export interface RosterBulkBarProps {
  /** How many wrestlers are ticked; the bar shows only while this is above 0. */
  readonly count: number;
  /** Opens the Set push sheet for the ticked wrestlers. */
  readonly onSetPush: () => void;
  /** Unticks every row. */
  readonly onClear: () => void;
  /** True while days are advancing: Set push waits, and the bar says why. */
  readonly advancing: boolean;
  /**
   * `inline` above the table on desktop; `phone` sticks to the bottom of the screen above the tab
   * bar, with full-size tap targets.
   */
  readonly placement: 'inline' | 'phone';
}

/** "<N> selected" with Set push… and Clear, while any wrestler is ticked. */
export function RosterBulkBar({
  count,
  onSetPush,
  onClear,
  advancing,
  placement,
}: RosterBulkBarProps) {
  if (count === 0) return null;
  const phone = placement === 'phone';
  return (
    <div
      role="region"
      aria-label="Selected wrestlers"
      className={classNames(styles['bulkBar'], phone && styles['bulkBarPhone'])}
      data-placement={placement}
    >
      <p className={styles['bulkCount']}>
        <span>{`${formatNumber(count)} selected`}</span>
        {advancing && <span className={styles['bulkWait']}>{WAIT_FOR_DAY_TEXT}</span>}
      </p>
      <div className={styles['bulkActions']}>
        <Button
          size={phone ? 'md' : 'sm'}
          variant="primary"
          iconStart="roster"
          disabled={advancing}
          title={advancing ? WAIT_FOR_DAY_TEXT : undefined}
          onClick={onSetPush}
        >
          {SET_PUSH_LABEL}
        </Button>
        <Button size={phone ? 'md' : 'sm'} variant="ghost" onClick={onClear}>
          {phone ? 'Clear' : 'Clear selection'}
        </Button>
      </div>
    </div>
  );
}
