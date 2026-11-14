import { useCallback, useId, useMemo, useState } from 'react';
import type {
  LabWorkerRow,
  LabWorkerScope,
  LabWorkerTraitFilter,
  PersonId,
  PersonRole,
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
import { WORKER_ROLE_LABELS } from '@/screens/workers/workerLabels';
import { LAB_MAX_SIDE_SIZE, sideOf, useLabStore } from './labStore';
import { sideLabel } from './labText';
import styles from './MatchLab.module.css';

const NO_ROWS: readonly PickerRow[] = [];

/** A picker row with where the person already stands in the lab, if anywhere. */
export interface PickerRow extends LabWorkerRow {
  /** "On Side 1", "In beat 2"; null when they are free to pick. */
  readonly placedLabel: string | null;
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
  if (row.placedLabel !== null) return <Badge tone="data">{row.placedLabel}</Badge>;
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
      row.placedLabel !== null ? 'On side' : row.available ? 'Available' : 'Unavailable',
    card: 'meta',
    width: 'md',
  },
];

function rowId(row: PickerRow): string {
  return row.personId;
}

/** The talking stats as picker columns (MTCH5-05): sort by Mic to find your best talker. */
export const TALK_COLUMNS: readonly ColumnDef<PickerRow>[] = [
  {
    id: 'mic',
    header: 'Mic',
    cell: (row) => formatNumber(row.mic),
    sortValue: (row) => row.mic,
    numeric: true,
    card: 'stat',
    width: 'xs',
  },
  {
    id: 'charisma',
    header: 'Charisma',
    cardLabel: 'Cha.',
    cell: (row) => formatNumber(row.charisma),
    sortValue: (row) => row.charisma,
    numeric: true,
    card: 'stat',
    width: 'xs',
  },
  {
    id: 'presence',
    header: 'Presence',
    cardLabel: 'Pres.',
    cell: (row) => formatNumber(row.presence),
    sortValue: (row) => row.presence,
    numeric: true,
    card: 'stat',
    width: 'xs',
  },
];

/** The picker's columns with the talking stats in place of style and safety. */
export function talkPickerColumns(): readonly ColumnDef<PickerRow>[] {
  return PICKER_COLUMNS.flatMap((column) => {
    if (column.id === 'style') {
      return [
        {
          id: 'role',
          header: 'Role',
          cell: (row: PickerRow) => roleText(row),
          sortValue: (row: PickerRow) => roleText(row),
          card: 'meta' as const,
          width: 'md' as const,
        },
      ];
    }
    if (column.id === 'safety') return TALK_COLUMNS;
    return [column];
  });
}

/** "Wrestler", "Manager, Presenter": what someone does. */
function roleText(row: PickerRow): string {
  return row.roles.map((role) => WORKER_ROLE_LABELS[role]).join(', ') || 'Nobody yet';
}

export interface PeoplePickerSheetProps {
  readonly open: boolean;
  /** The sheet's heading, such as "Add to Side 1". */
  readonly title: string;
  /** Names the list for screen readers. */
  readonly caption: string;
  readonly regionId: RegionId;
  readonly promotionId: PromotionId | null;
  readonly onClose: () => void;
  /** Adds the person; the sheet stays open unless `onClose` is called. */
  readonly onPick: (row: LabWorkerRow) => void;
  /** Where someone already stands, for their row's badge; null when they are free to pick. */
  readonly placedLabel: (row: LabWorkerRow) => string | null;
  /** Rows left out of the list altogether. */
  readonly exclude?: readonly PersonId[];
  /** The trait filter the sheet opens with (MTCH4-05); any trait when left out. */
  readonly traitFilter?: LabWorkerTraitFilter | null;
  /** Only people with this role, such as managers (MTCH5-05). */
  readonly personRole?: PersonRole | null;
  /** The table's columns; the match picker's by default. */
  readonly columns?: readonly ColumnDef<PickerRow>[];
  /** A note above the list, such as "Side 1 is full". */
  readonly note?: string | null;
  /** The footer's count, such as "Side 1: 2 of 15". */
  readonly count?: string | null;
}

