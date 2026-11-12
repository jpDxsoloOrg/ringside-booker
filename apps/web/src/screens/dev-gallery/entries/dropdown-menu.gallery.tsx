import { useState } from 'react';
import { Button, IconButton } from '@/components/Button';
import { DropdownMenu } from '@/components/DropdownMenu';
import type { DropdownMenuEntry, DropdownMenuItemTone } from '@/components/DropdownMenu';
import type { IconName } from '@/components/Icon';
import { Cluster, Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

interface DemoAction {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly disabled?: boolean;
  readonly tone?: DropdownMenuItemTone;
}

const SAFE_ACTIONS: readonly DemoAction[] = [
  { id: 'profile', label: 'View profile', icon: 'users' },
  { id: 'book', label: 'Book on next show', icon: 'calendar' },
  { id: 'contract', label: 'Renegotiate contract', icon: 'file-text' },
  { id: 'title-shot', label: 'Give a title shot', icon: 'trophy', disabled: true },
];

const DANGER_ACTIONS: readonly DemoAction[] = [
  { id: 'release', label: 'Release', icon: 'trash', tone: 'danger' },
];

function workerActions(report: (action: string) => void): readonly DropdownMenuEntry[] {
  const toEntry = (action: DemoAction): DropdownMenuEntry => ({
    kind: 'item',
    ...action,
    onSelect: () => {
      report(action.label);
    },
  });
  return [
    ...SAFE_ACTIONS.map(toEntry),
    {
      kind: 'submenu',
      id: 'push',
      label: 'Set push',
      icon: 'up',
      items: ['Main event', 'Upper midcard', 'Midcard'].map((push) => ({
        kind: 'item' as const,
        id: push,
        label: push,
        onSelect: () => {
          report(`Set push: ${push}`);
        },
      })),
    },
    { kind: 'separator', id: 'danger-zone' },
    ...DANGER_ACTIONS.map(toEntry),
  ];
}

function DropdownMenuDemo() {
  const [lastAction, setLastAction] = useState('Nothing chosen yet.');
  const items = workerActions((action) => {
    setLastAction(`Chose: ${action}.`);
  });

  return (
    <Stack gap={4}>
      <Cluster gap={2}>
        <DropdownMenu
          label="Worker actions"
          align="start"
          trigger={
            <Button size="sm" iconEnd="chevron-down">
              Actions
            </Button>
          }
          items={items}
        />
        <DropdownMenu
          label="More actions for this row"
          trigger={<IconButton icon="more" label="More actions" />}
          items={items}
        />
      </Cluster>
      <p className={styles['caption']} aria-live="polite">
        {lastAction}
      </p>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'dropdown-menu',
  title: 'DropdownMenu',
  group: 'Overlays',
  notes:
    'Enter, Space or Down opens it; Up and Down move and wrap, typing a letter jumps, Escape closes and returns focus. The disabled item is skipped.',
  render: () => <DropdownMenuDemo />,
};
