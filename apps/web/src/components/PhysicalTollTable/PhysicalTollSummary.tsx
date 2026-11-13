import type { PhysicalPreviewPersonSummary, PhysicalPreviewSummary } from '@ringside/engine';
import { DataTable } from '../DataTable';
import type { ColumnDef } from '../DataTable';
import { EmptyState } from '../EmptyState';
import { formatNumber } from '../format';
import { KpiCard } from '../KpiCard';
import { WorkerLink } from '../WorkerLink';
import { learningText } from './PhysicalTollTable';
import styles from './PhysicalTollTable.module.css';
import { useNarrowerThan } from './useNarrowerThan';

/** The empty state before a batch. */
export const RUN_MANY_EMPTY_TITLE = 'Run x100 to see how often this match hurts someone';

/** The KPI's label. */
export const INJURIES_PER_100_LABEL = 'Injuries per 100 runs';

/** "Injuries: 3 in 100 runs". */
export function injuriesLine(summary: PhysicalPreviewSummary): string {
  const injuries = summary.byPerson.reduce((total, person) => total + person.injuries, 0);
  return `Injuries: ${formatNumber(injuries)} in ${formatNumber(summary.runs)} ${
    summary.runs === 1 ? 'run' : 'runs'
  }`;
}

const SUMMARY_COLUMNS: readonly ColumnDef<PhysicalPreviewPersonSummary>[] = [
  {
    id: 'worker',
    header: 'Worker',
    cell: (person) => (
      <WorkerLink personId={person.personId} name={person.name} className={styles['name']} />
    ),
    sortValue: (person) => person.name,
    card: 'title',
    width: 'lg',
  },
  {
    id: 'injuries',
    header: 'Injuries',
    cell: (person) => formatNumber(person.injuries),
    sortValue: (person) => person.injuries,
    numeric: true,
    card: 'stat',
  },
  {
    id: 'fatigueGain',
    header: 'Average fatigue gain',
    cardLabel: 'Fatigue gain',
    cell: (person) => formatNumber(person.meanFatigueGain, { maximumFractionDigits: 1 }),
    sortValue: (person) => person.meanFatigueGain,
    numeric: true,
    card: 'stat',
  },
  {
    id: 'wear',
    header: 'Average wear',
    cardLabel: 'Wear',
    cell: (person) => formatNumber(person.meanWearTotal, { maximumFractionDigits: 1 }),
    sortValue: (person) => person.meanWearTotal,
    numeric: true,
    card: 'stat',
  },
  {
    id: 'learning',
    header: 'Average learning',
    cardLabel: 'Learning',
    cell: (person) => learningText(person.meanLearning),
    sortValue: (person) => person.meanLearning,
    numeric: true,
    card: 'stat',
  },
];

function personId(person: PhysicalPreviewPersonSummary): string {
  return person.personId;
}

export interface PhysicalTollSummaryProps {
  /** The batch's physical summary, or null before a batch. */
  readonly summary: PhysicalPreviewSummary | null;
}

/**
 * How often a match hurts someone over a batch (MTCH4-05): a KPI of injuries per 100 runs and,
 * per worker, how many runs hurt them with their average fatigue gain, wear and learning. The
 * averages are worked out over the batch's runs, which the visible text says; each run's own Why?
 * is on the run shown in full.
 */
/** Below this width the averages table becomes one card per worker (40rem). */
export const SUMMARY_TABLE_MIN_WIDTH_PX = 640;

export function PhysicalTollSummary({ summary }: PhysicalTollSummaryProps) {
  const [containerRef, narrow] = useNarrowerThan(SUMMARY_TABLE_MIN_WIDTH_PX);
  if (summary === null) {
    return (
      <EmptyState
        icon="lab"
        headingLevel={3}
        title={RUN_MANY_EMPTY_TITLE}
        body="Set Runs to 100 and press Run. Every run rolls the wear and the injuries again, so many runs show how risky the match is."
      />
    );
  }
  const runsText = `${formatNumber(summary.runs)} ${summary.runs === 1 ? 'run' : 'runs'}`;
  return (
    <div ref={containerRef} className={styles['summary']}>
      <KpiCard
        label={INJURIES_PER_100_LABEL}
        value={formatNumber(summary.injuriesPer100, { maximumFractionDigits: 1 })}
        tone={summary.injuredSegments > 0 ? 'negative' : 'neutral'}
        icon="injured"
        footer={injuriesLine(summary)}
        className={styles['kpi']}
      />
      <p className={styles['summaryNote']}>
        {formatNumber(summary.injuredSegments)} of {runsText} hurt someone; every worker hurt counts
        once. The averages below are over the {runsText}, worker by worker.
      </p>
      <DataTable
        rows={summary.byPerson}
        columns={SUMMARY_COLUMNS}
        getRowId={personId}
        caption={`Each worker over ${runsText}`}
        density="compact"
        sortable={false}
        {...(narrow ? { layout: 'cards' as const } : {})}
      />
    </div>
  );
}
