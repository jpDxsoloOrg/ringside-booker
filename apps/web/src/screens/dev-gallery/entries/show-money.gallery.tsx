import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { Stack } from '@/components/layout';
import { ShowMoneyRows } from '@/screens/finances/ShowMoneySection';
import {
  GALLERY_SHOW_MONEY_MONTH,
  GALLERY_SHOW_MONEY_NAME,
  galleryShowMoneyRows,
  galleryShowMoneyTraces,
} from '../fixtures/showMoney';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import type { GalleryEntry } from '../galleryEntry';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

function createShowMoneyTransport(): EngineTransport {
  return createTraceFixtureTransport(galleryShowMoneyTraces());
}

function Example({ title, narrow = false }: { readonly title: string; readonly narrow?: boolean }) {
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      <div className={narrow ? broadcast['phoneColumn'] : undefined}>
        <ShowMoneyRows
          rows={galleryShowMoneyRows}
          showName={GALLERY_SHOW_MONEY_NAME}
          month={GALLERY_SHOW_MONEY_MONTH}
        />
      </div>
    </section>
  );
}

function ShowMoneyDemo() {
  return (
    <EngineProvider createTransport={createShowMoneyTransport}>
      <Stack gap={5}>
        <Example title="A regular show at home" />
        <Example title="Phone width (390px)" narrow />
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'show-money',
  title: 'Show money',
  group: 'Broadcast',
  notes:
    "The results page's Show money section (ECO1-06), from hand-written ledger rows (no engine). " +
    'Only the player’s own shows have it: a rival’s books are private. Rows whose breakdown is no ' +
    'longer kept say so instead of a Why?; the others open small stand-in breakdowns.',
  render: () => <ShowMoneyDemo />,
};
