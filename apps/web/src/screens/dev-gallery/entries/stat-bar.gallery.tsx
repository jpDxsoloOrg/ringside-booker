import { Stack } from '@/components/layout';
import { StatBar } from '@/components/StatBar';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

const SAMPLE_VALUES = [0, 37, 100] as const;

function StatBarDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>With label</h3>
        <div className={styles['statGrid']}>
          {SAMPLE_VALUES.map((value) => (
            <StatBar key={value} label={`Value ${String(value)}`} value={value} />
          ))}
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Label for screen readers only</h3>
        <div className={styles['statGrid']}>
          {SAMPLE_VALUES.map((value) => (
            <StatBar key={value} label={`Hidden label ${String(value)}`} value={value} hideLabel />
          ))}
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Other states</h3>
        <div className={styles['statGrid']}>
          <StatBar label="Over the top" value={120} />
          <StatBar label="With potential" value={55} ceiling={82} />
          <StatBar label="Recent gain" value={72} delta={6} ceiling={90} />
          <StatBar label="Recent loss" value={48} delta={-8} />
          <StatBar label="Out of 20" value={14} max={20} tone="info" />
          <StatBar label="Hidden value" value={64} showValue={false} tone="accent" />
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'stat-bar',
  title: 'StatBar',
  group: 'Primitives',
  notes: 'Auto tone: below 40 negative, below 70 warning, otherwise positive.',
  render: () => <StatBarDemo />,
};
