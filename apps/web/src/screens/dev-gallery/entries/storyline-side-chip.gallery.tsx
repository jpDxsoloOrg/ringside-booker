import { STORYLINE_SIDES } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { StorylineSideChip } from '@/components/StorylineSideChip';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

function StorylineSideChipDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Small (default), beside a name</h3>
        <div className={office['chipRow']}>
          {STORYLINE_SIDES.map((side) => (
            <StorylineSideChip key={side} side={side} />
          ))}
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Medium</h3>
        <div className={office['chipRow']}>
          {STORYLINE_SIDES.map((side) => (
            <StorylineSideChip key={side} side={side} size="md" />
          ))}
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'storyline-side-chip',
  title: 'StorylineSideChip',
  group: 'Office',
  notes:
    "Someone's side in one storyline, not their overall alignment: face cyan and heel red-orange " +
    'as on AlignmentChip, neutral a quiet grey. The word is always on the chip.',
  render: () => <StorylineSideChipDemo />,
};
