import { KpiCardGrid } from '@/components/KpiCard';
import { BroadcastIncomeCard } from '@/screens/networks/finances/BroadcastIncomeKpi';
import { galleryIncomeSummary } from '../fixtures/networks';
import type { GalleryEntry } from '../galleryEntry';

function BroadcastIncomeDemo() {
  return (
    <KpiCardGrid label="TV income examples">
      <BroadcastIncomeCard summary={galleryIncomeSummary} />
      <BroadcastIncomeCard
        summary={{ ...galleryIncomeSummary, total: -3_879_000, lastAiring: null }}
      />
    </KpiCardGrid>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'broadcast-income-kpi',
  title: 'TV income card',
  group: 'Data',
  notes:
    'The Finances Overview card (ECO8-06): TV, streaming and pay-per-view money over the last 30 ' +
    'days, income less airtime, with its Why?, the last airing against what the network expected, ' +
    'and a link to Networks. The second card is a promotion whose deals lose money.',
  render: () => <BroadcastIncomeDemo />,
};
