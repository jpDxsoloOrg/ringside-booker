import { STYLE_LABELS } from '@ringside/engine';
import type { WorkerRow } from '@ringside/engine';
import { AvailabilityChip } from '@/components/AvailabilityChip';
import { Badge } from '@/components/Badge';
import type { ColumnDef } from '@/components/DataTable';
import { formatNumber, formatPopularity, roundPopularity } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import type { ImageSubject } from '@/components/ImageSlot';
import { LazyWhyButton } from '@/components/Trace';
import { WorkerLink } from '@/components/WorkerLink';
import { FREE_AGENT_LABEL, WORKER_ROLE_LABELS } from './workerLabels';
import styles from './WorkersScreen.module.css';

/** What a cell shows where there is nothing to show. */
const NONE = '—';

function portraitOf(row: WorkerRow): ImageSubject {
  return {
    kind: 'person',
    id: row.personId,
    name: row.ringName,
    ...(row.imageRef === null ? {} : { imageRef: row.imageRef }),
  };
}

function NameCell({ row }: { readonly row: WorkerRow }) {
  return (
    <span className={styles['name']}>
      <WorkerLink personId={row.personId} name={row.ringName} truncate />
      {row.legalName !== row.ringName && (
        <span className={styles['legalName']}>{row.legalName}</span>
      )}
    </span>
  );
}

function RolesCell({ row }: { readonly row: WorkerRow }) {
  return (
    <span className={styles['chips']}>
      {row.roles.map((role) => (
        <Badge key={role}>{WORKER_ROLE_LABELS[role]}</Badge>
      ))}
    </span>
  );
}

function OverallCell({ row }: { readonly row: WorkerRow }) {
  const rounded = Math.round(row.overall);
  return (
    <span className={styles['explained']}>
      <span className="tabular">{formatNumber(rounded)}</span>
      <Badge tone="data" className={styles['grade']}>
        {row.grade}
      </Badge>
      <LazyWhyButton
        label={`${row.ringName} overall`}
        value={rounded}
        queryName="workers.explain"
        args={{ personId: row.personId, metric: 'overall' }}
      />
    </span>
  );
}

function PopularityCell({ row }: { readonly row: WorkerRow }) {
  const top = row.topPopularity;
  if (top === null) return <span className={styles['none']}>{NONE}</span>;
  const shown = roundPopularity(top.value);
  return (
    <span className={styles['explained']}>
      <span className="tabular">{`${formatPopularity(shown)} · ${top.countryName}`}</span>
      <LazyWhyButton
        label={`${row.ringName} popularity in ${top.countryName}`}
        value={shown}
        queryName="workers.explain"
        args={{ personId: row.personId, metric: 'topPopularity' }}
      />
    </span>
  );
}

/**
 * The workers list's columns, for the desktop table and the phone cards alike. Module level, so
 * the array is the same on every render. The sortable ids are the ones `workersListParams` allows
 * in the URL.
 */
export const WORKER_COLUMNS: readonly ColumnDef<WorkerRow>[] = [
  {
    id: 'portrait',
    header: 'Picture',
    cell: (row) => <ImageSlot subject={portraitOf(row)} size="sm" decorative />,
    width: 'xs',
    card: 'media',
  },
  {
    id: 'ringName',
    header: 'Name',
    cell: (row) => <NameCell row={row} />,
    sortValue: (row) => row.ringName,
    filterValue: (row) => `${row.ringName} ${row.legalName}`,
    width: 'lg',
    card: 'title',
  },
  {
    id: 'roles',
    header: 'Roles',
    cell: (row) => <RolesCell row={row} />,
    filterValue: (row) => row.roles.map((role) => WORKER_ROLE_LABELS[role]).join(' '),
    card: 'meta',
  },
  {
    id: 'age',
    header: 'Age',
    cell: (row) => formatNumber(row.age),
    sortValue: (row) => row.age,
    numeric: true,
    width: 'xs',
    card: 'stat',
  },
  {
    id: 'style',
    header: 'Style',
    cell: (row) => STYLE_LABELS[row.style],
    sortValue: (row) => STYLE_LABELS[row.style],
    card: 'meta',
  },
  {
    id: 'overall',
    header: 'Overall',
    cell: (row) => <OverallCell row={row} />,
    sortValue: (row) => row.overall,
    numeric: true,
    card: 'stat',
  },
  {
    id: 'popularity',
    header: 'Top popularity',
    cardLabel: 'Top pop.',
    cell: (row) => <PopularityCell row={row} />,
    sortValue: (row) => row.topPopularity?.value ?? null,
    numeric: true,
    card: 'stat',
  },
  {
    id: 'employer',
    header: 'Employer',
    cell: (row) => row.employer?.name ?? FREE_AGENT_LABEL,
    sortValue: (row) => row.employer?.name ?? null,
    filterValue: (row) => row.employer?.name ?? FREE_AGENT_LABEL,
    card: 'subtitle',
  },
  {
    id: 'availability',
    header: 'Availability',
    cell: (row) => (
      <AvailabilityChip
        availability={{
          status: row.availability.status,
          reason: row.availability.label,
          until: row.availability.until,
        }}
      />
    ),
    card: 'meta',
  },
];

function lowerCaseOrder(left: string, right: string): number {
  const leftName = left.toLowerCase();
  const rightName = right.toLowerCase();
  if (leftName === rightName) return 0;
  return leftName < rightName ? -1 : 1;
}

/**
 * The order of two people the sort leaves equal (the same age, the same employer): by ring name,
 * as `workers.list` orders them, so the screen and the engine agree. The table settles what is
 * still equal by person id.
 */
export function compareWorkerTies(left: WorkerRow, right: WorkerRow): number {
  return lowerCaseOrder(left.ringName, right.ringName);
}
