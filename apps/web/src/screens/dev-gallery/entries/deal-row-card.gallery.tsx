import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { DataTable } from '@/components/DataTable';
import { useMoneyFormatter } from '@/components/format';
import { Stack } from '@/components/layout';
import { dealColumns, dealTitle } from '@/screens/networks/dealColumns';
import {
  GALLERY_NETWORKS_TODAY,
  galleryDealRows,
  galleryNetworkTraces,
} from '../fixtures/networks';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import type { GalleryEntry } from '../galleryEntry';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

function createTransport(): EngineTransport {
  return createTraceFixtureTransport(galleryNetworkTraces());
}

function DealCards() {
  const money = useMoneyFormatter();
  const columns = dealColumns({ money, today: GALLERY_NETWORKS_TODAY, onOpen: () => undefined });
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Phone cards: TV, pay-per-view and an ended deal</h3>
        <div className={broadcast['phoneColumn']}>
          <DataTable
            rows={galleryDealRows}
            columns={columns}
            getRowId={(row) => row.dealId}
            getRowLabel={dealTitle}
            caption="Your TV deals (phone)"
            layout="cards"
          />
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>The same rows on the desktop table</h3>
        <DataTable
          rows={galleryDealRows}
          columns={columns}
          getRowId={(row) => row.dealId}
          getRowLabel={dealTitle}
          caption="Your TV deals (desktop)"
          layout="table"
        />
      </section>
    </Stack>
  );
}

function DealRowCardDemo() {
  return (
    <EngineProvider createTransport={createTransport}>
      <DealCards />
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'deal-row-card',
  title: 'Deal row and card',
  group: 'Data',
  notes:
    'Your deals rows (ECO8-06) from hand-written data: a prime-time TV deal (Safe, with its ' +
    'trend against what the network expects), a promotion-wide pay-per-view deal paid per buy with ' +
    'a missed airing coming, and a deal the network cancelled for low viewers. The trend is ' +
    'desktop only.',
  render: () => <DealRowCardDemo />,
};
