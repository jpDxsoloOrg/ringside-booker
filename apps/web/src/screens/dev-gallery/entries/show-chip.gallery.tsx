import { useEffect, useState } from 'react';
import { addDays } from '@ringside/engine';
import type { CalendarShow } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { Stack } from '@/components/layout';
import {
  IMPORTANCE_LABELS,
  IMPORTANCE_ORDER,
  registerShowChipBadge,
  ShowChip,
} from '@/components/ShowChip';
import { Switch } from '@/components/Switch';
import type { GalleryEntry } from '../galleryEntry';
import { GALLERY_CALENDAR_TODAY, galleryRivalShow, galleryShow } from '../fixtures/calendar';
import calendarStyles from './calendar.module.css';
import styles from './entries.module.css';

interface ChipExample {
  readonly caption: string;
  readonly show: CalendarShow;
  readonly tag?: 'brand' | 'promotion';
}

const IMPORTANCE_EXAMPLES: readonly ChipExample[] = IMPORTANCE_ORDER.flatMap((importance) => [
  {
    caption: `${IMPORTANCE_LABELS[importance]}, your own`,
    show: galleryShow({ importance }),
  },
  {
    caption: `${IMPORTANCE_LABELS[importance]}, a rival's`,
    show: galleryRivalShow(0, { importance }),
    tag: 'promotion' as const,
  },
]);

const STATE_EXAMPLES: readonly ChipExample[] = [
  {
    caption: 'Cancelled by you',
    show: galleryShow({
      status: 'cancelled',
      cancellation: { reason: 'byPromotion', on: addDays(GALLERY_CALENDAR_TODAY, -1) },
      canCancel: false,
    }),
  },
  {
    caption: 'Not run',
    show: galleryShow({
      status: 'cancelled',
      cancellation: { reason: 'notRun', on: GALLERY_CALENDAR_TODAY },
      canCancel: false,
    }),
  },
  { caption: 'Projected (dashed)', show: galleryShow({ status: 'projected' }) },
  {
    caption: 'Projected, a rival',
    show: galleryRivalShow(1, { status: 'projected' }),
    tag: 'promotion',
  },
  {
    caption: 'A long name (ellipsis; the full name is the tooltip)',
    show: galleryShow({
      name: 'Altura Overclock: The Grand Anniversary Celebration Spectacular',
      importance: 'major',
    }),
  },
  { caption: 'Promotion-wide (no brand tag)', show: galleryShow({ brand: null }) },
];

const DEMO_BADGE_ID = 'gallery.demo-badge';

function ignoreOpen(): void {
  // The gallery only shows the chip; nothing opens.
}

function ChipExamples({ examples }: { readonly examples: readonly ChipExample[] }) {
  return (
    <ul className={calendarStyles['chipList']}>
      {examples.map((example) => (
        <li key={example.caption} className={calendarStyles['chipExample']}>
          <span className={styles['caption']}>{example.caption}</span>
          <div className={calendarStyles['chipPair']}>
            <div className={calendarStyles['cellWidth']}>
              <ShowChip
                show={example.show}
                onOpen={ignoreOpen}
                density="grid"
                tag={example.tag ?? 'brand'}
              />
            </div>
            <div className={calendarStyles['phoneWidth']}>
              <ShowChip
                show={example.show}
                onOpen={ignoreOpen}
                density="row"
                tag={example.tag ?? 'brand'}
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ShowChipDemo() {
  const [withBadge, setWithBadge] = useState(false);

  // The badge slot is global, so the demo badge is only registered while the switch is on.
  useEffect(() => {
    if (!withBadge) return undefined;
    return registerShowChipBadge({
      id: DEMO_BADGE_ID,
      order: 10,
      render: ({ show }) => (show.status === 'cancelled' ? null : <Badge tone="data">Taped</Badge>),
    });
  }, [withBadge]);

  return (
    <Stack gap={6}>
      <p className={styles['caption']}>
        Each chip is drawn twice: in the grid density at the width of a month cell, then in the row
        density at phone width.
      </p>
      <Switch
        label="Add a badge through the chip-badge slot"
        checked={withBadge}
        onCheckedChange={setWithBadge}
      />
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Importance, your own and a rival&apos;s</h3>
        <ChipExamples examples={IMPORTANCE_EXAMPLES} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>States</h3>
        <ChipExamples examples={STATE_EXAMPLES} />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'show-chip',
  title: 'ShowChip',
  group: 'Office',
  notes:
    'One row of calendar.range or calendar.projected. Own shows have a solid edge and a tint; rivals are muted; a projected show has a dashed edge.',
  render: () => <ShowChipDemo />,
};
