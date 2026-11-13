import { PUSH_LABELS } from '@ringside/engine';
import type { Push, PushVerdict } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { PushGapMarker } from '@/screens/roster/PushGapMarker';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

interface MarkerSample {
  readonly verdict: PushVerdict;
  readonly title: string;
  readonly expects: Exclude<Push, 'none'>;
}

const SAMPLES: readonly MarkerSample[] = [
  {
    verdict: 'expectsMore',
    title: 'Expects more (pushed below what they expect)',
    expects: 'mainEvent',
  },
  { verdict: 'asExpected', title: 'As expected (no marker)', expects: 'midCard' },
  { verdict: 'aboveExpected', title: 'Above expectations (pushed higher)', expects: 'lowerCard' },
];

function PushGapMarkerDemo() {
  return (
    <Stack gap={4}>
      {SAMPLES.map((sample) => (
        <section key={sample.verdict} className={styles['example']}>
          <h3 className={styles['subheading']}>{sample.title}</h3>
          <p>
            {PUSH_LABELS[sample.expects]} <PushGapMarker verdict={sample.verdict} />
          </p>
        </section>
      ))}
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'roster-push-gap-marker',
  title: 'PushGapMarker',
  group: 'Office',
  notes:
    "The marker beside a wrestler's expected push in the roster's Expects column, fed by " +
    'roster.rows (pushGap.verdict). The words are always shown, so it never relies on colour; ' +
    'screen readers hear the whole cell as one sentence instead.',
  render: () => <PushGapMarkerDemo />,
};
