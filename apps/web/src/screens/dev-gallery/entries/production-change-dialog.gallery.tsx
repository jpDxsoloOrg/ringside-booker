import { useState } from 'react';
import { Button } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import { ProductionChangeDialogView } from '@/screens/production/ProductionChangeDialog';
import { galleryPreviewFor } from '../fixtures/production';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

/** How long the demo change pretends to save before the dialog closes. */
const DEMO_DELAY_MS = 500;

const TV_REFUSAL = 'You have an active TV deal with Channel 9: camera stays at 3 or higher';

interface DialogExample {
  readonly id: string;
  readonly opener: string;
  readonly area: 'camera' | 'marketing';
  readonly label: string;
  readonly from: number;
  readonly to: number;
  readonly minLevel: number;
  readonly refusal: string | null;
}

const EXAMPLES: readonly DialogExample[] = [
  {
    id: 'raise',
    opener: 'Raise camera with a fee',
    area: 'camera',
    label: 'Camera',
    from: 2,
    to: 4,
    minLevel: 0,
    refusal: null,
  },
  {
    id: 'lower',
    opener: 'Lower marketing for free',
    area: 'marketing',
    label: 'Marketing',
    from: 3,
    to: 1,
    minLevel: 0,
    refusal: null,
  },
  {
    id: 'refused',
    opener: 'Refused by the TV deal',
    area: 'camera',
    label: 'Camera',
    from: 3,
    to: 2,
    minLevel: 0,
    refusal: TV_REFUSAL,
  },
];

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

/** One example: its opener and its dialog, with the level movable inside it. */
function DialogDemo({ example }: { readonly example: DialogExample }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(example.to);
  return (
    <>
      <Button
        onClick={() => {
          setTo(example.to);
          setOpen(true);
        }}
      >
        {example.opener}
      </Button>
      <ProductionChangeDialogView
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        onConfirm={async () => {
          await wait(DEMO_DELAY_MS);
        }}
        label={example.label}
        from={example.from}
        to={to}
        minLevel={example.minLevel}
        preview={galleryPreviewFor(example.area, example.from, to, example.refusal)}
        loading={false}
        onLevelChange={setTo}
      />
    </>
  );
}

function ProductionChangeDialogDemo() {
  return (
    <Stack gap={3}>
      <p className={styles['caption']}>
        Hand-written previews (no engine). − and + inside a dialog move the proposed level.
      </p>
      <Cluster gap={3}>
        {EXAMPLES.map((example) => (
          <DialogDemo key={example.id} example={example} />
        ))}
      </Cluster>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'production-change-dialog',
  title: 'Production change dialog',
  group: 'Overlays',
  notes:
    'The dialog − and + open on Business > Production: the fee with its Why? (or "Lowering is ' +
    'free"), every number before → after with a chip (costs up are bad, ceilings up are good), and ' +
    'the refusals in place with the confirm held back.',
  render: () => <ProductionChangeDialogDemo />,
};
