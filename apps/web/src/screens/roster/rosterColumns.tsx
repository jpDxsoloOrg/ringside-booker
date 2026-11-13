import { PUSH_LEVELS } from '@ringside/engine';
import type { RosterRoleGroup, RosterRow } from '@ringside/engine';
import { AlignmentChip } from '@/components/AlignmentChip';
import { AVAILABILITY_LABELS, AvailabilityChip } from '@/components/AvailabilityChip';
import { Badge } from '@/components/Badge';
import type { ColumnDef, SortState } from '@/components/DataTable';
import {
  formatDaysAway,
  formatGameDate,
  formatNumber,
  formatPopularity,
  roundPopularity,
} from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import type { ImageSubject } from '@/components/ImageSlot';
import { VisuallyHidden } from '@/components/layout';
import { Explained, LazyWhyButton } from '@/components/Trace';
import { WorkerLink } from '@/components/WorkerLink';
import { NO_VALUE, pushLabel } from './labels';
import { PushGapMarker } from './PushGapMarker';
import styles from './RosterScreen.module.css';

/** What the Momentum cell shows before a worker's first appearance under the contract. */
export const NO_MOMENTUM = '–';

/** What Contract ends shows for a contract with no end date. */
export const OPEN_ENDED = 'Open-ended';

function portraitOf(row: RosterRow): ImageSubject {
  return {
    kind: 'person',
    id: row.personId,
    name: row.ringName,
    ...(row.imageRef === null ? {} : { imageRef: row.imageRef }),
  };
}

/** The sentence a screen reader hears for the Expects cell. */
export function expectsSentence(row: RosterRow): string {
  if (row.expectedPush === null) return NO_VALUE;
  const expects = `Expects ${pushLabel(row.expectedPush)}`;
  switch (row.pushGap?.verdict) {
    case 'expectsMore':
      return `${expects} — expects more than ${pushLabel(row.push)}`;
    case 'aboveExpected':
      return `${expects} — pushed above that, at ${pushLabel(row.push)}`;
    case 'asExpected':
    case undefined:
      return expects;
  }
}

function ExpectsCell({ row }: { readonly row: RosterRow }) {
  if (row.expectedPush === null || row.pushGap === null) {
    return <span className={styles['none']}>{NO_VALUE}</span>;
  }
  const expected = pushLabel(row.expectedPush);
  return (
    <span className={styles['explained']}>
      <span className={styles['expects']}>
        <span aria-hidden>{expected}</span>
        <PushGapMarker verdict={row.pushGap.verdict} />
        <VisuallyHidden>{expectsSentence(row)}</VisuallyHidden>
      </span>
      <LazyWhyButton
        label={`${row.ringName}'s expected push`}
        value={expected}
        panelTitle={`${row.ringName} expects: ${expected}`}
        queryName="roster.explain"
        args={{ employmentId: row.employmentId, metric: 'pushGap' }}
      />
    </span>
  );
}

function OverallCell({ row }: { readonly row: RosterRow }) {
  // Whole numbers, as on the workers list and the profile, so a person reads the same everywhere.
  const rounded = Math.round(row.overall.value);
  return (
    <span className={styles['explained']}>
      <span className="tabular">{formatNumber(rounded)}</span>
      <Badge tone="data" className={styles['grade']}>
        {row.overall.grade}
      </Badge>
      <LazyWhyButton
        label={`${row.ringName} overall`}
        value={rounded}
        queryName="roster.explain"
        args={{ employmentId: row.employmentId, metric: 'overall' }}
      />
    </span>
  );
}

function PopularityCell({ row }: { readonly row: RosterRow }) {
  const shown = roundPopularity(row.popularity);
  return (
    <span className={styles['explained']}>
      <span className="tabular">{formatPopularity(shown)}</span>
      <LazyWhyButton
        label={`${row.ringName} popularity`}
        value={shown}
        queryName="roster.explain"
        args={{ employmentId: row.employmentId, metric: 'popularity' }}
      />
    </span>
  );
}

/**
 * The Momentum cell: "–" until the first appearance under the contract, then the stored value with
 * a Why? when the momentum door left a trace. WRK5 replaces this one function with its meter.
 */
export function momentumCell(row: RosterRow) {
  const { value, traceRef } = row.momentum;
  if (value === null) return <span className={styles['none']}>{NO_MOMENTUM}</span>;
  return <Explained value={value} label={`${row.ringName} momentum`} traceRef={traceRef} />;
}

/**
 * The Morale cell: the stored value, with a Why? when the morale door left a trace. WRK8 replaces
 * this one function if it needs more than the trace.
 */
export function moraleCell(row: RosterRow) {
  const { value, traceRef } = row.morale;
  return <Explained value={value} label={`${row.ringName} morale`} traceRef={traceRef} />;
}

function ContractEndsCell({ row }: { readonly row: RosterRow }) {
  if (row.endsOn === null || row.daysLeft === null) {
    return <span className={styles['none']}>{OPEN_ENDED}</span>;
  }
  return (
    <span className={styles['ends']}>
      <span className="tabular">{formatGameDate(row.endsOn)}</span>
      <span className={styles['endsIn']}>{formatDaysAway(row.daysLeft)}</span>
    </span>
  );
}

