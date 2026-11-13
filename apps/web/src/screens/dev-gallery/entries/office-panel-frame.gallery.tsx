import { Stack } from '@/components/layout';
import { Panel } from '@/components/Panel';
import { OfficePanelError, OfficePanelFrame } from '@/screens/office/panels/OfficePanelFrame';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

function OfficePanelFrameDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>A panel that loads</h3>
        <OfficePanelFrame
          panelId="gallery.working"
          render={() => (
            <Panel title="Working panel">
              <p>The frame draws nothing of its own around a panel that works.</p>
            </Panel>
          )}
        />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>A panel that broke</h3>
        <OfficePanelError panelId="gallery.broken" error={new Error('Cannot read the show list')} />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'office-panel-frame',
  title: 'OfficePanelFrame',
  group: 'Office',
  notes:
    'Wraps every panel registered with registerOfficePanel (drawn from office.dashboard). A panel ' +
    'that throws shows "This panel couldn\'t load" with its id under Details, and the rest of the ' +
    'Office keeps working. The broken state is drawn directly here, so the gallery logs no error.',
  render: () => <OfficePanelFrameDemo />,
};
