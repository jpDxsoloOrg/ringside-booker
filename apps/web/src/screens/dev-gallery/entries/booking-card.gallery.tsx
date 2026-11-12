import { useState } from 'react';
import type { BookingSectionView, BookingSlotView } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { CardBoard } from '@/screens/booking/CardBoard';
import { issuesBySlot } from '@/screens/booking/cardSlotProps';
import type { GalleryEntry } from '../galleryEntry';
import {
  GALLERY_DRAW,
  galleryCard,
  galleryIssue,
  galleryMatch,
  galleryWin,
} from '../fixtures/booking';
import styles from './entries.module.css';

const PARTLY_FILLED = galleryCard([
  galleryMatch('Singles', 0, 2, galleryWin(0)),
  null,
  galleryMatch('Singles', 2, 2, null),
]);

const PARTLY_FILLED_ISSUES = issuesBySlot(
  [
    galleryIssue(
      'results',
      'error',
      'Slot 3: no result planned; pick a winner, a draw or a no contest',
      2,
    ),
    galleryIssue('mainEvent', 'error', 'The main event (Slot 6) is empty', 5),
  ],
  [galleryIssue('available', 'warning', 'Kai Moreno works for Altura Overclock', 0)],
);

const FULL = galleryCard(
  [
    galleryMatch('Singles', 0, 2, galleryWin(1)),
    galleryMatch('Singles', 2, 2, GALLERY_DRAW),
    galleryMatch('Singles', 4, 2, galleryWin(0)),
    galleryMatch('Singles', 6, 2, galleryWin(1)),
    galleryMatch('Singles', 8, 2, galleryWin(0)),
    galleryMatch('Singles', 10, 2, galleryWin(0), 'Coastal Crown'),
  ],
  galleryMatch('Singles', 12, 2, galleryWin(1)),
);

const MULTI_SIDE = galleryCard([
  galleryMatch('Triple Threat', 0, 3, galleryWin(2)),
  galleryMatch('Four-Way', 3, 4, null),
  null,
  null,
  null,
  galleryMatch('Singles', 7, 2, galleryWin(0)),
]);

/** Swaps two slots' segments, the way the engine's move does, so the drag can be tried here. */
function swapped(
  sections: readonly BookingSectionView[],
  from: BookingSlotView,
  to: BookingSlotView,
): BookingSectionView[] {
  return sections.map((section) =>
    section.preShow !== from.preShow
      ? section
      : {
          ...section,
          slots: section.slots.map((slot) => {
            if (slot.slot === from.slot) return { ...slot, segment: to.segment };
            if (slot.slot === to.slot) return { ...slot, segment: from.segment };
            return slot;
          }),
        },
  );
}

function DraggableBoard() {
  const [sections, setSections] = useState<readonly BookingSectionView[]>(FULL);
  return (
    <CardBoard
      rowIdPrefix="gallery-board-1"
      sections={sections}
      canReorder
      onMove={(from, to) => {
        setSections((current) => swapped(current, from, to));
      }}
    />
  );
}

function BookingCardDemo() {
  return (
    <Stack gap={6}>
      <p className={styles['subheading']}>Empty</p>
      <CardBoard rowIdPrefix="gallery-board-2" sections={galleryCard([])} onAdd={() => undefined} />
      <p className={styles['subheading']}>Partly filled, with problems</p>
      <CardBoard
        rowIdPrefix="gallery-board-3"
        sections={PARTLY_FILLED}
        issues={PARTLY_FILLED_ISSUES}
        canReorder
        onMove={() => undefined}
        onAdd={() => undefined}
      />
      <p className={styles['subheading']}>Full, with winners (drag a grip to swap two slots)</p>
      <DraggableBoard />
      <p className={styles['subheading']}>Matches with more than two sides</p>
      <CardBoard rowIdPrefix="gallery-board-4" sections={MULTI_SIDE} onAdd={() => undefined} />
      <p className={styles['subheading']}>Locked</p>
      <CardBoard rowIdPrefix="gallery-board-5" sections={FULL} />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'booking-card',
  title: 'Booking card board',
  group: 'Office',
  notes:
    'The booking screen card from static data: empty, partly filled with problems, full with winners (draggable, swap), triple threat and four-way, and locked (no add or move controls). Each role and size has its Why?. No times anywhere.',
  render: () => <BookingCardDemo />,
};
