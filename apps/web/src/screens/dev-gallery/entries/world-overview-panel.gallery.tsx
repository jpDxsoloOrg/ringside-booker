import { WorldOverviewPanel } from '@/screens/office/panels/worldOverviewPanel';
import { galleryWorldOverview } from '../fixtures/officeDashboard';
import type { GalleryEntry } from '../galleryEntry';

export const galleryEntry: GalleryEntry = {
  id: 'world-overview-panel',
  title: 'World overview panel',
  group: 'Office',
  notes:
    "office.dashboard's worldOverview, for a seat that runs no promotion: every promotion's " +
    'public facts, most popular first, with the totals above. No cash and no morale. On a phone ' +
    'each promotion is a card.',
  render: () => <WorldOverviewPanel overview={galleryWorldOverview} />,
};
