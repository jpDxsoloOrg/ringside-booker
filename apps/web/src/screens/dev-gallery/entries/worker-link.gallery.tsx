import { parseId } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { WorkerLink } from '@/components/WorkerLink';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

const SHORT_NAME_ID = parseId('person', 'per_0000000101');
const LONG_NAME_ID = parseId('person', 'per_0000000102');
const LONG_NAME = 'The Incomparable Grand Duke Maximilian Thunderstone the Third';

function WorkerLinkDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>In a sentence</h3>
        <p>
          <WorkerLink personId={SHORT_NAME_ID} name="Gallery Champion" /> beat{' '}
          <WorkerLink personId={LONG_NAME_ID} name={LONG_NAME} /> in the main event.
        </p>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Cut to one line, in a narrow column</h3>
        <p className={styles['caption']}>
          The whole name is still the link text, and it shows as a tooltip when pointed at.
        </p>
        <div className={office['narrowColumn']}>
          <WorkerLink personId={SHORT_NAME_ID} name="Gallery Champion" truncate />
          <WorkerLink personId={LONG_NAME_ID} name={LONG_NAME} truncate />
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'worker-link',
  title: 'WorkerLink',
  group: 'Office',
  notes:
    'A name that opens the profile, in the data colour, underlined when pointed at or focused. A long name wraps by default; truncate keeps it on one line. In the gallery there is no game, so following a link here leaves for the title screen.',
  render: () => <WorkerLinkDemo />,
};
