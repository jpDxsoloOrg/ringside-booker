import { Stack } from '@/components/layout';
import { WorldClockPanel } from '@/screens/office/panels/worldClockPanel';
import { galleryClockInSeason, galleryClockNoSeason } from '../fixtures/officeDashboard';
import type { GalleryEntry } from '../galleryEntry';

function WorldClockPanelDemo() {
  return (
    <Stack gap={4}>
      <WorldClockPanel clock={galleryClockInSeason} />
      <WorldClockPanel clock={galleryClockNoSeason} />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'world-clock-panel',
  title: 'World clock panel',
  group: 'Office',
  notes:
    "office.dashboard's clock: the long date, the day of the game, the season's week and days " +
    'left (or "No season running") and the next weekly report. Dates only, never a time of day.',
  render: () => <WorldClockPanelDemo />,
};
