import { useState } from 'react';
import { Button } from '@/components/Button';
import { Stack } from '@/components/layout';
import { SegmentedMeter } from '@/components/SegmentedMeter';
import type { GalleryEntry } from '../galleryEntry';
import { ReducedMotionSwitch } from '../ReducedMotionSwitch';
import styles from './entries.module.css';
import broadcast from './broadcast.module.css';

const STEP = 10;

function SegmentedMeterDemo() {
  const [fatigue, setFatigue] = useState(50);

  return (
    <Stack gap={5}>
      <ReducedMotionSwitch />
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Hype, heat and production</h3>
        <div className={broadcast['stage']}>
          <SegmentedMeter label="Broadcast hype" value={78} dangerLabel="Hot" valueText="78%" />
          <SegmentedMeter label="Storyline heat" value={64} dangerFrom={60} dangerLabel="Boiling" />
          <SegmentedMeter
            label="Production ceiling"
            value={82}
            segments={12}
            dangerFrom={100}
            valueText="82 max"
          />
          <SegmentedMeter label="Empty" value={0} />
          <SegmentedMeter label="Full" value={100} dangerLabel="Maxed" />
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Animated fill</h3>
        <div className={broadcast['stage']}>
          <SegmentedMeter label="Fatigue" value={fatigue} segments={8} dangerFrom={75} />
          <div className={broadcast['meterControls']}>
            <Button
              size="sm"
              onClick={() => {
                setFatigue((current) => Math.max(0, current - STEP));
              }}
            >
              Rest
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setFatigue((current) => Math.min(100, current + STEP));
              }}
            >
              Work a match
            </Button>
          </div>
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Label for screen readers only</h3>
        <div className={broadcast['stage']}>
          <SegmentedMeter label="Momentum" value={35} hideLabel />
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'segmented-meter',
  title: 'SegmentedMeter',
  group: 'Broadcast',
  notes:
    'Ticks fill cyan, then red-orange past the danger threshold (80% of max unless set), with a warning icon and a word so it is never colour alone.',
  render: () => <SegmentedMeterDemo />,
};
