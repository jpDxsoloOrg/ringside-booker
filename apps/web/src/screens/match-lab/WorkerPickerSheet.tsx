import { useId, useMemo, useState } from 'react';
import type { LabWorkerRow, LabWorkerScope, PromotionId, RegionId } from '@ringside/engine';
import { LAB_WORKERS_MAX_SEARCH, STYLE_LABELS } from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatNumber, formatPopularity } from '@/components/format';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { Tab, TabList, TabPanel, Tabs } from '@/components/Tabs';
import { LAB_MAX_SIDE_SIZE, sideOf, useLabStore } from './labStore';
import { sideLabel } from './labText';
import styles from './MatchLab.module.css';

const NO_ROWS: readonly PickerRow[] = [];

/** A picker row with where the person already stands in the lab, if anywhere. */
interface PickerRow extends LabWorkerRow {
  readonly placedOn: number | null;
}

function isScope(value: string): value is LabWorkerScope {
  return value === 'mine' || value === 'everyone';
}

function AvailabilityCell({ row }: { readonly row: PickerRow }) {
  if (row.placedOn !== null) return <Badge tone="data">On {sideLabel(row.placedOn)}</Badge>;
  if (row.available) return <Badge tone="positive">Available</Badge>;
  return (
    <Badge tone="negative" className={styles['unavailable']}>
      <Icon name="injured" size="sm" decorative />
      {row.unavailableReason ?? 'Unavailable'}
    </Badge>
  );
}

const PICKER_COLUMNS: readonly ColumnDef<PickerRow>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: (row) => row.name,
    sortValue: (row) => row.name,
    card: 'title',
    width: 'lg',
  },
  {
    id: 'promotion',
    header: 'Promotion',
    cell: (row) => row.promotionShortName ?? 'Free agent',
    sortValue: (row) => row.promotionShortName ?? 'Free agent',
    card: 'subtitle',
    width: 'sm',
  },
  {
    id: 'style',
    header: 'Style',
    cell: (row) => STYLE_LABELS[row.style],
    sortValue: (row) => STYLE_LABELS[row.style],
    card: 'meta',
    width: 'md',
  },
  {
    id: 'popularity',
    header: 'Popularity',
    cardLabel: 'Pop.',
    cell: (row) => formatPopularity(row.popularity),
    sortValue: (row) => row.popularity,
    numeric: true,
    card: 'stat',
    width: 'sm',
  },
  {
    id: 'availability',
    header: 'Availability',
    cell: (row) => <AvailabilityCell row={row} />,
    sortValue: (row) =>
      row.placedOn !== null ? 'On side' : row.available ? 'Available' : 'Unavailable',
    card: 'meta',
    width: 'md',
  },
];

function rowId(row: PickerRow): string {
  return row.personId;
}

export interface WorkerPickerSheetProps {
  /** The side people are added to (0-based), or null while the sheet is closed. */
  readonly side: number | null;
  readonly regionId: RegionId;
  readonly promotionId: PromotionId | null;
  readonly onClose: () => void;
}

/**
 * Picks people for one side: the promotion's roster or everyone in the business, searchable, with
 * popularity in the show's region and whether they can work. Choosing a row adds that person and
 * keeps the sheet open for the next pick; someone already in the lab says which side they are on
 * and is not added twice. A side sheet on desktop, a bottom sheet on phones.
 */
export function WorkerPickerSheet({
  side,
  regionId,
  promotionId,
  onClose,
}: WorkerPickerSheetProps) {
  const open = side !== null;
  // The sheet keeps its last side while it slides away, so its title doesn't jump.
  const [shownSide, setShownSide] = useState(side ?? 0);
  if (side !== null && side !== shownSide) setShownSide(side);

  const [scope, setScope] = useState<LabWorkerScope>(promotionId === null ? 'everyone' : 'mine');
  const [search, setSearch] = useState('');
  const searchId = useId();
  const announce = useAnnounce();
  const sides = useLabStore((state) => state.sides);
  const addPerson = useLabStore((state) => state.addPerson);

  const trimmed = search.trim();
  const list = useEngineQuery(
    'match.labWorkers',
    {
      scope,
      regionId,
      ...(trimmed === '' ? {} : { search: trimmed }),
      ...(promotionId === null ? {} : { promotionId }),
    },
    { enabled: open },
  );
  const rows = useMemo<readonly PickerRow[]>(
    () =>
      list.data?.rows.map((row) => ({ ...row, placedOn: sideOf(sides, row.personId) })) ?? NO_ROWS,
    [list.data, sides],
  );
  const members = sides[shownSide]?.length ?? 0;
  const full = members >= LAB_MAX_SIDE_SIZE;

  const pick = (row: PickerRow): void => {
    if (row.placedOn !== null) {
      announce(`${row.name} is already on ${sideLabel(row.placedOn)}`);
      return;
    }
    if (full) {
      announce(`${sideLabel(shownSide)} is full`);
      return;
    }
    if (addPerson(shownSide, row)) announce(`Added ${row.name} to ${sideLabel(shownSide)}`);
  };

  const total = list.data?.total ?? 0;
  const shown = list.data?.rows.length ?? 0;

  // One listing, drawn in whichever tab panel is selected.
  const listing = (
    <>
      <div className={styles['pickerSearch']}>
        <label htmlFor={searchId} className={styles['pickerSearchLabel']}>
          Search by name
        </label>
        <div className={styles['pickerSearchWrap']}>
          <Icon name="search" size="sm" className={styles['pickerSearchIcon']} decorative />
          <input
            id={searchId}
            type="search"
            className={styles['pickerSearchInput']}
            value={search}
            maxLength={LAB_WORKERS_MAX_SEARCH}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && search !== '') {
                event.preventDefault();
                event.stopPropagation();
                setSearch('');
              }
            }}
          />
        </div>
      </div>
      {full && (
        <p className={styles['pickerNote']} role="status">
          {sideLabel(shownSide)} is full: remove someone to add another.
        </p>
      )}
      <DataTable
        rows={rows}
        columns={PICKER_COLUMNS}
        getRowId={rowId}
        caption={`People to add to ${sideLabel(shownSide)}`}
        sortable={false}
        density="compact"
        loading={list.status === 'loading'}
        onActivate={pick}
        emptyState={
          <EmptyState
            icon="user-search"
            title={trimmed === '' ? 'Nobody to list' : 'Nobody by that name'}
            {...(trimmed === '' ? {} : { body: 'Try another name, or look at Everyone.' })}
          />
        }
      />
      {total > shown && (
        <p className={styles['pickerNote']}>
          Showing the {shown} most popular of {formatNumber(total)}. Search to find anyone else.
        </p>
      )}
    </>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Add to ${sideLabel(shownSide)}`}
      side="right"
      size="lg"
      footer={
        <div className={styles['pickerFooter']}>
          <span className={styles['pickerCount']} aria-live="polite">
            {sideLabel(shownSide)}: {members} of {LAB_MAX_SIDE_SIZE}
          </span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className={styles['picker']}>
        <Tabs
          value={scope}
          onChange={(value) => {
            if (isScope(value)) setScope(value);
          }}
        >
          <TabList label="Who to list">
            <Tab value="mine" disabled={promotionId === null}>
              My roster
            </Tab>
            <Tab value="everyone">Everyone</Tab>
          </TabList>
          <TabPanel value="mine">
            <div className={styles['pickerPanel']}>{listing}</div>
          </TabPanel>
          <TabPanel value="everyone">
            <div className={styles['pickerPanel']}>{listing}</div>
          </TabPanel>
        </Tabs>
      </div>
    </Sheet>
  );
}
