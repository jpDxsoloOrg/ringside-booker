import { Stack } from '@/components/layout';
import { RosterBulkBar } from '@/screens/roster/RosterBulkBar';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

const noop = (): void => undefined;

function RosterBulkBarDemo() {
  return (
    <Stack gap={4}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Desktop: above the table</h3>
        <RosterBulkBar
          count={3}
          placement="inline"
          advancing={false}
          onSetPush={noop}
          onClear={noop}
        />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Phone: stuck to the bottom above the tab bar</h3>
        <p className={styles['caption']}>
          Below the phone breakpoint this bar sticks to the bottom of the screen with full-size
          buttons; at desktop width it looks like the bar above.
        </p>
        <RosterBulkBar
          count={3}
          placement="phone"
          advancing={false}
          onSetPush={noop}
          onClear={noop}
        />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>While days are advancing</h3>
        <RosterBulkBar count={12} placement="inline" advancing onSetPush={noop} onClear={noop} />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'roster-bulk-bar',
  title: 'RosterBulkBar',
  group: 'Office',
  notes:
    'The bar that appears while wrestlers are ticked on the roster. Its count is the ticked ' +
    'roster.rows; Set push… opens the SetPushSheet for them.',
  render: () => <RosterBulkBarDemo />,
};
