import { useState } from 'react';
import { AlignmentChip } from '@/components/AlignmentChip';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { DeltaChip } from '@/components/DeltaChip';
import { ImageSlot } from '@/components/ImageSlot';
import { Stack } from '@/components/layout';
import { Panel } from '@/components/Panel';
import { galleryRosterLeaders } from '../fixtures/office';
import type { GalleryRosterLeader } from '../fixtures/office';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

const leaderColumns: readonly ColumnDef<GalleryRosterLeader>[] = [
  {
    id: 'avatar',
    header: 'Picture',
    cell: (leader) => (
      <ImageSlot
        subject={{ kind: 'person', id: leader.id, name: leader.name }}
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
    header: 'Wrestler',
    cell: (leader) => leader.name,
    sortValue: (leader) => leader.name,
    width: 'md',
    card: 'title',
  },
  {
    id: 'alignment',
    header: 'Side',
    cell: (leader) => <AlignmentChip alignment={leader.alignment} size="sm" />,
    sortValue: (leader) => leader.alignment,
    width: 'sm',
    card: 'subtitle',
  },
  {
    id: 'position',
    header: 'Role',
    cell: (leader) => leader.cardPosition,
    sortValue: (leader) => leader.cardPosition,
    width: 'sm',
    card: 'subtitle',
  },
  {
    id: 'popularity',
    header: 'Pop',
    cell: (leader) => leader.popularity,
    sortValue: (leader) => leader.popularity,
    numeric: true,
    width: 'xs',
    card: 'stat',
  },
  {
    id: 'momentum',
    header: 'Mom',
    cardLabel: 'Momentum',
    cell: (leader) => <DeltaChip value={leader.momentum} variant="plain" />,
    sortValue: (leader) => leader.momentum,
    numeric: true,
    width: 'xs',
    card: 'stat',
  },
  {
    id: 'morale',
    header: 'Morale',
    cell: (leader) => leader.morale,
    sortValue: (leader) => leader.morale,
    numeric: true,
    width: 'xs',
    card: 'stat',
  },
  {
    id: 'contract',
    header: 'Deal',
    cardLabel: 'Deal left',
    cell: (leader) => `${String(leader.contractMonths)} mos`,
    sortValue: (leader) => leader.contractMonths,
    numeric: true,
    width: 'sm',
    card: 'stat',
  },
];

const getLeaderId = (leader: GalleryRosterLeader): string => leader.id;

function StatTableDemo() {
  const [striped, setStriped] = useState(true);
  return (
    <Stack gap={4}>
      <label className={styles['toggle']}>
        <input
          type="checkbox"
          checked={striped}
          onChange={(event) => {
            setStriped(event.target.checked);
          }}
        />
        Zebra rows
      </label>
      <Panel title="Roster analytics leaders" padding="none" headingLevel={3}>
        <DataTable
          rows={galleryRosterLeaders}
          columns={leaderColumns}
          getRowId={getLeaderId}
          caption="Roster analytics leaders"
          density="compact"
          striped={striped}
          initialSort={{ columnId: 'popularity', direction: 'desc' }}
        />
      </Panel>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'stat-table',
  title: 'Stat table',
  group: 'Office',
  notes:
    'The office look of DataTable: condensed capital headers over a strong hairline, hover on the hover surface, optional zebra rows (striped), tabular numbers on the right. On a phone the rows become stacked cards.',
  render: () => <StatTableDemo />,
};
