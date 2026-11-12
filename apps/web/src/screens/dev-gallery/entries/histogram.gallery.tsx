import { Histogram } from '@/components/Histogram';
import type { HistogramBin } from '@/components/Histogram';
import { Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

/** 20 bins of 5 points from 0 to 100, with the counts given from the bin at `start` up. */
function scoreBins(start: number, counts: readonly number[]): HistogramBin[] {
  return Array.from({ length: 20 }, (_, index) => ({
    from: index * 5,
    to: (index + 1) * 5,
    count: counts[index - start / 5] ?? 0,
  }));
}

const NORMAL_BINS = scoreBins(40, [1, 4, 11, 22, 27, 21, 10, 3, 1]);
const SKEWED_BINS = scoreBins(55, [2, 5, 9, 16, 24, 31, 13]);
const EMPTY_BINS = scoreBins(0, []);

function HistogramDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Normal, with the mean and ±1 sd</h3>
        <div className={office['stage']}>
          <Histogram
            bins={NORMAL_BINS}
            mean={61.8}
            sd={7.4}
            label="Score over 100 runs"
            unit="points"
          />
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Skewed toward the top</h3>
        <div className={office['stage']}>
          <Histogram
            bins={SKEWED_BINS}
            mean={78.6}
            sd={6.9}
            label="Score over 100 runs, skewed"
            unit="points"
          />
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Empty</h3>
        <div className={office['stage']}>
          <Histogram bins={EMPTY_BINS} label="Score, no runs" unit="points" />
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'histogram',
  title: 'Histogram',
  group: 'Data',
  notes:
    'Inline SVG, no chart library: a bar per bin, ticks along the bottom, the tallest count up the side, a dashed gold mean line and a faint ±1 sd band kept inside the bins. The drawing is hidden from screen readers; a visually hidden table holds the same numbers. With no values it says "No runs yet".',
  render: () => <HistogramDemo />,
};
