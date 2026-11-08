import { Stack } from '@/components/layout';
import { ArtGrid, RegenerateControl, SizeRow, useArtCycle } from '../ArtParts';
import { generateTitles } from '../artSamples';
import type { GalleryEntry } from '../galleryEntry';
import { galleryBelts } from '../imageSlotFixtures';

const GENERATED_COUNT = 8;

function TitleArt() {
  const { cycle, regenerate } = useArtCycle();
  const titles = generateTitles(cycle, GENERATED_COUNT);
  const [sizeSubject] = titles;

  return (
    <Stack gap={6}>
      <RegenerateControl cycle={cycle} onRegenerate={regenerate} />
      {sizeSubject === undefined ? null : <SizeRow subject={sizeSubject} />}
      <ArtGrid title="Generated titles" subjects={titles} />
      <ArtGrid title="Hand-picked titles" subjects={galleryBelts} size="md" />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'art-titles',
  title: 'Titles',
  group: 'Art',
  notes: 'Belt placeholders in each metal tier: gold, silver, bronze and plain.',
  render: () => <TitleArt />,
};
