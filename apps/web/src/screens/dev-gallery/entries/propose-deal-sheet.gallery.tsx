import { Stack } from '@/components/layout';
import { ProposalPreview } from '@/screens/networks/ProposalPreview';
import {
  galleryAcceptedValuation,
  galleryPpvValuation,
  galleryRefusedValuation,
} from '../fixtures/networks';
import type { GalleryEntry } from '../galleryEntry';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

function ProposeDealDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Would accept, but loses money every airing</h3>
        <ProposalPreview
          valuation={galleryAcceptedValuation}
          kind="tv"
          networkName="Bluebonnet Cable 7"
        />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Would refuse, with every reason</h3>
        <ProposalPreview
          valuation={galleryRefusedValuation}
          kind="tv"
          networkName="National Sports Network"
        />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>
          Pay-per-view: paid per buy, high airtime (phone width)
        </h3>
        <div className={broadcast['phoneColumn']}>
          <ProposalPreview valuation={galleryPpvValuation} kind="ppv" networkName="Turnstile PPV" />
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'propose-deal-sheet',
  title: 'Propose deal preview',
  group: 'Data',
  notes:
    'The Propose sheet’s preview (ECO8-06) from hand-written valuations with small stand-in ' +
    'breakdowns: every number has its Why?, a deal that loses money says so in words, and a ' +
    'pay-per-view deal says what its airtime costs before signing.',
  render: () => <ProposeDealDemo />,
};
