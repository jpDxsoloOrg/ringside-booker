import { Stack } from '@/components/layout';
import { NeedsList } from '@/components/NeedsList';
import type { GalleryEntry } from '../galleryEntry';
import { galleryNeeds, galleryNoNeeds } from '../fixtures/rivalDesk';
import styles from './entries.module.css';

function NeedsListDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Three needs, most pressing first</h3>
        <NeedsList needs={galleryNeeds} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Nothing short</h3>
        <NeedsList needs={galleryNoNeeds} />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'needs-list',
  title: 'NeedsList',
  group: 'Office',
  notes:
    'What a rival desk says a roster is short of (aip.needs): the wrestlers its largest show calls for, then each need in words with a severity bar and its Why?. Rows stack on a phone.',
  render: () => <NeedsListDemo />,
};
