import { useState } from 'react';
import { parseId } from '@ringside/engine';
import type { Reason } from '@ringside/engine';
import { Button } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import {
  EMPTY_STORYLINE_VALUES,
  StorylineEditorSheetView,
} from '@/screens/storylines/StorylineEditorSheet';
import type {
  StorylineEditorMode,
  StorylineEditorValues,
} from '@/screens/storylines/StorylineEditorSheet';
import type { GalleryEntry } from '../galleryEntry';
import { galleryMemberOptions } from '../fixtures/storylines';
import styles from './entries.module.css';

type EditorSample = 'create' | 'edit' | 'refused';

const BRANDS = [
  { brandId: parseId('brand', 'brd_0000000001'), name: 'Gallery Mainstage' },
  { brandId: parseId('brand', 'brd_0000000002'), name: 'Gallery Late Night' },
];

const EDIT_VALUES: StorylineEditorValues = {
  name: 'Gallery Feud',
  summary: 'Two former partners settle who carried the team.',
  brandId: BRANDS[0]?.brandId ?? null,
  members: [],
};

/** The engine's words for a taken name and a brand that stopped running, as the commands give them. */
const REFUSALS: readonly Reason[] = [
  {
    code: 'storylines.nameTaken',
    message: 'You already run a storyline called Gallery Feud.',
    field: 'name',
  },
  { code: 'storylines.notYours', message: "Gallery Rival Wrestling isn't yours." },
];

function StorylineEditorSheetDemo() {
  const [open, setOpen] = useState(false);
  const [sample, setSample] = useState<EditorSample>('create');
  const show = (next: EditorSample): void => {
    setSample(next);
    setOpen(true);
  };
  const close = (): void => {
    setOpen(false);
  };
  const mode: StorylineEditorMode = sample === 'edit' ? 'edit' : 'create';
  return (
    <Stack gap={4}>
      <p className={styles['caption']}>
        A side sheet on desktop; on a phone it opens from the bottom (create fills the screen). Save
        closes the demo; nothing is sent to an engine.
      </p>
      <Cluster gap={2}>
        <Button
          onClick={() => {
            show('create');
          }}
        >
          New storyline
        </Button>
        <Button
          onClick={() => {
            show('edit');
          }}
        >
          Edit storyline
        </Button>
        <Button
          onClick={() => {
            show('refused');
          }}
        >
          Refused save
        </Button>
      </Cluster>
      <StorylineEditorSheetView
        open={open}
        onClose={close}
        mode={mode}
        initial={
          sample === 'edit'
            ? EDIT_VALUES
            : { ...EMPTY_STORYLINE_VALUES, name: sample === 'refused' ? 'Gallery Feud' : '' }
        }
        brands={BRANDS}
        memberOptions={galleryMemberOptions}
        pending={false}
        reasons={sample === 'refused' ? REFUSALS : []}
        onSave={close}
      />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'storyline-editor-sheet',
  title: 'StorylineEditorSheet',
  group: 'Overlays',
  notes:
    'Creating or editing a storyline, with fixed member options and no engine. Each person picked ' +
    'starts on the side their alignment suggests (face, heel; a tweener is neutral). A refusal ' +
    'that names a field shows under it; the others show above the footer.',
  render: () => <StorylineEditorSheetDemo />,
};
