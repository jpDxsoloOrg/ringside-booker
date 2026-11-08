import { formatPercent } from '@/components/format';
import { Stack } from '@/components/layout';
import { Sparkline } from '@/components/Sparkline';
import type { SparklineTone } from '@/components/Sparkline';
import {
  GALLERY_ATTENDANCE_WEEKS,
  GALLERY_MORALE_WEEKS,
  GALLERY_VIEWER_WEEKS,
} from '../fixtures/office';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

const FLAT_WEEKS: readonly number[] = [70, 70, 70, 70, 70];

interface SparklineSample {
  readonly caption: string;
  readonly label: string;
  readonly values: readonly number[];
  readonly tone: SparklineTone;
  readonly formatValue?: (value: number) => string;
}

const SAMPLES: readonly SparklineSample[] = [
  {
    caption: 'Data (default)',
    label: 'TV viewers, last 8 weeks',
    values: GALLERY_VIEWER_WEEKS,
    tone: 'data',
    formatValue: (millions) => `${millions.toFixed(2)}M`,
  },
  {
    caption: 'Auto, rising',
    label: 'Attendance, last 8 weeks',
    values: GALLERY_ATTENDANCE_WEEKS,
    tone: 'auto',
    formatValue: (share) => formatPercent(share),
  },
  {
    caption: 'Auto, falling',
    label: 'Morale, last 8 weeks',
    values: GALLERY_MORALE_WEEKS,
    tone: 'auto',
  },
  { caption: 'Flat', label: 'Merch sales index', values: FLAT_WEEKS, tone: 'auto' },
  {
    caption: 'Prestige',
    label: 'Title prestige, last 8 weeks',
    values: [60, 62, 61, 66, 70, 71, 75, 78],
    tone: 'prestige',
  },
];

function SparklineDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Tones, at the default size</h3>
        <Stack gap={3}>
          {SAMPLES.map((sample) => (
            <div key={sample.caption} className={office['sparklineSample']}>
              <span className={office['sparklineCaption']}>{sample.caption}</span>
              <Sparkline
                values={sample.values}
                label={sample.label}
                tone={sample.tone}
                {...(sample.formatValue === undefined ? {} : { formatValue: sample.formatValue })}
              />
            </div>
          ))}
        </Stack>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Stretched by its parent</h3>
        <Sparkline
          values={GALLERY_VIEWER_WEEKS}
          label="TV viewers, last 8 weeks"
          className={office['wideSparkline']}
        />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'sparkline',
  title: 'Sparkline',
  group: 'Office',
  notes:
    'Inline SVG, no chart library. Its accessible name gives the first and last values and the trend, so the line never relies on colour. Fewer than two points draw nothing.',
  render: () => <SparklineDemo />,
};