const PORTRAIT: ColumnDef<RosterRow> = {
  id: 'portrait',
  header: 'Picture',
  cell: (row) => <ImageSlot subject={portraitOf(row)} size="sm" decorative />,
  width: 'xs',
  card: 'media',
};

const RING_NAME: ColumnDef<RosterRow> = {
  id: 'ringName',
  header: 'Name',
  cell: (row) => (
    <span className={styles['name']}>
      <WorkerLink personId={row.personId} name={row.ringName} truncate />
    </span>
  ),
  sortValue: (row) => row.ringName,
  width: 'lg',
  card: 'title',
};

const ALIGNMENT: ColumnDef<RosterRow> = {
  id: 'alignment',
  header: 'Alignment',
  cell: (row) => <AlignmentChip alignment={row.alignment} size="sm" />,
  sortValue: (row) => row.alignment,
  filterValue: () => null,
  card: 'subtitle',
};

const PUSH: ColumnDef<RosterRow> = {
  id: 'push',
  header: 'Push',
  cell: (row) => pushLabel(row.push),
  sortValue: (row) => PUSH_LEVELS.indexOf(row.push),
  filterValue: () => null,
  card: 'stat',
};

const EXPECTS: ColumnDef<RosterRow> = {
  id: 'expects',
  header: 'Expects',
  cell: (row) => <ExpectsCell row={row} />,
  // The furthest below what they expect first when sorted high to low.
  sortValue: (row) => row.pushGap?.steps ?? null,
  numeric: true,
  align: 'start',
  card: 'stat',
};

const OVERALL: ColumnDef<RosterRow> = {
  id: 'overall',
  header: 'Overall',
  cell: (row) => <OverallCell row={row} />,
  sortValue: (row) => row.overall.value,
  numeric: true,
  card: 'stat',
};

const POPULARITY: ColumnDef<RosterRow> = {
  id: 'popularity',
  header: 'Popularity',
  cardLabel: 'Pop.',
  cell: (row) => <PopularityCell row={row} />,
  sortValue: (row) => row.popularity,
  numeric: true,
  card: 'stat',
};

const MOMENTUM: ColumnDef<RosterRow> = {
  id: 'momentum',
  header: 'Momentum',
  cell: momentumCell,
  sortValue: (row) => row.momentum.value,
  numeric: true,
  card: 'stat',
};

const MORALE: ColumnDef<RosterRow> = {
  id: 'morale',
  header: 'Morale',
  cell: moraleCell,
  sortValue: (row) => row.morale.value,
  numeric: true,
  card: 'stat',
};

const AVAILABILITY: ColumnDef<RosterRow> = {
  id: 'availability',
  header: 'Availability',
  cell: (row) => (
    <AvailabilityChip
      availability={{
        status: row.availability.status,
        reason: row.availability.reason ?? AVAILABILITY_LABELS[row.availability.status],
        until: row.availability.until,
      }}
    />
  ),
  sortValue: (row) => AVAILABILITY_LABELS[row.availability.status],
  filterValue: () => null,
  card: 'meta',
};

const CONTRACT_ENDS: ColumnDef<RosterRow> = {
  id: 'contractEnds',
  header: 'Contract ends',
  cell: (row) => <ContractEndsCell row={row} />,
  sortValue: (row) => row.daysLeft,
  numeric: true,
  align: 'start',
  card: 'meta',
};

/**
 * The wrestlers' columns. On a phone card the stats are Push, Expects, Overall, Popularity,
 * Momentum and Morale (six, the card's most), with availability and the contract's end below.
 */
const WRESTLER_COLUMNS: readonly ColumnDef<RosterRow>[] = [
  PORTRAIT,
  RING_NAME,
  ALIGNMENT,
  PUSH,
  EXPECTS,
  OVERALL,
  POPULARITY,
  MOMENTUM,
  MORALE,
  AVAILABILITY,
  CONTRACT_ENDS,
];

/** Managers and crew have no card position, so no Push or Expects. */
const CREW_COLUMNS: readonly ColumnDef<RosterRow>[] = WRESTLER_COLUMNS.filter(
  (column) => column !== PUSH && column !== EXPECTS,
);

/**
 * The columns of one roster section, the same array on every call (the DataTable README asks for
 * stable columns). WRK2-05 adds its row-menu column here, at the end of both lists.
 */
export function columnsFor(group: RosterRoleGroup): readonly ColumnDef<RosterRow>[] {
  return group === 'wrestlers' ? WRESTLER_COLUMNS : CREW_COLUMNS;
}

/** Wrestlers open at the top of the card first; everyone else by name. */
export function initialSortFor(group: RosterRoleGroup): SortState {
  return group === 'wrestlers'
    ? { columnId: PUSH.id, direction: 'asc' }
    : { columnId: RING_NAME.id, direction: 'asc' };
}

const nameOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * The order of two rows the sort leaves equal (the same push, the same morale): by ring name in
 * natural order, as `roster.rows` orders them. The table settles what is still equal by row id.
 */
export function compareRosterTies(left: RosterRow, right: RosterRow): number {
  return nameOrder.compare(left.ringName, right.ringName);
}
