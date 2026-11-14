import type { TraceNode } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { StoryShieldChip } from '@/components/StoryShieldChip';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

const shieldTrace: TraceNode = {
  kind: 'formula',
  label: 'Story shield',
  value: 100,
  unit: 'percent',
  children: [
    { kind: 'input', label: "Heat of 'Ashfall Rivalry'", value: 86, unit: 'points' },
    { kind: 'input', label: 'Hot from', value: 70, unit: 'points' },
  ],
};

function StoryShieldChipDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Hot story: full shield, with a Why?</h3>
        <StoryShieldChip percent={100} band="hot" finale={false} trace={shieldTrace} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Warm story</h3>
        <StoryShieldChip percent={50} band="warm" finale={false} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Warm story, lost in the finale</h3>
        <StoryShieldChip percent={25} band="warm" finale />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Cool story: no shield</h3>
        <StoryShieldChip percent={0} band="none" finale={false} />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'story-shield-chip',
  title: 'StoryShieldChip',
  group: 'Broadcast',
  notes:
    'How much a storyline covered a loss inside it: green when the story was hot, gold when warm, ' +
    'plain when it gave no shield. The results page passes the numbers in once WRK8 is wired ' +
    '(CRTV4-06).',
  render: () => <StoryShieldChipDemo />,
};
