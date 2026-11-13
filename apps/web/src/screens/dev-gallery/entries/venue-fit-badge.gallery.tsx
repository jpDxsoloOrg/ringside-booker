import { VENUE_FITS } from '@ringside/engine';
import { Cluster, Stack } from '@/components/layout';
import { VenueFitBadge } from '@/components/VenueFitBadge';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

function VenueFitBadgeDemo() {
  return (
    <Stack gap={3}>
      <p className={styles['caption']}>
        How well a venue suits the expected crowd. The engine decides the fit; each label has its
        own icon, so colour is never the only signal.
      </p>
      <Cluster gap={2}>
        {VENUE_FITS.map((fit) => (
          <VenueFitBadge key={fit} fit={fit} />
        ))}
      </Cluster>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'venue-fit-badge',
  title: 'VenueFitBadge',
  group: 'Office',
  notes:
    'Likely sell-out (positive), Good fit (data) and Will look empty (negative), from boxOffice.forecast and boxOffice.venues.',
  render: () => <VenueFitBadgeDemo />,
};
