import { ALIGNMENTS } from '@ringside/engine';
import { AlignmentChip } from '@/components/AlignmentChip';
import { Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

function AlignmentChipDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Soft (default)</h3>
        <div className={office['chipRow']}>
          {ALIGNMENTS.map((alignment) => (
            <AlignmentChip key={alignment} alignment={alignment} />
          ))}
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Solid</h3>
        <div className={office['chipRow']}>
          {ALIGNMENTS.map((alignment) => (
            <AlignmentChip key={alignment} alignment={alignment} variant="solid" />
          ))}
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Small, for rows and card subtitles</h3>
        <div className={office['chipRow']}>
          {ALIGNMENTS.map((alignment) => (
            <AlignmentChip key={alignment} alignment={alignment} size="sm" />
          ))}
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'alignment-chip',
  title: 'AlignmentChip',
  group: 'Office',
  notes:
    'Face is cyan (the cool side), heel is red-orange (the hot side), tweener is violet. The word is always on the chip.',
  render: () => <AlignmentChipDemo />,
};
