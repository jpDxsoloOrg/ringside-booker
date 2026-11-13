import { useState } from 'react';
import { Button } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import { SetPushSheet } from '@/screens/roster/SetPushSheet';
import type { GalleryEntry } from '../galleryEntry';
import { galleryBulkPushRows, gallerySinglePushRow } from '../fixtures/roster';
import styles from './entries.module.css';

type SheetSample = 'single' | 'bulk' | 'refusal';

/** The engine's words for a refused change, as `employment.setPush` gives them. */
const REFUSAL = "Gallery Name Two's contract has ended, so their push can't be changed.";

function SetPushSheetDemo() {
  const [open, setOpen] = useState<SheetSample | null>(null);
  // The sheet keeps its last rows while it closes, so its title doesn't change on the way out.
  const [shown, setShown] = useState<SheetSample>('single');
  const show = (sample: SheetSample): void => {
    setShown(sample);
    setOpen(sample);
  };
  const close = (): void => {
    setOpen(null);
  };
  return (
    <Stack gap={4}>
      <p className={styles['caption']}>
        A side sheet on desktop; on a phone it opens from the bottom. Apply closes the demo.
      </p>
      <Cluster gap={2}>
        <Button
          onClick={() => {
            show('single');
          }}
        >
          One wrestler
        </Button>
        <Button
          onClick={() => {
            show('bulk');
          }}
        >
          Three wrestlers
        </Button>
        <Button
          onClick={() => {
            show('refusal');
          }}
        >
          Refused change
        </Button>
      </Cluster>
      <SetPushSheet
        open={open !== null}
        rows={shown === 'bulk' ? galleryBulkPushRows : [gallerySinglePushRow]}
        onClose={close}
        onApply={close}
        pending={false}
        messages={shown === 'refusal' ? [REFUSAL] : []}
        advancing={false}
      />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'roster-set-push-sheet',
  title: 'SetPushSheet',
  group: 'Office',
  notes:
    "The roster's push choice, fed by roster.rows (push and expectedPush) and applied with the " +
    'employment.setPush command. One wrestler shows Current and Expects beside the options; ' +
    "three show how many are already at each; a refused change shows the engine's words.",
  render: () => <SetPushSheetDemo />,
};
