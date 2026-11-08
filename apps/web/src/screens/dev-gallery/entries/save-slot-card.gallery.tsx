import { useState } from 'react';
import { Button } from '@/components/Button';
import { Stack } from '@/components/layout';
import { LoadErrorSheet } from '@/screens/saves/LoadErrorSheet';
import type { SaveProblem } from '@/screens/saves/LoadErrorSheet';
import { SaveSlotCard } from '@/screens/saves/SaveSlotCard';
import { GALLERY_SAVE_SLOTS } from '../fixtures/saveSlots';
import type { GalleryEntry } from '../galleryEntry';

const NOW = new Date('2026-11-08T12:00:00.000Z');

const SLOTS = GALLERY_SAVE_SLOTS;

const SAMPLE_PROBLEM: SaveProblem = {
  stage: 'validate',
  issues: [
    { path: 'header.gameDate', message: 'Expected a date such as 2031-01-01' },
    { path: 'state.world.tables.people[12].attributes.mic', message: 'Too big: expected <=100' },
  ],
  truncated: 3,
};

function noop(): void {
  // Gallery buttons do nothing.
}

function SaveSlotCardDemo() {
  const [problem, setProblem] = useState<SaveProblem | null>(null);
  return (
    <Stack gap={4}>
      <SaveSlotCard
        slot={SLOTS.employed}
        now={NOW}
        highlighted
        onLoad={noop}
        onExport={noop}
        onBackups={noop}
        onDelete={noop}
      />
      <SaveSlotCard
        slot={SLOTS.unemployed}
        now={NOW}
        loading
        onLoad={noop}
        onExport={noop}
        onBackups={noop}
        onDelete={noop}
      />
      <SaveSlotCard
        slot={SLOTS.broken}
        now={NOW}
        unreadableStage="decode"
        onLoad={noop}
        onExport={noop}
        onBackups={noop}
        onDelete={noop}
      />
      <div>
        <Button
          onClick={() => {
            setProblem(SAMPLE_PROBLEM);
          }}
        >
          Open load error sheet
        </Button>
      </div>
      <LoadErrorSheet
        problem={problem}
        title="Couldn't load Hand-edited save"
        onClose={() => {
          setProblem(null);
        }}
        onExport={noop}
      />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'save-slot-card',
  title: 'SaveSlotCard',
  group: 'Data',
  notes:
    'A saved game in the slot list: just imported (ringed), loading and needing an upgrade, and a save that could not be read (Export and Delete only). The button opens the load error sheet.',
  render: () => <SaveSlotCardDemo />,
};
