import { useState } from 'react';
import { Stack } from '@/components/layout';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

const MATCH_TYPES: readonly SelectOption[] = [
  { value: 'singles', label: 'Singles' },
  { value: 'tag', label: 'Tag team' },
  { value: 'triple-threat', label: 'Triple threat' },
  { value: 'ladder', label: 'Ladder' },
  { value: 'cage', label: 'Steel cage', disabled: true },
  { value: 'battle-royal', label: 'Battle royal with a long name that has to wrap or clip' },
];

const SHOW_SIZES: readonly SelectOption[] = [
  { value: 'weekly', label: 'Weekly TV' },
  { value: 'special', label: 'Special event' },
  { value: 'major', label: 'Major event' },
];

function SelectDemo() {
  const [matchType, setMatchType] = useState('singles');

  return (
    <Stack gap={5}>
      <Select
        label="Match type"
        options={MATCH_TYPES}
        value={matchType}
        onValueChange={setMatchType}
      />
      <p className={styles['caption']}>{`Chosen: ${matchType}`}</p>
      <Select label="Show size" options={SHOW_SIZES} placeholder="Pick a size" />
      <Select label="Locked format" options={SHOW_SIZES} defaultValue="weekly" disabled />
      <Select label="Sort roster by" hideLabel options={SHOW_SIZES} defaultValue="major" />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'select',
  title: 'Select',
  group: 'Primitives',
  notes:
    'Controlled, with a placeholder, disabled, and with the label hidden. The list opens below the field and never runs off a phone screen; the steel cage option is disabled.',
  render: () => <SelectDemo />,
};
