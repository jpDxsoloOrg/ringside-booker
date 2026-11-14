import { Fragment } from 'react';
import type { PersonId, ReignRow, TitleRecord, TitleRecords, TitleStats } from '@ringside/engine';
import { EmptyState } from '@/components/EmptyState';
import { formatNumber } from '@/components/format';
import { Panel } from '@/components/Panel';
import { WorkerLink } from '@/components/WorkerLink';
import styles from './Titles.module.css';

export const NO_RECORDS_TEXT = 'No records yet';

type RecordKey = keyof TitleRecords;

/** How each record is named and what its number counts, in the order the panel lists them. */
const RECORD_ROWS: readonly {
  readonly key: RecordKey;
  readonly label: string;
  readonly unit: 'days' | 'defences' | 'reigns' | 'years';
}[] = [
  { key: 'longestReign', label: 'Longest reign', unit: 'days' },
  { key: 'shortestReign', label: 'Shortest reign', unit: 'days' },
  { key: 'mostDefences', label: 'Most defences in a reign', unit: 'defences' },
  { key: 'mostReigns', label: 'Most reigns', unit: 'reigns' },
  { key: 'mostCombinedDays', label: 'Most combined days', unit: 'days' },
  { key: 'oldestChampion', label: 'Oldest champion', unit: 'years' },
  { key: 'youngestChampion', label: 'Youngest champion', unit: 'years' },
];

const UNIT_WORDS: Readonly<Record<(typeof RECORD_ROWS)[number]['unit'], [string, string]>> = {
  days: ['day', 'days'],
  defences: ['defence', 'defences'],
  reigns: ['reign', 'reigns'],
  years: ['year old', 'years old'],
};

/** "142 days", "1 defence", "3 reigns", "41 years old". */
export function recordValueText(value: number, unit: (typeof RECORD_ROWS)[number]['unit']): string {
  const [one, many] = UNIT_WORDS[unit];
  return `${formatNumber(value)} ${value === 1 ? one : many}`;
}

/**
 * The names a record's people go by, from the lineage: the ring name they hold now, else the one
 * they won under. A person the lineage does not list keeps the record's own label.
 */
function namesFromLineage(reigns: readonly ReignRow[]): ReadonlyMap<PersonId, string> {
  const names = new Map<PersonId, string>();
  for (const reign of reigns) {
    for (const holder of reign.holders) {
      if (!names.has(holder.personId)) names.set(holder.personId, holder.currentRingName);
    }
  }
  return names;
}

function RecordHolders({
  record,
  names,
}: {
  readonly record: TitleRecord;
  readonly names: ReadonlyMap<PersonId, string>;
}) {
  if (record.personIds.length === 1) {
    const [personId] = record.personIds;
    if (personId !== undefined) {
      return <WorkerLink personId={personId} name={names.get(personId) ?? record.label} />;
    }
  }
  return (
    <span className={styles['champions']}>
      {record.personIds.map((personId, index) => (
        <Fragment key={personId}>
          {index > 0 && <span aria-hidden="true"> & </span>}
          <WorkerLink personId={personId} name={names.get(personId) ?? record.label} />
        </Fragment>
      ))}
    </span>
  );
}

export interface TitleRecordsPanelProps {
  readonly records: TitleRecords;
  readonly stats: TitleStats;
  /** The lineage, newest first: the names of the record holders come from it. */
  readonly reigns: readonly ReignRow[];
}

/**
 * A title's records: total reigns, different champions and days vacant, then the longest and
 * shortest reign, most defences in a reign, most reigns, most combined days and the oldest and
 * youngest champion, each name linking to the worker's profile. "No records yet" until a reign has
 * ended.
 */
export function TitleRecordsPanel({ records, stats, reigns }: TitleRecordsPanelProps) {
  const names = namesFromLineage(reigns);
  const anyFinished = reigns.some((reign) => reign.lostOn !== null);
  return (
    <Panel title="Records" headingLevel={2}>
      <dl className={styles['facts']}>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Total reigns</dt>
          <dd className="tabular">{formatNumber(stats.totalReigns)}</dd>
        </div>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Different champions</dt>
          <dd className="tabular">{formatNumber(stats.distinctChampions)}</dd>
        </div>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Days vacant</dt>
          <dd className="tabular">{formatNumber(stats.daysVacant)}</dd>
        </div>
      </dl>
      {anyFinished ? (
        <dl className={styles['records']}>
          {RECORD_ROWS.map(({ key, label, unit }) => {
            const record = records[key];
            if (record === null) return null;
            return (
              <div key={key} className={styles['record']}>
                <dt className={styles['factLabel']}>{label}</dt>
                <dd className={styles['recordValue']}>
                  <RecordHolders record={record} names={names} />
                  <span className={styles['recordNumber']}>
                    {recordValueText(record.value, unit)}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <EmptyState
          icon="titles"
          headingLevel={3}
          title={NO_RECORDS_TEXT}
          body="Records start once a reign has ended."
        />
      )}
    </Panel>
  );
}
