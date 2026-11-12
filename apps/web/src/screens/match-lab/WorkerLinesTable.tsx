import { useMemo } from 'react';
import type { SegmentKind, WorkerLine } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { Explained, WhyButton } from '@/components/Trace';
import { sideLabel, staminaText } from './labText';
import styles from './MatchLab.module.css';
import { renderWorkerName } from './workerName';

/** What a cell shows where there is nothing to show. */
const NONE = '—';

function StaminaCell({ line }: { readonly line: WorkerLine }) {
  if (line.stamina === null) return <>{NONE}</>;
  const penalty = line.stamina.penalty.value;
  return (
    <span className={styles['stamina']}>
      <Badge tone={penalty === 0 ? 'positive' : 'negative'}>{staminaText(penalty)}</Badge>
      <WhyButton
        label={`${line.name}'s stamina penalty`}
        value={penalty}
        source={{ trace: line.stamina.penalty.trace }}
      />
    </span>
  );
}

/** The worker lines' columns: in-ring for a match, talk for a talking segment. */
function columnsFor(kind: SegmentKind): readonly ColumnDef<WorkerLine>[] {
  const performance: ColumnDef<WorkerLine> =
    kind === 'match'
      ? {
          id: 'inRing',
          header: 'In-ring',
          cell: (line) =>
            line.inRing === null ? (
              NONE
            ) : (
              <Explained
                label={`${line.name}'s in-ring`}
                value={line.inRing.value}
                trace={line.inRing.trace}
              />
            ),
          sortValue: (line) => line.inRing?.value ?? null,
          numeric: true,
          card: 'stat',
        }
      : {
          id: 'talk',
          header: 'Talk',
          cell: (line) =>
            line.talk === null ? (
              NONE
            ) : (
              <Explained
                label={`${line.name}'s talk`}
                value={line.talk.value}
                trace={line.talk.trace}
              />
            ),
          sortValue: (line) => line.talk?.value ?? null,
          numeric: true,
          card: 'stat',
        };
  const columns: ColumnDef<WorkerLine>[] = [
    {
      id: 'worker',
      header: 'Worker',
      cell: (line) => renderWorkerName(line.personId, line.name),
      sortValue: (line) => line.name,
      card: 'title',
      width: 'lg',
    },
    {
      id: 'side',
      header: 'Side',
      cell: (line) => sideLabel(line.side),
      sortValue: (line) => line.side,
      card: 'subtitle',
      width: 'sm',
    },
    performance,
    {
      id: 'entertainment',
      header: 'Entertainment',
      cardLabel: 'Ent.',
      cell: (line) => (
        <Explained
          label={`${line.name}'s entertainment`}
          value={line.entertainment.value}
          trace={line.entertainment.trace}
        />
      ),
      sortValue: (line) => line.entertainment.value,
      numeric: true,
      card: 'stat',
    },
  ];
  if (kind === 'match') {
    columns.push({
      id: 'stamina',
      header: 'Stamina check',
      cardLabel: 'Stamina',
      cell: (line) => <StaminaCell line={line} />,
      sortValue: (line) => line.stamina?.penalty.value ?? null,
      card: 'meta',
    });
  }
  columns.push(
    {
      id: 'popularity',
      header: 'Popularity',
      cardLabel: 'Pop.',
      cell: (line) => (
        <Explained
          label={`${line.name}'s popularity`}
          value={line.popularity.value}
          trace={line.popularity.trace}
        />
      ),
      sortValue: (line) => line.popularity.value,
      numeric: true,
      card: 'stat',
    },
    {
      id: 'momentum',
      header: 'Momentum',
      cell: (line) => (
        <Explained
          label={`${line.name}'s momentum`}
          value={line.momentum.value}
          trace={line.momentum.trace}
        />
      ),
      sortValue: (line) => line.momentum.value,
      numeric: true,
      card: 'stat',
    },
  );
  return columns;
}

function lineId(line: WorkerLine): string {
  return `${String(line.side)}-${line.personId}`;
}

export interface WorkerLinesTableProps {
  readonly kind: SegmentKind;
  readonly lines: readonly WorkerLine[];
}

/** Each worker's own numbers from the Run, every one with its Why?. */
export function WorkerLinesTable({ kind, lines }: WorkerLinesTableProps) {
  const columns = useMemo(() => columnsFor(kind), [kind]);
  return (
    <DataTable
      rows={lines}
      columns={columns}
      getRowId={lineId}
      caption="Each worker"
      density="compact"
      className={styles['linesTable']}
    />
  );
}
