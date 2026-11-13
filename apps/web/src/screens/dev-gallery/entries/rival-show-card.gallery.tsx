import { Stack } from '@/components/layout';
import { RivalShowCard } from '@/screens/promotions/profile/shows/RivalShowCard';
import type { GalleryEntry } from '../galleryEntry';
import {
  galleryAiredShow,
  galleryCancelledShow,
  galleryHiddenShow,
  galleryOpenSlotShow,
  galleryTraceOf,
} from '../fixtures/rivalShowCards';
import styles from './entries.module.css';

function RivalShowCardDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>An aired show, opened</h3>
        <p className={styles['caption']}>
          A title main event, a storyline talking segment, a four-way and a draw, each slot with its
          Why?. The header's Why? explains the whole card.
        </p>
        <RivalShowCard row={galleryAiredShow} defaultExpanded traceOf={galleryTraceOf} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>A show still to air</h3>
        <RivalShowCard row={galleryHiddenShow} defaultExpanded traceOf={galleryTraceOf} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>A cancelled show</h3>
        <RivalShowCard row={galleryCancelledShow} defaultExpanded traceOf={galleryTraceOf} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>
          A booked card with an open slot, closed then opened
        </h3>
        <Stack gap={3}>
          <RivalShowCard row={galleryOpenSlotShow} traceOf={galleryTraceOf} />
          <RivalShowCard row={galleryOpenSlotShow} defaultExpanded traceOf={galleryTraceOf} />
        </Stack>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'rival-show-card',
  title: 'Rival show card',
  group: 'Broadcast',
  notes:
    'One show on a promotion’s Shows tab: a disclosure with the date, name, importance, brand and status, opening onto the card with a Why? on every filled slot. A card that has not aired says "Card is revealed when the show airs"; a cancelled show gives the reason. On a phone the header wraps to two lines and the sides stack.',
  render: () => <RivalShowCardDemo />,
};
