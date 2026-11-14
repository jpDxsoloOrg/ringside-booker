import { useState } from 'react';
import type { OfferBand } from '@ringside/engine';
import { Button } from '@/components/Button';
import { Stack } from '@/components/layout';
import { ReactionMeter } from '@/components/ReactionMeter';
import { aPreview } from '@/screens/contracts/negotiation/negotiationFixtures';
import type { GalleryEntry } from '../galleryEntry';
import { ReducedMotionSwitch } from '../ReducedMotionSwitch';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

const BANDS: readonly { band: OfferBand; ratio: number }[] = [
  { band: 'walkAway', ratio: 0.38 },
  { band: 'reject', ratio: 0.5 },
  { band: 'counter', ratio: 0.62 },
  { band: 'likely', ratio: 1 },
  { band: 'likely', ratio: 1.6 },
];

function Meter({ band, ratio }: { readonly band: OfferBand; readonly ratio: number }) {
  const preview = aPreview(band, ratio);
  return (
    <ReactionMeter
      ratio={preview.ratio}
      band={preview.band}
      label={preview.label}
      thresholds={preview.thresholds}
      trace={preview.reactionTrace}
      name={`Their likely reaction at ${String(Math.round(ratio * 100))}%`}
    />
  );
}

function ReactionMeterDemo() {
  const [index, setIndex] = useState(2);
  const moving = BANDS[index] ?? { band: 'counter', ratio: 0.62 };
  return (
    <Stack gap={5}>
      <ReducedMotionSwitch />
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Each band (the last is capped at 125%)</h3>
        <Stack gap={4}>
          {BANDS.map((entry) => (
            <Meter
              key={`${entry.band}-${String(entry.ratio)}`}
              band={entry.band}
              ratio={entry.ratio}
            />
          ))}
        </Stack>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Refused</h3>
        <Meter band="refuse" ratio={1} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Moving marker (motion off under reduced motion)</h3>
        <Stack gap={3}>
          <Meter band={moving.band} ratio={moving.ratio} />
          <Button
            size="sm"
            onClick={() => {
              setIndex((current) => (current + 1) % BANDS.length);
            }}
          >
            Change the offer
          </Button>
        </Stack>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Phone width (390px)</h3>
        <div className={broadcast['phoneColumn']}>
          <Meter band="counter" ratio={0.62} />
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'reaction-meter',
  title: 'ReactionMeter',
  group: 'Data',
  notes:
    'How a worker would take an offer (ECO5-06), straight from contracts.offerPreview: four zones whose boundaries are the preview thresholds, a marker at the share of their ask, the label in words (a polite live region) and a Why?. role="meter" with the label as its value text.',
  render: () => <ReactionMeterDemo />,
};
