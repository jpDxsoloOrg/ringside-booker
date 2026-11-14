import { Stack } from '@/components/layout';
import { VerdictBadge } from '@/screens/networks/components/VerdictBadge';
import { galleryAcceptedValuation, galleryRefusedValuation } from '../fixtures/networks';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

function VerdictBadgeDemo() {
  return (
    <Stack gap={4}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Would accept</h3>
        <VerdictBadge
          verdict="accept"
          refusals={[]}
          trace={galleryAcceptedValuation.verdictTrace}
          networkName="Bluebonnet Cable 7"
        />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Would refuse, with its first reason</h3>
        <VerdictBadge
          verdict="refuse"
          refusals={galleryRefusedValuation.refusals}
          trace={galleryRefusedValuation.verdictTrace}
          networkName="National Sports Network"
        />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>In a table row: no Why? (the Propose sheet has it)</h3>
        <VerdictBadge
          verdict="refuse"
          refusals={galleryRefusedValuation.refusals}
          networkName="National Sports Network"
        />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'verdict-badge',
  title: 'Network verdict badge',
  group: 'Data',
  notes:
    'Whether a network would sign (ECO8-06): the first reason it would refuse sits beside the ' +
    'badge in plain words, and the Why? opens the whole verdict.',
  render: () => <VerdictBadgeDemo />,
};
