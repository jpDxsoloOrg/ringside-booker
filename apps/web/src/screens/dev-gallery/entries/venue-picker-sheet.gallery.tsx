import { useState } from 'react';
import type { VenueScope } from '@ringside/engine';
import { Button } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import { VenuePickerSheetView } from '@/screens/booking/venue/VenuePickerSheet';
import { choiceKey } from '@/screens/booking/venue/venueText';
import type { GalleryEntry } from '../galleryEntry';
import { countryVenueOptions, worldVenueOptions } from '../fixtures/venues';
import styles from './entries.module.css';

/** What Use this venue does in the demo: close, or show a refusal. */
type DemoOutcome = 'accept' | 'refuse';

const REFUSAL = 'This show can’t change venue any more';

function VenuePickerSheetDemo() {
  const [outcome, setOutcome] = useState<DemoOutcome | null>(null);
  const [scope, setScope] = useState<VenueScope>('country');
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const options = scope === 'world' ? worldVenueOptions : countryVenueOptions;
  const current = options.options.find((option) => option.current);
  const shown = selected ?? (current === undefined ? null : choiceKey(current.choice));

  const close = () => {
    setOutcome(null);
    setSelected(null);
    setMessage(null);
  };
  const answer = () => {
    if (outcome === 'refuse') setMessage(REFUSAL);
    else close();
  };

  return (
    <Stack gap={3}>
      <p className={styles['caption']}>
        Unavailable venues stay in the list with their reason: Tab and the arrow keys reach them,
        and they are announced as unavailable. Picking a row only selects it.
      </p>
      <Cluster gap={2}>
        <Button
          onClick={() => {
            setOutcome('accept');
          }}
        >
          Open the picker
        </Button>
        <Button
          onClick={() => {
            setOutcome('refuse');
          }}
        >
          Open, choice refused
        </Button>
      </Cluster>
      <VenuePickerSheetView
        open={outcome !== null}
        onClose={close}
        options={options}
        scope={scope}
        onScopeChange={setScope}
        selected={shown}
        onSelect={(key) => {
          setMessage(null);
          setSelected(key);
        }}
        onUse={answer}
        onPickForMe={answer}
        message={message}
      />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'venue-picker-sheet',
  title: 'Venue picker sheet',
  group: 'Overlays',
  notes:
    'The Change venue sheet (EVT6-06) from a fixed boxOffice.venues answer, with an exclusive, a taken and a closed venue. A full-height bottom sheet on a phone.',
  render: () => <VenuePickerSheetDemo />,
};
