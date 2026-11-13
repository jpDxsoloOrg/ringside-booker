import { useId, useMemo, useState } from 'react';
import type {
  LabWorkerRow,
  LabWorkerScope,
  LabWorkerTraitFilter,
  PromotionId,
  RegionId,
} from '@ringside/engine';
import {
  LAB_WORKER_TRAIT_FILTERS,
  LAB_WORKERS_MAX_SEARCH,
  STYLE_LABELS,
  TRAIT_LABELS,
} from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatNumber, formatPopularity } from '@/components/format';
import { Icon } from '@/components/Icon';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
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

/** The trait filter's "no filter" value. */
export const ANY_TRAIT = 'any';

/** The picker's trait filter (MTCH4-05): find teachers, fast learners, durable or injury-prone workers. */
export const TRAIT_FILTER_OPTIONS: readonly SelectOption[] = [
  { value: ANY_TRAIT, label: 'Any trait' },
  ...LAB_WORKER_TRAIT_FILTERS.map((trait) => ({ value: trait, label: TRAIT_LABELS[trait] })),
];

function traitFilterOf(value: string): LabWorkerTraitFilter | null {
  return LAB_WORKER_TRAIT_FILTERS.find((trait) => trait === value) ?? null;
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
    id: 'safety',
    header: 'Safety',
    cell: (row) => formatNumber(row.safety),
    sortValue: (row) => row.safety,
    numeric: true,
    card: 'stat',
    width: 'xs',
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
  /** The trait filter the sheet opens with (MTCH4-05); any trait when left out. */
  readonly traitFilter?: LabWorkerTraitFilter | null;
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
  traitFilter = null,
}: WorkerPickerSheetProps) {
  const open = side !== null;
  // The sheet keeps its last side while it slides away, so its title doesn't jump.
  const [shownSide, setShownSide] = useState(side ?? 0);
  if (side !== null && side !== shownSide) setShownSide(side);

  const [scope, setScope] = useState<LabWorkerScope>(promotionId === null ? 'everyone' : 'mine');
  const [search, setSearch] = useState('');
  const [trait, setTrait] = useState<LabWorkerTraitFilter | null>(traitFilter);
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
      ...(trait === null ? {} : { trait }),
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
      <Select
        label="Trait"
        options={TRAIT_FILTER_OPTIONS}
        value={trait ?? ANY_TRAIT}
        onValueChange={(value) => {
          setTrait(traitFilterOf(value));
        }}
        className={styles['pickerTrait'] ?? ''}
      />
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
        density="compact"
        loading={list.status === 'loading'}
        onActivate={pick}
        emptyState={
          <EmptyState
            icon="user-search"
            title={
              trimmed !== ''
                ? 'Nobody by that name'
                : trait !== null
                  ? `Nobody here is ${TRAIT_LABELS[trait].toLowerCase()}`
                  : 'Nobody to list'
            }
            {...(trimmed === '' && trait === null
              ? {}
              : { body: 'Try another name or trait, or look at Everyone.' })}
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
