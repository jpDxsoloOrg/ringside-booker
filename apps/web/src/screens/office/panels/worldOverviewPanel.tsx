import type { WorldOverview, WorldOverviewPromotion } from '@ringside/engine';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { formatNumber } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { Panel } from '@/components/Panel';
import styles from './officePanels.module.css';
import { registerOfficePanel } from './officePanelRegistry';

/** `12 promotions · 228 wrestlers under contract · 35 free agents`. */
export function worldTotalsLine(overview: WorldOverview): string {
  const count = (value: number, singular: string, plural: string): string =>
    `${formatNumber(value)} ${value === 1 ? singular : plural}`;
  return [
    count(overview.totals.promotions, 'promotion', 'promotions'),
    `${count(overview.totals.wrestlersUnderContract, 'wrestler', 'wrestlers')} under contract`,
    count(overview.freeAgents, 'free agent', 'free agents'),
  ].join(' · ');
}

/** Popularity as the Office shows it: one decimal. */
function popularityText(value: number): string {
  return formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const columns: readonly ColumnDef<WorldOverviewPromotion>[] = [
  {
    id: 'logo',
    header: 'Logo',
    cell: (row) => (
      <ImageSlot
        subject={{
          kind: 'promotion',
          id: row.promotionId,
          name: row.name,
          shortName: row.shortName,
          ...(row.logoRef === null ? {} : { imageRef: row.logoRef }),
        }}
        size="sm"
        decorative
      />
    ),
    width: 'xs',
    card: 'media',
    hideable: false,
  },
  {
    id: 'name',
    header: 'Promotion',
    cell: (row) => row.name,
    sortValue: (row) => row.name,
    width: 'lg',
    card: 'title',
  },
  {
    id: 'country',
    header: 'Home country',
    cell: (row) => row.homeCountryName,
    sortValue: (row) => row.homeCountryName,
    width: 'md',
    card: 'subtitle',
  },
  {
    id: 'popularity',
    header: 'Popularity',
    cell: (row) => popularityText(row.headline),
    sortValue: (row) => row.headline,
    numeric: true,
    width: 'sm',
    card: 'stat',
  },
  {
    id: 'prestige',
    header: 'Prestige',
    cell: (row) => formatNumber(row.prestige),
    sortValue: (row) => row.prestige,
    numeric: true,
    width: 'sm',
    card: 'stat',
  },
  {
    id: 'roster',
    header: 'Roster',
    cell: (row) => formatNumber(row.rosterSize),
    sortValue: (row) => row.rosterSize,
    numeric: true,
    width: 'sm',
    card: 'stat',
  },
];

const getRowId = (row: WorldOverviewPromotion): string => row.promotionId;

export interface WorldOverviewPanelProps {
  readonly overview: WorldOverview;
}

/**
 * Every promotion's public facts for a seat that runs none: name, home country, popularity,
 * prestige and roster size, most popular first, with the world's totals above. On a phone each
 * promotion is a card.
 */
export function WorldOverviewPanel({ overview }: WorldOverviewPanelProps) {
  return (
    <Panel title="Promotions" padding="none">
      <p className={styles['totals']}>{worldTotalsLine(overview)}</p>
      <DataTable
        rows={overview.promotions}
        columns={columns}
        getRowId={getRowId}
        getRowLabel={(row) => row.name}
        caption="Promotions in the world"
        density="compact"
        striped
      />
    </Panel>
  );
}

registerOfficePanel({
  id: 'day2.worldOverview',
  order: 20,
  column: 'main',
  requiresPromotion: false,
  render: ({ dashboard }) =>
    dashboard.worldOverview === null ? null : (
      <WorldOverviewPanel overview={dashboard.worldOverview} />
    ),
});
