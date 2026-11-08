import { Stack } from '@/components/layout';
import { ArtGrid, RegenerateControl, SizeRow, useArtCycle } from '../ArtParts';
import { generatePromotions } from '../artSamples';
import type { GalleryEntry } from '../galleryEntry';
import { galleryLogos, galleryVenues } from '../imageSlotFixtures';

const GENERATED_COUNT = 8;

function LogoArt() {
  const { cycle, regenerate } = useArtCycle();
  const promotions = generatePromotions(cycle, GENERATED_COUNT);
  const [sizeSubject] = promotions;

  return (
    <Stack gap={6}>
      <RegenerateControl cycle={cycle} onRegenerate={regenerate} />
      {sizeSubject === undefined ? null : <SizeRow subject={sizeSubject} />}
      <ArtGrid title="Generated promotions" subjects={promotions} />
      <ArtGrid
        title="Hand-picked promotions, brands, events and networks"
        subjects={galleryLogos}
        size="md"
      />
      <ArtGrid title="Venues" subjects={galleryVenues} size="md" />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'art-logos',
  title: 'Promotions and logos',
  group: 'Art',
  notes:
    'Logo marks for promotions, brands, events and networks (an acronym when there is one), ' +
    'and the generic place mark for venues.',
  render: () => <LogoArt />,
};
