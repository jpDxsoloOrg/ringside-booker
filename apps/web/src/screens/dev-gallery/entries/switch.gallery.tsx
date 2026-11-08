import { useState } from 'react';
import { Stack } from '@/components/layout';
import { Switch } from '@/components/Switch';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

function SwitchDemo() {
  const [isAutosaveOn, setIsAutosaveOn] = useState(true);

  return (
    <Stack gap={4}>
      <Switch
        label="Autosave"
        description="Saves after every day you advance."
        checked={isAutosaveOn}
        onCheckedChange={setIsAutosaveOn}
      />
      <p className={styles['caption']}>{`Autosave is ${isAutosaveOn ? 'on' : 'off'}.`}</p>
      <Switch label="Pause on injuries" />
      <Switch label="Level playing field" description="Set when the game starts." disabled />
      <Switch label="Show rival finances" defaultChecked disabled />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'switch',
  title: 'Switch',
  group: 'Primitives',
  notes: 'On, off and disabled. Space toggles it, and a click on the label does too.',
  render: () => <SwitchDemo />,
};
