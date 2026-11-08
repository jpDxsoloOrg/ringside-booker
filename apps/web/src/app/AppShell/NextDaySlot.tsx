import { useId } from 'react';
import { classNames } from '@/components/classNames';
import { LiveBugButton } from '@/components/LiveBugButton';
import styles from './AppShell.module.css';
import type { TopBarLayout } from './TopBar';

/**
 * The live Next Day bug at the end of the top bar, in its place and at its size on desktop and
 * phone. Moving time is not wired to it yet: the day control replaces this with the button that
 * advances the world, so until then it is marked unavailable and says so to screen readers.
 */
export function NextDaySlot({ compact }: TopBarLayout) {
  const hintId = useId();
  return (
    <>
      <LiveBugButton
        iconEnd="next-day"
        aria-disabled="true"
        shrinkable={compact}
        aria-describedby={hintId}
        className={classNames(styles['nextDay'], compact && styles['nextDayCompact'])}
        data-testid="next-day"
      >
        Next day
      </LiveBugButton>
      <span id={hintId} className={styles['visuallyHidden']}>
        Not available yet.
      </span>
    </>
  );
}
