import { useState } from 'react';
import { Button } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import { Popover } from '@/components/Popover';
import { Switch } from '@/components/Switch';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

function PopoverDemo() {
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Detail</h3>
        <Cluster gap={2}>
          <Popover trigger={<Button size="sm">Attendance breakdown</Button>} title="Attendance">
            <Stack gap={2}>
              <p>Base draw from popularity in the region: 3,100.</p>
              <p>Hype for this event: +420.</p>
              <p>Capped by the venue at 3,400.</p>
            </Stack>
          </Popover>
          <Popover
            trigger={<Button size="sm">Opens above</Button>}
            title="Above the trigger"
            side="top"
            align="center"
          >
            <p>Flips below when there is no room above.</p>
          </Popover>
        </Cluster>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Quick controls, controlled</h3>
        <Cluster gap={2}>
          <Popover
            open={isFilterOpen}
            onOpenChange={setIsFilterOpen}
            trigger={
              <Button size="sm" iconStart="settings">
                Roster filters
              </Button>
            }
            title="Show on the roster"
          >
            <Stack gap={3}>
              <Switch label="Injured workers" defaultChecked />
              <Switch label="Development contracts" />
            </Stack>
          </Popover>
          <span className={styles['caption']}>{isFilterOpen ? 'Open' : 'Closed'}</span>
        </Cluster>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'popover',
  title: 'Popover',
  group: 'Overlays',
  notes:
    'Focus moves into the popover on open and back to its button on close. Escape, Close or a click outside closes it. On a phone it stays inside the screen.',
  render: () => <PopoverDemo />,
};
