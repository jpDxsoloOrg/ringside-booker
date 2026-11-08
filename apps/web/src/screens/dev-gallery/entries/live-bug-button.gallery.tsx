import { useState } from 'react';
import { Stack } from '@/components/layout';
import { LiveBugButton } from '@/components/LiveBugButton';
import type { GalleryEntry } from '../galleryEntry';
import { ReducedMotionSwitch } from '../ReducedMotionSwitch';
import styles from './entries.module.css';
import broadcast from './broadcast.module.css';

function LiveBugButtonDemo() {
  const [day, setDay] = useState(14);

  return (
    <Stack gap={5}>
      <ReducedMotionSwitch />
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Next Day (md, top bar)</h3>
        <div className={broadcast['stage']}>
          <div className={broadcast['row']}>
            <LiveBugButton
              iconEnd="next-day"
              onClick={() => {
                setDay((current) => current + 1);
              }}
            >
              Next day
            </LiveBugButton>
            <p className={styles['caption']} aria-live="polite">
              {`Day ${String(day)}`}
            </p>
          </div>
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Go Live (lg, sidebar)</h3>
        <div className={broadcast['stage']}>
          <div className={broadcast['row']}>
            <LiveBugButton size="lg">Go live</LiveBugButton>
          </div>
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>States</h3>
        <div className={broadcast['stage']}>
          <div className={broadcast['row']}>
            <LiveBugButton live={false}>No dot</LiveBugButton>
            <LiveBugButton busy iconEnd="next-day">
              Advancing
            </LiveBugButton>
            <LiveBugButton disabled>Disabled</LiveBugButton>
          </div>
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'live-bug-button',
  title: 'LiveBugButton',
  group: 'Broadcast',
  notes:
    'Skewed bug with a straight label. The dot pulses once per --motion-pulse and holds still with reduced motion, while busy and when disabled.',
  render: () => <LiveBugButtonDemo />,
};
