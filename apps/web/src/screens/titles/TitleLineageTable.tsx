import type { ReignRow } from '@ringside/engine';
import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import type { ColumnDef } from '@/components/DataTable';
import { formatGameDate, formatNumber } from '@/components/format';
import { formatReignDays } from '@/components/ChampionCard';
import { WhyButton } from '@/components/Trace';
import { WorkerLink } from '@/components/WorkerLink';
import styles from './Titles.module.css';

/** What the Lost column says for the reign that is still going. */
export const CURRENT_REIGN_TEXT = 'Current';

/** What a reign of 0 days says: it began today. */
export const WON_TODAY_TEXT = 'Won today';

/** The lineage of a title nobody has held yet. */
export const NO_REIGNS_TEXT = 'No champions yet';

/** "142 days", or "Won today" for a reign that began today. */
export function reignDaysText(days: number): string {
  return days === 0 ? WON_TODAY_TEXT : formatReignDays(days);
}

/** Whether the lineage names the reign by a team (its label differs from the holders' names). */
function namedByTeam(reign: ReignRow): boolean {
  return reign.teamId !== null && reign.holders.length > 1;
}

/** One champion of a reign: the name they held it under, with "now <ring name>" if it changed. */
function HolderName({ holder }: { readonly holder: ReignRow['holders'][number] }) {
  const renamed = holder.currentRingName !== holder.nameAtTime;
  return (
    <span className={styles['holder']}>
      <WorkerLink personId={holder.personId} name={holder.nameAtTime} />
      {renamed && <span className={styles['muted']}>{`now ${holder.currentRingName}`}</span>}
    </span>
  );
}

/** The champions of a reign: the team's name over its members, or each holder's name. */
export function ReignChampions({ reign }: { readonly reign: ReignRow }) {
  return (
    <span className={styles['champions']}>
      {namedByTeam(reign) && <span className={styles['teamName']}>{reign.label}</span>}
      {reign.holders.map((holder) => (
        <HolderName key={holder.personId} holder={holder} />
      ))}
    </span>
  );
}

/** Days held with its Why?: how the days were counted. */
function DaysHeld({ reign }: { readonly reign: ReignRow }) {
  const text = reignDaysText(reign.daysHeld);
  return (
    <span className={styles['explained']}>
      <span className="tabular">{text}</span>
      <WhyButton
        label="Days held"
        value={text}
        buttonLabel={`Why? Days held in reign ${String(reign.number)}`}
        panelTitle={`Days held: ${reign.label}`}
        source={{ trace: reign.daysHeldTrace }}
      />
    </span>
  );
}

/** How the reign ended, with a Why? when the engine kept the reason (a vacancy). */
function HowItEnded({ reign }: { readonly reign: ReignRow }) {
  return (
    <span className={styles['explained']}>
      <span>{reign.endReasonLabel}</span>
      {reign.endTraceRef !== null && (
        <WhyButton
          label="How it ended"
          value={reign.endReasonLabel}
          buttonLabel={`Why? How reign ${String(reign.number)} ended`}
          panelTitle={`How it ended: ${reign.label}`}
          source={{ traceRef: reign.endTraceRef }}
        />
      )}
    </span>
  );
}

const LINEAGE_COLUMNS: readonly ColumnDef<ReignRow>[] = [
  {
    id: 'number',
    header: '#',
    cardLabel: 'Reign',
    card: 'meta',
    numeric: true,
    cell: (reign) => formatNumber(reign.number),
  },
  {
    id: 'champions',
    header: 'Champion(s)',
    card: 'title',
    cell: (reign) => <ReignChampions reign={reign} />,
    filterValue: (reign) => reign.label,
  },
  {
    id: 'won',
    header: 'Won',
    card: 'subtitle',
    cell: (reign) => (
      <time dateTime={reign.wonOn}>
        <span className={styles['cardOnly']}>Won </span>
        {formatGameDate(reign.wonOn)}
      </time>
    ),
  },
  {
    id: 'lost',
    header: 'Lost',
    card: 'subtitle',
    cell: (reign) =>
      reign.lostOn === null ? (
        CURRENT_REIGN_TEXT
      ) : (
        <time dateTime={reign.lostOn}>
          <span className={styles['cardOnly']}>Lost </span>
          {formatGameDate(reign.lostOn)}
        </time>
      ),
  },
  {
    id: 'days',
    header: 'Days held',
    cardLabel: 'Days',
    card: 'stat',
    cell: (reign) => <DaysHeld reign={reign} />,
  },
  {
    id: 'defences',
    header: 'Defences',
    card: 'stat',
    numeric: true,
    cell: (reign) => formatNumber(reign.defences),
  },
  {
    id: 'ended',
    header: 'How it ended',
    card: 'meta',
    cell: (reign) => <HowItEnded reign={reign} />,
  },
];

function reignId(reign: ReignRow): string {
  return reign.reignId;
}

export interface TitleLineageTableProps {
  /** Newest first, as `titles.detail` gives them. The order is fixed: no sorting. */
  readonly reigns: readonly ReignRow[];
  readonly titleName: string;
}

/**
 * A title's lineage, newest first: the reign's number, its champions (the names they held it
 * under, "now <ring name>" when that changed, the team's name for a tag reign), won and lost dates
 * ("Current" for the reign still going), days held and how the reign ended, each with its Why?,
 * and defences. A table on desktop, a card per reign on a phone.
 */
export function TitleLineageTable({ reigns, titleName }: TitleLineageTableProps) {
  return (
    <DataTable
      rows={reigns}
      columns={LINEAGE_COLUMNS}
      getRowId={reignId}
      caption={`Lineage of the ${titleName}`}
      sortable={false}
      density="compact"
      className={styles['lineage']}
      emptyState={
        <EmptyState
          icon="titles"
          headingLevel={3}
          title={NO_REIGNS_TEXT}
          body="Every reign shows here once someone holds the title."
        />
      }
    />
  );
}
