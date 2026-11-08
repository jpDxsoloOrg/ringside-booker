import { Cluster, Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

const CARD_SLOTS = ['Opener', 'Midcard', 'Midcard', 'Semi-main', 'Main event', 'Pre-show'];

function LayoutDemo() {
  return (
    <Stack gap={4}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Stack, gap 2</h3>
        <Stack gap={2}>
          <div className={styles['demoBox']}>One</div>
          <div className={styles['demoBox']}>Two</div>
          <div className={styles['demoBox']}>Three</div>
        </Stack>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Cluster, gap 3, wraps on narrow screens</h3>
        <Cluster gap={3}>
          {CARD_SLOTS.map((slot, index) => (
            <div key={`${slot}-${String(index)}`} className={styles['demoBox']}>
              {slot}
            </div>
          ))}
        </Cluster>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Cluster, justify between</h3>
        <Cluster gap={3} justify="between">
          <div className={styles['demoBox']}>Start</div>
          <div className={styles['demoBox']}>End</div>
        </Cluster>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'layout',
  title: 'Layout',
  group: 'Primitives',
  notes: 'Stack and Cluster take a --space-* step for their gap.',
  render: () => <LayoutDemo />,
};
