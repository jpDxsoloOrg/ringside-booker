import { useState } from 'react';
import { Button } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import { AwardTitleSheetView } from '@/screens/titles/AwardTitleSheet';
import type { GalleryEntry } from '../galleryEntry';
import { galleryTagHolders, galleryWomensHolders } from '../fixtures/titleActions';
import styles from './entries.module.css';

type AwardSample = 'singles' | 'tag' | 'refused';

/** The engine's words for a refused award, as `titles.award` gives them. */
const REFUSAL = "Gallery Vera Quill already holds the Gallery Women's Title.";

const TITLE_NAMES: Readonly<Record<AwardSample, string>> = {
  singles: "Gallery Women's Title",
  tag: "Gallery Women's Tag Titles",
  refused: "Gallery Women's Title",
};

function AwardTitleSheetDemo() {
  const [open, setOpen] = useState<AwardSample | null>(null);
  const [shown, setShown] = useState<AwardSample>('singles');
  const [includeIneligible, setIncludeIneligible] = useState(false);
  const show = (sample: AwardSample): void => {
    setShown(sample);
    setIncludeIneligible(false);
    setOpen(sample);
  };
  const close = (): void => {
    setOpen(null);
  };
  const holders = shown === 'tag' ? galleryTagHolders() : galleryWomensHolders(includeIneligible);
  return (
    <Stack gap={4}>
      <p className={styles['caption']}>
        A side sheet on desktop; on a phone it opens from the bottom and the list scrolls inside it.
        Award closes the demo.
      </p>
      <Cluster gap={2}>
        <Button
          onClick={() => {
            show('singles');
          }}
        >
          {"Women's title"}
        </Button>
        <Button
          onClick={() => {
            show('tag');
          }}
        >
          Tag title
        </Button>
        <Button
          onClick={() => {
            show('refused');
          }}
        >
          Refused award
        </Button>
      </Cluster>
      <AwardTitleSheetView
        open={open !== null}
        onClose={close}
        titleName={TITLE_NAMES[shown]}
        holderCount={holders.holderCount}
        holders={holders}
        loadError={null}
        includeIneligible={includeIneligible}
        onIncludeIneligibleChange={setIncludeIneligible}
        pending={false}
        messages={shown === 'refused' ? [REFUSAL] : []}
        onAward={close}
      />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'award-title-sheet',
  title: 'AwardTitleSheet',
  group: 'Overlays',
  notes:
    'Fed by titles.eligibleHolders and sent with titles.award. Teams first for a tag title, ' +
    'then everyone who could hold it with weight class, push and availability; a muted hint for ' +
    "someone on another brand; the champion marked and not pickable. The switch lists who can't " +
    'hold it, with the reason.',
  render: () => <AwardTitleSheetDemo />,
};
