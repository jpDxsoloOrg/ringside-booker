import { Stack } from '@/components/layout';
import { PayoffPreview } from '@/screens/storylines/end/PayoffPreview';
import type { GalleryEntry } from '../galleryEntry';
import {
  coldPayoffPlan,
  hotPayoffPlan,
  shortPayoffPlan,
  skippedPayoffPlan,
} from '../fixtures/storylineHeat';
import styles from './entries.module.css';

function PayoffPreviewDemo() {
  return (
    <Stack gap={6}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Hot story with its finale played</h3>
        <PayoffPreview plan={hotPayoffPlan} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Cold story: everyone loses a little</h3>
        <PayoffPreview plan={coldPayoffPlan} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Too few segments, with a show still booked</h3>
        <PayoffPreview plan={shortPayoffPlan} stillBookedShows={['Friday Night Fury']} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>A member who left gets nothing</h3>
        <PayoffPreview plan={skippedPayoffPlan} />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'payoff-preview',
  title: 'PayoffPreview',
  group: 'Office',
  notes:
    "What ending a storyline now would pay: the payoff strength with its Why?, then each member's " +
    'popularity and momentum change with a Why? each, or why they get nothing. The end sheet ' +
    'shows it; it is the same planner the real payoff runs.',
  render: () => <PayoffPreviewDemo />,
};
