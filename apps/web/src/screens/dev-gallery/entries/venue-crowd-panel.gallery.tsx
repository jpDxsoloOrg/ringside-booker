import type { ShowForecast } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { VenueCrowdView } from '@/screens/booking/venue/VenueCrowdPanel';
import type { GalleryEntry } from '../galleryEntry';
import {
  emptyForecast,
  genericForecast,
  goodFitForecast,
  notChosenForecast,
  sellOutForecast,
} from '../fixtures/venues';
import styles from './entries.module.css';
import venue from './venue.module.css';

interface PanelExample {
  readonly label: string;
  readonly forecast: ShowForecast;
  readonly canChange: boolean;
}

const EXAMPLES: readonly PanelExample[] = [
  { label: 'Good fit', forecast: goodFitForecast, canChange: true },
  {
    label: 'Likely sell-out, range capped by capacity',
    forecast: sellOutForecast,
    canChange: true,
  },
  { label: 'Will look empty', forecast: emptyForecast, canChange: true },
  { label: 'Generic local venue', forecast: genericForecast, canChange: true },
  { label: 'Not chosen yet', forecast: notChosenForecast, canChange: true },
  { label: 'Read-only (the show has run)', forecast: goodFitForecast, canChange: false },
];

function VenueCrowdPanelDemo() {
  return (
    <Stack gap={5}>
      {EXAMPLES.map((example) => (
        <section key={example.label} className={styles['example']}>
          <h3 className={styles['subheading']}>{example.label}</h3>
          <div className={venue['panelFrame']}>
            <VenueCrowdView
              forecast={example.forecast}
              canChange={example.canChange}
              onChangeVenue={() => undefined}
              onPickForMe={() => undefined}
            />
          </div>
        </section>
      ))}
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'venue-crowd-panel',
  title: 'Venue and crowd panel',
  group: 'Office',
  notes:
    'The booking screen side panel (EVT6-06), from fixed boxOffice.forecast answers. The Why? beside the range opens the forecast; while no venue is chosen, the Why? beside the name says why the game would pick it.',
  render: () => <VenueCrowdPanelDemo />,
};
