import { parseGameDate } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { LabBatchResult } from '@/screens/match-lab/LabBatchResult';
import { LabResult } from '@/screens/match-lab/LabResult';
import { LabWarnings } from '@/screens/match-lab/LabWarnings';
import { WorkerLinesTable } from '@/screens/match-lab/WorkerLinesTable';
import { sampleLabBatch, sampleLabResult } from '../fixtures/matchLab';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

const SAMPLE_DATE = parseGameDate('2027-01-04');
const NEXT_DAY = parseGameDate('2027-01-05');

function MatchLabDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>A fresh result</h3>
        <LabResult
          result={sampleLabResult}
          ratedOn={SAMPLE_DATE}
          today={SAMPLE_DATE}
          outOfDate={false}
        />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Out of date, rated on an earlier day</h3>
        <LabResult result={sampleLabResult} ratedOn={SAMPLE_DATE} today={NEXT_DAY} outOfDate />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Warnings</h3>
        <LabWarnings warnings={sampleLabResult.warnings} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Each worker</h3>
        <WorkerLinesTable kind="match" lines={sampleLabResult.workers} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Run x100</h3>
        <LabBatchResult batch={sampleLabBatch} />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'match-lab',
  title: 'Match lab result',
  group: 'Broadcast',
  notes:
    'The Match lab result parts with a made-up main-event tag match: the score bug with a Why? on each number, the expected-against-got and slot lines, the out-of-date marker, warnings (errors first), the Each worker table (cards on a phone; a stamina miss under a point still reads Failed) and Run x100. No engine is involved; the breakdowns are one line each.',
  render: () => <MatchLabDemo />,
};
