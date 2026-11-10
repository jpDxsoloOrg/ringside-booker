import { useState } from 'react';
import { addDays } from '@ringside/engine';
import type { CalendarShow, CalendarShowDetail } from '@ringside/engine';
import { Button } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import { ShowDetailSheet } from '@/screens/calendar/ShowDetailSheet';
import type { GalleryEntry } from '../galleryEntry';
import {
  GALLERY_CALENDAR_TODAY,
  galleryRivalShow,
  galleryShow,
  galleryShowDetail,
} from '../fixtures/calendar';
import styles from './entries.module.css';

interface SheetExample {
  readonly label: string;
  readonly show: CalendarShow | CalendarShowDetail;
  /** Name the promotion among the facts, as the Whole world view does. */
  readonly showPromotion: boolean;
  /** What pressing Cancel show does: nothing, or a refusal with the game's reason. */
  readonly cancel?: 'accept' | 'refuse';
}

const NEXT_WEEK = addDays(GALLERY_CALENDAR_TODAY, 7);

const EXAMPLES: readonly SheetExample[] = [
  {
    label: 'Your own, scheduled (with Cancel)',
    show: galleryShowDetail(
      galleryShow({ date: NEXT_WEEK, airDate: addDays(NEXT_WEEK, 2), importance: 'major' }),
    ),
    showPromotion: false,
    cancel: 'accept',
  },
  {
    label: 'Your own, Cancel refused',
    show: galleryShowDetail(galleryShow({ date: NEXT_WEEK, airDate: NEXT_WEEK })),
    showPromotion: false,
    cancel: 'refuse',
  },
  {
    label: "A rival's show",
    show: galleryShowDetail(
      galleryRivalShow(0, { date: NEXT_WEEK, airDate: NEXT_WEEK, importance: 'flagship' }),
      { definition: { recurrenceText: '2nd Saturday of January every year' } },
    ),
    showPromotion: true,
  },
  {
    label: 'Not run (no card)',
    show: galleryShowDetail(
      galleryShow({
        date: addDays(GALLERY_CALENDAR_TODAY, -7),
        airDate: addDays(GALLERY_CALENDAR_TODAY, -7),
        status: 'cancelled',
        cancellation: { reason: 'notRun', on: addDays(GALLERY_CALENDAR_TODAY, -7) },
        canCancel: false,
      }),
    ),
    showPromotion: false,
  },
  {
    label: 'Cancelled by you',
    show: galleryShowDetail(
      galleryShow({
        date: NEXT_WEEK,
        airDate: NEXT_WEEK,
        status: 'cancelled',
        cancellation: { reason: 'byPromotion', on: GALLERY_CALENDAR_TODAY },
        canCancel: false,
      }),
    ),
    showPromotion: false,
  },
  {
    label: 'Projected (no id, so nothing to act on)',
    show: galleryShow({
      date: addDays(GALLERY_CALENDAR_TODAY, 140),
      airDate: addDays(GALLERY_CALENDAR_TODAY, 140),
      status: 'projected',
    }),
    showPromotion: false,
  },
  {
    label: 'Venue not chosen yet',
    show: galleryShowDetail(
      galleryShow({
        date: NEXT_WEEK,
        airDate: NEXT_WEEK,
        venue: null,
        brand: null,
        format: { slots: 8, preShowSlots: 1 },
      }),
    ),
    showPromotion: false,
  },
];

async function refuseCancel(): Promise<void> {
  await Promise.resolve();
  throw new Error('This show has already taken place.');
}

async function acceptCancel(): Promise<void> {
  await Promise.resolve();
}

function ShowDetailSheetDemo() {
  const [openExample, setOpenExample] = useState<SheetExample | null>(null);
  const cancelHandler =
    openExample?.cancel === undefined
      ? {}
      : { onCancelShow: openExample.cancel === 'refuse' ? refuseCancel : acceptCancel };

  return (
    <Stack gap={4}>
      <p className={styles['caption']}>
        Each button opens the sheet on one kind of show. In the gallery Cancel show changes nothing:
        one example accepts it and one shows the game&apos;s refusal inside the confirmation.
      </p>
      <Cluster gap={2}>
        {EXAMPLES.map((example) => (
          <Button
            key={example.label}
            onClick={() => {
              setOpenExample(example);
            }}
          >
            {example.label}
          </Button>
        ))}
      </Cluster>
      <ShowDetailSheet
        open={openExample !== null}
        onClose={() => {
          setOpenExample(null);
        }}
        show={openExample?.show ?? null}
        today={GALLERY_CALENDAR_TODAY}
        showPromotion={openExample?.showPromotion ?? false}
        {...cancelHandler}
      />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'show-detail-sheet',
  title: 'Show detail sheet',
  group: 'Office',
  notes:
    'Fed by calendar.show (the facts, how often it runs and the Why? on the venue); a projected show is drawn from its calendar.projected row. Cancel show issues calendar.cancelShow.',
  render: () => <ShowDetailSheetDemo />,
};