/**
 * Picks people from the promotion's roster or everyone in the business, searchable, with
 * popularity in the show's region and whether they can work. A side sheet on desktop, a bottom
 * sheet on phones. The Match lab's sides use it as {@link WorkerPickerSheet}; Angle mode's beats
 * and manager menu use it with the talking stats (MTCH5-05).
 */
export function PeoplePickerSheet({
  open,
  title,
  caption,
  regionId,
  promotionId,
  onClose,
  onPick,
  placedLabel,
  exclude,
  traitFilter = null,
  personRole: role = null,
  columns = PICKER_COLUMNS,
  note = null,
  count = null,
}: PeoplePickerSheetProps) {
  const [scope, setScope] = useState<LabWorkerScope>(promotionId === null ? 'everyone' : 'mine');
  const [search, setSearch] = useState('');
  const [trait, setTrait] = useState<LabWorkerTraitFilter | null>(traitFilter);
  const searchId = useId();

  const trimmed = search.trim();
  const list = useEngineQuery(
    'match.labWorkers',
    {
      scope,
      regionId,
      ...(trimmed === '' ? {} : { search: trimmed }),
      ...(promotionId === null ? {} : { promotionId }),
      ...(trait === null ? {} : { trait }),
      ...(role === null ? {} : { role }),
    },
    { enabled: open },
  );
  const rows = useMemo<readonly PickerRow[]>(
    () =>
      list.data?.rows
        .filter((row) => !(exclude ?? []).includes(row.personId))
        .map((row) => ({ ...row, placedLabel: placedLabel(row) })) ?? NO_ROWS,
    [list.data, exclude, placedLabel],
  );

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
      {note !== null && (
        <p className={styles['pickerNote']} role="status">
          {note}
        </p>
      )}
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={rowId}
        caption={caption}
        density="compact"
        loading={list.status === 'loading'}
        onActivate={onPick}
        emptyState={
          <EmptyState
            icon="user-search"
            title={
              trimmed !== ''
                ? 'Nobody by that name'
                : trait !== null
                  ? `Nobody here is ${TRAIT_LABELS[trait].toLowerCase()}`
                  : role !== null
                    ? `No ${WORKER_ROLE_LABELS[role].toLowerCase()}s here`
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
      title={title}
      side="right"
      size="lg"
      footer={
        <div className={styles['pickerFooter']}>
          {count !== null && (
            <span className={styles['pickerCount']} aria-live="polite">
              {count}
            </span>
          )}
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

  const announce = useAnnounce();
  const sides = useLabStore((state) => state.sides);
  const addPerson = useLabStore((state) => state.addPerson);
  const members = sides[shownSide]?.length ?? 0;
  const full = members >= LAB_MAX_SIDE_SIZE;

  const placedLabel = useCallback(
    (row: LabWorkerRow): string | null => {
      const placedOn = sideOf(sides, row.personId);
      return placedOn === null ? null : `On ${sideLabel(placedOn)}`;
    },
    [sides],
  );

  const pick = (row: LabWorkerRow): void => {
    const placedOn = sideOf(sides, row.personId);
    if (placedOn !== null) {
      announce(`${row.name} is already on ${sideLabel(placedOn)}`);
      return;
    }
    if (full) {
      announce(`${sideLabel(shownSide)} is full`);
      return;
    }
    if (addPerson(shownSide, row)) announce(`Added ${row.name} to ${sideLabel(shownSide)}`);
  };

  return (
    <PeoplePickerSheet
      open={open}
      title={`Add to ${sideLabel(shownSide)}`}
      caption={`People to add to ${sideLabel(shownSide)}`}
      regionId={regionId}
      promotionId={promotionId}
      onClose={onClose}
      onPick={pick}
      placedLabel={placedLabel}
      traitFilter={traitFilter}
      note={full ? `${sideLabel(shownSide)} is full: remove someone to add another.` : null}
      count={`${sideLabel(shownSide)}: ${String(members)} of ${String(LAB_MAX_SIDE_SIZE)}`}
    />
  );
}
