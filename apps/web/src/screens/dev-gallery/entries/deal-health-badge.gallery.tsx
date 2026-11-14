import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { Stack } from '@/components/layout';
import { DealHealthBadge } from '@/screens/networks/components/DealHealthBadge';
import { galleryDealRows, galleryNetworkTraces } from '../fixtures/networks';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

function createTransport(): EngineTransport {
  return createTraceFixtureTransport(galleryNetworkTraces());
}

const SAFE_REF = galleryDealRows[0]?.healthTraceRef ?? null;

function DealHealthBadgeDemo() {
  return (
    <EngineProvider createTransport={createTransport}>
      <Stack gap={4}>
        <section className={styles['example']}>
          <h3 className={styles['subheading']}>Safe, with the stored verdict’s Why?</h3>
          <DealHealthBadge
            risk="safe"
            reasons={['Viewers are 127% of what National Sports Network expects']}
            healthTraceRef={SAFE_REF}
            networkName="National Sports Network"
          />
        </section>
        <section className={styles['example']}>
          <h3 className={styles['subheading']}>Watch</h3>
          <DealHealthBadge
            risk="watch"
            reasons={['Viewers are 92% of what Bluebonnet Cable 7 expects']}
            networkName="Bluebonnet Cable 7"
          />
        </section>
        <section className={styles['example']}>
          <h3 className={styles['subheading']}>At risk</h3>
          <DealHealthBadge
            risk="atRisk"
            reasons={['Viewers are 71% of what Turnstile PPV expects; below 60% it may cancel']}
            networkName="Turnstile PPV"
          />
        </section>
        <section className={styles['example']}>
          <h3 className={styles['subheading']}>Cancelling</h3>
          <DealHealthBadge
            risk="cancelling"
            reasons={[
              'Viewers are 38% of what Caliche Country Sports expects; each airing it may cancel (25%)',
            ]}
            networkName="Caliche Country Sports"
          />
        </section>
        <section className={styles['example']}>
          <h3 className={styles['subheading']}>Missed airing (the worst reason)</h3>
          <DealHealthBadge
            risk="watch"
            reasons={['Missed airing: Thu 16 Apr']}
            networkName="Bluebonnet Cable 7"
          />
        </section>
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'deal-health-badge',
  title: 'Deal health badge',
  group: 'Data',
  notes:
    'How a network sees a deal (ECO8-06): Safe, Watch, At risk, Cancelling, or Missed airing when ' +
    'that is the worst reason. The reasons are read out with the badge and show in a tooltip; the ' +
    'deal sheet lists them as text. Only the first example has a stored verdict to open.',
  render: () => <DealHealthBadgeDemo />,
};
