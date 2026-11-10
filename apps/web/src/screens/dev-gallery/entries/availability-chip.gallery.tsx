import { AVAILABILITY_STATUSES, parseGameDate } from '@ringside/engine';
import type { Availability, AvailabilityStatus } from '@ringside/engine';
import { AvailabilityChip } from '@/components/AvailabilityChip';
import { Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

const RETURN_DAY = parseGameDate('2026-04-14');

/** One sample per status, with the reason and return day a real answer would carry. */
const SAMPLES: Readonly<Record<AvailabilityStatus, Pick<Availability, 'reason' | 'until'>>> = {
  available: { reason: 'Available', until: null },
  injured: { reason: 'Injured (leg injury)', until: RETURN_DAY },
  rehab: { reason: 'In rehab', until: RETURN_DAY },
  personalLeave: { reason: 'On personal leave', until: RETURN_DAY },
  suspended: { reason: 'Suspended', until: RETURN_DAY },
  timeOff: { reason: 'On time off', until: RETURN_DAY },
  notDebuted: { reason: 'Has not debuted yet', until: null },
  retired: { reason: 'Retired', until: null },
};

function AvailabilityChipDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Every status</h3>
        <div className={office['chipRow']}>
          {AVAILABILITY_STATUSES.map((status) => (
            <AvailabilityChip key={status} availability={{ status, ...SAMPLES[status] }} />
          ))}
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Away with no known return day</h3>
        <div className={office['chipRow']}>
          <AvailabilityChip
            availability={{ status: 'personalLeave', reason: 'On hiatus', until: null }}
          />
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'availability-chip',
  title: 'AvailabilityChip',
  group: 'Office',
  notes:
    'Green can work, red is injured, gold is a spell away that ends by itself, plain is not in the business right now. The reason is in the tooltip (focus the chip or hover it).',
  render: () => <AvailabilityChipDemo />,
};
