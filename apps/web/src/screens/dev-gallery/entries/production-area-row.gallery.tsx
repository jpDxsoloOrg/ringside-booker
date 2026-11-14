import { useState } from 'react';
import type { ProductionRow } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { ProductionAreaRow } from '@/screens/production/ProductionAreaRow';
import productionStyles from '@/screens/production/ProductionScreen.module.css';
import {
  galleryCameraRow,
  galleryCameraTvRow,
  galleryMarketingRow,
  galleryMusicRow,
  galleryRivalStageRow,
} from '../fixtures/production';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

/** The player's rows: − and + only say what they would ask for here. */
function ProductionAreaRowDemo() {
  const [asked, setAsked] = useState<string | null>(null);
  const own: readonly ProductionRow[] = [
    galleryCameraRow,
    galleryCameraTvRow,
    galleryMarketingRow,
    galleryMusicRow,
  ];
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>
          Your own: a per-show row, the TV floor, a monthly row with the ceiling, no effect yet
        </h3>
        <div className={office['stage']}>
          <ul className={productionStyles['rows']}>
            {own.map((row, index) => (
              <ProductionAreaRow
                key={`${row.area}-${String(index)}`}
                row={row}
                mine
                tvNetworkName="Channel 9"
                onRequestChange={(area, level) => {
                  setAsked(`${area} to level ${String(level)}`);
                }}
              />
            ))}
          </ul>
        </div>
        <p className={styles['caption']} role="status">
          {asked === null ? 'Press − or + on a row.' : `Asked for ${asked}.`}
        </p>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>A rival's: level and effect, no buttons or cost</h3>
        <div className={office['stage']}>
          <ul className={productionStyles['rows']}>
            <ProductionAreaRow row={galleryRivalStageRow} mine={false} />
          </ul>
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'production-area-row',
  title: 'Production area row',
  group: 'Office',
  notes:
    'One area on Business > Production from hand-written rows (no engine): name, level with − / +, ' +
    'the cost with its basis and Why?, and the effect lines. Each row is a card on a phone.',
  render: () => <ProductionAreaRowDemo />,
};
