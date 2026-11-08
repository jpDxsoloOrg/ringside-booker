import { Stack } from '@/components/layout';
import { Ticker } from '@/components/Ticker';
import type { GalleryEntry } from '../galleryEntry';
import { BROADCAST_HEADLINES } from '../broadcastFixtures';
import { ReducedMotionSwitch } from '../ReducedMotionSwitch';
import styles from './entries.module.css';

function TickerDemo() {
  return (
    <Stack gap={5}>
      <ReducedMotionSwitch />
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>News crawl</h3>
        <Ticker label="Breaking" items={BROADCAST_HEADLINES} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Fast, one headline, announced politely</h3>
        <Ticker
          label="Live"
          ariaLabel="Show night ticker"
          announce="polite"
          speed="fast"
          items={[{ id: 'segment', content: 'Main event is next' }]}
        />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Docked</h3>
        <p className={styles['caption']}>
          Sticks to the bottom edge, and above the bottom tab bar on phones.
        </p>
        <Ticker label="Breaking" ariaLabel="Docked ticker" items={BROADCAST_HEADLINES} docked />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'ticker',
  title: 'Ticker',
  group: 'Broadcast',
  notes:
    'Pauses under the pointer, while focus is inside, and from the pause button. Turn on reduced motion to see the static list.',
  render: () => <TickerDemo />,
};
