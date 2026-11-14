import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import { RosterPicker } from '@/components/RosterPicker';
import type { RosterPickerMode } from '@/components/RosterPicker';
import type { GalleryEntry } from '../galleryEntry';
import {
  GALLERY_PICKER_TEAMS,
  GALLERY_REGION_NAME,
  GALLERY_STORYLINES,
  galleryPickerPeople,
} from '../fixtures/segmentEditor';
import styles from './entries.module.css';

const PEOPLE = galleryPickerPeople();

/** EVT2-13: the segment links The Crown Chase, so the Storylines menu offers it first. */
const STORYLINE_FILTER = {
  options: GALLERY_STORYLINES,
  linkedIds: GALLERY_STORYLINES.slice(0, 1).map((storyline) => storyline.storylineId),
};

function RosterPickerDemo() {
  const [mode, setMode] = useState<RosterPickerMode | null>(null);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState('Nobody picked yet.');
  const people = useMemo(
    () => PEOPLE.filter((person) => person.name.toLowerCase().includes(search.toLowerCase())),
    [search],
  );
  return (
    <Stack gap={4}>
      <p className={styles['caption']}>
        Available, injured (dimmed, with why), suspended, another brand and already on the card.
        Bookable only hides the ones that can’t be booked; turn it off to see why. Rhea Cortez and
        The Hale Storm hold titles (a belt beside the name); Storylines narrows the list to a
        current storyline’s members.
      </p>
      <Cluster gap={2}>
        <Button
          onClick={() => {
            setMode('people');
          }}
        >
          Pick a wrestler
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setMode('teams');
          }}
        >
          Pick a team
        </Button>
      </Cluster>
      <p role="status">{picked}</p>
      <RosterPicker
        open={mode !== null}
        onClose={() => {
          setMode(null);
        }}
        title="Add to Side 1"
        people={people}
        teams={GALLERY_PICKER_TEAMS}
        bookedFilter
        genderAndPushFilters
        sortStat={{ key: 'popularity', label: 'Most popular' }}
        statsNote={`Pop: popularity in ${GALLERY_REGION_NAME}, where this show is.`}
        initialMode={mode ?? 'people'}
        onSearchChange={setSearch}
        onPickPerson={(person) => {
          setPicked(`Picked ${person.name}.`);
          setMode(null);
        }}
        onPickTeam={(team) => {
          setPicked(`Picked ${team.name}.`);
          setMode(null);
        }}
        status="Side 1: 0 of 1"
        storylineFilter={STORYLINE_FILTER}
      />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'roster-picker',
  title: 'RosterPicker',
  group: 'Overlays',
  notes:
    'The booking editor’s worker picker (EVT2-06): debounced search, Bookable only / This brand / Hide booked / Most popular / Gender / Push / Teams filters, and rows with gender, type, stats, push, alignment, availability and notes. Gender and Push open small menus (EVT2-11). A belt marks champions and title-holding teams, and a Storylines menu narrows to one current storyline or any (EVT2-13), the segment’s linked storyline first. A team shows Mixed when its members differ. One long name checks the phone layout (EVT2-10). Arrow keys move, Enter picks, Escape closes. A bottom sheet on a phone.',
  render: () => <RosterPickerDemo />,
};
