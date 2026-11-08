import { useState } from 'react';
import type { PersonStyle } from '@/components/ImageSlot';
import { Stack } from '@/components/layout';
import { ArtGrid, RegenerateControl, SizeRow, useArtCycle } from '../ArtParts';
import { generatePeople } from '../artSamples';
import type { GalleryEntry } from '../galleryEntry';
import { galleryPeople } from '../imageSlotFixtures';
import styles from './entries.module.css';

const GENERATED_COUNT = 12;

function PeopleArt() {
  const [personStyle, setPersonStyle] = useState<PersonStyle>('initials');
  const { cycle, regenerate } = useArtCycle();
  const people = generatePeople(cycle, GENERATED_COUNT);
  const [sizeSubject] = people;

  return (
    <Stack gap={6}>
      <label className={styles['toggle']}>
        <input
          type="checkbox"
          checked={personStyle === 'silhouette'}
          onChange={(event) => {
            setPersonStyle(event.target.checked ? 'silhouette' : 'initials');
          }}
        />
        Draw people as silhouettes
      </label>
      <RegenerateControl cycle={cycle} onRegenerate={regenerate} />
      {sizeSubject === undefined ? null : (
        <SizeRow subject={sizeSubject} personStyle={personStyle} />
      )}
      <ArtGrid title="Generated names" subjects={people} personStyle={personStyle} />
      <ArtGrid
        title="Hand-picked names (accents, hyphens, one-word names)"
        subjects={galleryPeople}
        personStyle={personStyle}
        size="md"
      />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'art-people',
  title: 'People',
  group: 'Art',
  notes:
    'ImageSlot placeholders for people: initials or a silhouette, coloured from the id. ' +
    'Regenerate moves to a new seed for new names and ids.',
  render: () => <PeopleArt />,
};
