import { useState } from 'react';
import { Stack } from '@/components/layout';
import { DecisionLogList } from '@/components/DecisionLogList';
import type { GalleryEntry } from '../galleryEntry';
import {
  galleryDecisionLog,
  galleryEmptyDecisionLog,
  galleryReviewTrace,
} from '../fixtures/rivalDesk';
import styles from './entries.module.css';

function DecisionLogListDemo() {
  const [kind, setKind] = useState<string | null>(null);
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Three reviews and two plans not aired yet</h3>
        <p className={styles['caption']}>
          The oldest review’s breakdown is no longer kept, so it has no Why?.
        </p>
        <DecisionLogList
          log={galleryDecisionLog}
          selectedKind={kind}
          onKindChange={setKind}
          traceOf={(entry) => (entry.traceRef === null ? null : galleryReviewTrace)}
        />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Nothing decided yet</h3>
        <DecisionLogList
          log={galleryEmptyDecisionLog}
          selectedKind={null}
          onKindChange={() => undefined}
        />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'decision-log-list',
  title: 'DecisionLogList',
  group: 'Office',
  notes:
    'A rival desk’s decisions (aip.decisionLog), newest first: chips by kind (labels from the engine), date, kind, the decision in words and its Why?. Plans not aired yet are only counted. The chip row scrolls inside itself on a phone.',
  render: () => <DecisionLogListDemo />,
};
