import { useState } from 'react';
import { Button } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import { emptyTitleForm, NO_FORM_ERRORS } from '@/screens/titles/titleForm';
import type { TitleFormErrors, TitleFormValues } from '@/screens/titles/titleForm';
import { TitleFormSheet } from '@/screens/titles/TitleFormSheet';
import type { TitleFormMode } from '@/screens/titles/TitleFormSheet';
import type { GalleryEntry } from '../galleryEntry';
import { galleryTitleBrands } from '../fixtures/titleActions';
import styles from './entries.module.css';

type FormSample = 'create' | 'edit' | 'refused';

/** A held women's tag title, as the edit form opens on it. */
const HELD_TAG: TitleFormValues = {
  name: "Gallery Women's Tag Titles",
  brand: galleryTitleBrands[0]?.brandId ?? 'promotion-wide',
  holderCount: 2,
  gender: 'female',
  minWeight: '',
  maxWeight: '',
  color: '#8a8d91',
  tier: 'secondary',
};

/** The engine's words for a refused create, as `titles.create` gives them. */
const REFUSED: TitleFormErrors = {
  fields: {
    name: 'Gallery Wrestling already has a title called Gallery Crown.',
    maxWeight: 'The weight limit (60 kg) is below the minimum weight (80 kg).',
  },
  general: ["Gallery Wrestling isn't yours. You can only create titles for your own promotion."],
};

const MODES: Readonly<Record<FormSample, TitleFormMode>> = {
  create: 'create',
  edit: 'edit',
  refused: 'create',
};

function TitleFormSheetDemo() {
  const [open, setOpen] = useState<FormSample | null>(null);
  // The sheet keeps its last sample while it closes, so its words don't change on the way out.
  const [shown, setShown] = useState<FormSample>('create');
  const show = (sample: FormSample): void => {
    setShown(sample);
    setOpen(sample);
  };
  const close = (): void => {
    setOpen(null);
  };
  return (
    <Stack gap={4}>
      <p className={styles['caption']}>
        A side sheet on desktop; on a phone it opens from the bottom. Create or Save closes the
        demo.
      </p>
      <Cluster gap={2}>
        <Button
          onClick={() => {
            show('create');
          }}
        >
          New title
        </Button>
        <Button
          onClick={() => {
            show('edit');
          }}
        >
          Edit a held tag title
        </Button>
        <Button
          onClick={() => {
            show('refused');
          }}
        >
          Refused create
        </Button>
      </Cluster>
      <TitleFormSheet
        open={open !== null}
        mode={MODES[shown]}
        initial={
          shown === 'edit'
            ? HELD_TAG
            : {
                ...emptyTitleForm(),
                ...(shown === 'refused'
                  ? { name: 'Gallery Crown', minWeight: '80', maxWeight: '60' }
                  : {}),
              }
        }
        brands={galleryTitleBrands}
        {...(shown === 'edit' ? { titleName: HELD_TAG.name, held: true } : {})}
        pending={false}
        errors={shown === 'refused' ? REFUSED : NO_FORM_ERRORS}
        onSubmit={close}
        onClose={close}
      />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'title-form-sheet',
  title: 'TitleFormSheet',
  group: 'Overlays',
  notes:
    'Creates a title (titles.create) or edits one (titles.edit): name, brand or promotion-wide, ' +
    'holders, division, weight limits, belt colour and, when creating, the tier. Editing a held ' +
    "title locks the holders. A refusal puts the engine's words under the fields they name and " +
    'the rest at the top.',
  render: () => <TitleFormSheetDemo />,
};
