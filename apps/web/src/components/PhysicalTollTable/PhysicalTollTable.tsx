import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { BodyPart, PersonId, PhysicalPreviewWorker } from '@ringside/engine';
import { BODY_PART_LABELS, BODY_PARTS } from '@ringside/engine';
import { useIsMobile } from '@/styles/useMediaQuery';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { classNames } from '../classNames';
import { DataTable } from '../DataTable';
import type { ColumnDef } from '../DataTable';
import { formatNumber } from '../format';
import { Popover } from '../Popover';
import { SegmentedMeter } from '../SegmentedMeter';
import { Select } from '../Select';
import type { SelectOption } from '../Select';
import { Explained, WhyButton } from '../Trace';
import { WorkerLink } from '../WorkerLink';
import styles from './PhysicalTollTable.module.css';

/** The what-if fatigue levels the Select offers besides "As now". */
export const FATIGUE_WHAT_IF_LEVELS: readonly number[] = [0, 25, 50, 75, 100];

/** The Select value for "use the stored fatigue". */
export const FATIGUE_AS_NOW = 'now';

/** The badge of a worker the roll hurt, one hurt past the limit, and one it didn't. */
export const INJURED_TEXT = 'Injured';
export const IGNORED_OVER_LIMIT_TEXT = 'Injured (limit reached, ignored)';
export const UNHURT_TEXT = 'OK';

/** The phone card's heading over everything but the name and the injury chance. */
export const PHYSICAL_CARD_HEADING = 'Physical';

/** "As now (n)" and the what-if levels. */
export function fatigueOptions(fatigueNow: number): readonly SelectOption[] {
  return [
    { value: FATIGUE_AS_NOW, label: `As now (${formatNumber(fatigueNow)})` },
    ...FATIGUE_WHAT_IF_LEVELS.map((level) => ({ value: String(level), label: String(level) })),
  ];
}

/** Learning reads as a gain: "+0.08". */
export function learningText(value: number): string {
  return `+${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface PhysicalTollTableProps {
  /** The competitors, in roll order (side, then the order they were added). */
  readonly workers: readonly PhysicalPreviewWorker[];
  /**
   * Called with a worker's new "Fatigue going in" what-if, or null for "As now". Left out, the
   * column shows the number without a Select (a stored show, the gallery's still rows).
   */
  readonly onFatigueChange?: (personId: PersonId, fatigue: number | null) => void;
  /** Turns the what-if Selects off, such as while a Run is on its way. */
  readonly disabled?: boolean;
  /** Names the table for screen readers. */
  readonly caption?: string;
  readonly className?: string;
}

interface CellProps {
  readonly worker: PhysicalPreviewWorker;
}

function FatigueGoingIn({ worker, onFatigueChange, disabled }: CellProps & ColumnOptions) {
  if (onFatigueChange === undefined) {
    return (
      <span className="tabular">
        {formatNumber(worker.fatigueBefore)}
        {worker.fatigueWhatIf && <span className={styles['whatIf']}> (what-if)</span>}
      </span>
    );
  }
  return (
    <Select
      label={`${worker.name}'s fatigue going in`}
      hideLabel
      className={styles['fatigueSelect'] ?? ''}
      options={fatigueOptions(worker.fatigueNow)}
      value={worker.fatigueWhatIf ? String(worker.fatigueBefore) : FATIGUE_AS_NOW}
      disabled={disabled}
      onValueChange={(value) => {
        onFatigueChange(worker.personId, value === FATIGUE_AS_NOW ? null : Number(value));
      }}
    />
  );
}

function FatigueGain({ worker }: CellProps) {
  return (
    <Explained
      label={`${worker.name}'s fatigue gain`}
      value={worker.fatigueGain.value}
      trace={worker.fatigueGain.trace}
    />
  );
}

function FatigueAfter({ worker }: CellProps) {
  return (
    <SegmentedMeter
      label={`${worker.name}'s fatigue after`}
      hideLabel
      value={worker.fatigueAfter}
      valueText={formatNumber(worker.fatigueAfter, { maximumFractionDigits: 1 })}
      dangerLabel="Exhausted"
      className={styles['meter']}
    />
  );
}

function partWear(worker: PhysicalPreviewWorker, part: BodyPart): ReactNode {
  const wear = worker.wearByPart[part];
  return (
    <Explained
      label={`${worker.name}'s ${BODY_PART_LABELS[part].toLowerCase()} wear`}
      value={wear.value}
      trace={wear.trace}
    />
  );
}

function Wear({ worker }: CellProps) {
  return (
    <span className={styles['wear']}>
      <Explained
        label={`${worker.name}'s condition lost`}
        value={worker.wearTotal.value}
        trace={worker.wearTotal.trace}
      />
      <Popover
        title={`${worker.name}: wear by body part`}
        trigger={
          <Button size="sm" variant="ghost" aria-label={`${worker.name}'s wear by body part`}>
            By part
          </Button>
        }
      >
        <dl className={styles['parts']}>
          {BODY_PARTS.map((part) => (
            <div key={part} className={styles['part']}>
              <dt>{BODY_PART_LABELS[part]}</dt>
              <dd>{partWear(worker, part)}</dd>
            </div>
          ))}
        </dl>
      </Popover>
    </span>
  );
}

function Learning({ worker }: CellProps) {
  return (
    <span className={styles['learning']}>
      <span aria-hidden="true">{learningText(worker.learning.value)}</span>
      <WhyButton
        label={`${worker.name}'s learning in this match`}
        value={learningText(worker.learning.value)}
        source={{ trace: worker.learning.trace }}
      />
    </span>
  );
}

function InjuryChance({ worker }: CellProps) {
  return (
    <Explained
      label={`${worker.name}'s injury chance`}
      value={worker.injuryChance.value}
      unit="probability"
      trace={worker.injuryChance.trace}
    />
  );
}

/** "Injured", "Injured (limit reached, ignored)" or "OK", with the roll's Why?. */
export function injuryRunText(worker: PhysicalPreviewWorker): string {
  if (worker.injury.injured) return INJURED_TEXT;
  if (worker.injury.ignoredOverLimit) return IGNORED_OVER_LIMIT_TEXT;
  return UNHURT_TEXT;
}

function ThisRun({ worker }: CellProps) {
  const text = injuryRunText(worker);
  const tone = worker.injury.injured
    ? 'negative'
    : worker.injury.ignoredOverLimit
      ? 'neutral'
      : 'positive';
  return (
    <span className={styles['thisRun']}>
      <Badge tone={tone}>{text}</Badge>
      <WhyButton
        label={`${worker.name}'s injury roll`}
        value={text}
        source={{ trace: worker.injury.roll.trace }}
      />
    </span>
  );
}

function sideText(side: number): string {
  return `Side ${String(side + 1)}`;
}

function WorkerName({ worker }: CellProps) {
  return <WorkerLink personId={worker.personId} name={worker.name} className={styles['name']} />;
}

interface ColumnOptions {
  readonly onFatigueChange: PhysicalTollTableProps['onFatigueChange'];
  readonly disabled: boolean;
}

/** The desktop columns: one per number, each with its Why?. */
function tableColumns({ onFatigueChange, disabled }: ColumnOptions) {
  const columns: ColumnDef<PhysicalPreviewWorker>[] = [
    {
      id: 'worker',
      header: 'Worker',
      cell: (worker) => <WorkerName worker={worker} />,
      sortValue: (worker) => worker.name,
      card: 'title',
      width: 'lg',
    },
    {
      id: 'side',
      header: 'Side',
      cell: (worker) => sideText(worker.side),
      sortValue: (worker) => worker.side,
      card: 'subtitle',
      width: 'xs',
    },
    {
      id: 'safety',
      header: 'Safety',
      cell: (worker) => formatNumber(worker.safety),
      sortValue: (worker) => worker.safety,
      numeric: true,
      card: 'stat',
      width: 'xs',
    },
    {
      id: 'fatigueIn',
      header: 'Fatigue going in',
      cell: (worker) => (
        <FatigueGoingIn worker={worker} onFatigueChange={onFatigueChange} disabled={disabled} />
      ),
      sortValue: (worker) => worker.fatigueBefore,
      card: 'stat',
      width: 'md',
    },
    {
      id: 'fatigueGain',
      header: 'Fatigue gain',
      cell: (worker) => <FatigueGain worker={worker} />,
      sortValue: (worker) => worker.fatigueGain.value,
      numeric: true,
      card: 'stat',
    },
    {
      id: 'fatigueAfter',
      header: 'Fatigue after',
      cell: (worker) => <FatigueAfter worker={worker} />,
      sortValue: (worker) => worker.fatigueAfter,
      card: 'stat',
      width: 'md',
    },
    {
      id: 'wear',
      header: 'Wear',
      cell: (worker) => <Wear worker={worker} />,
      sortValue: (worker) => worker.wearTotal.value,
      card: 'stat',
    },
    {
      id: 'learning',
      header: 'Learning',
      cell: (worker) => <Learning worker={worker} />,
      sortValue: (worker) => worker.learning.value,
      card: 'stat',
    },
    {
      id: 'injuryChance',
      header: 'Injury chance',
      cell: (worker) => <InjuryChance worker={worker} />,
      sortValue: (worker) => worker.injuryChance.value,
      numeric: true,
      card: 'stat',
    },
    {
      id: 'thisRun',
      header: 'This run',
      cell: (worker) => <ThisRun worker={worker} />,
      sortValue: (worker) => injuryRunText(worker),
      card: 'meta',
    },
  ];
  return columns;
}

/** Everything but the name, side and injury chance, as one group on a phone card. */
function PhysicalGroup({ worker, onFatigueChange, disabled }: CellProps & ColumnOptions) {
  const items: readonly { readonly label: string; readonly value: ReactNode }[] = [
    { label: 'Safety', value: formatNumber(worker.safety) },
    {
      label: 'Fatigue going in',
      value: (
        <FatigueGoingIn worker={worker} onFatigueChange={onFatigueChange} disabled={disabled} />
      ),
    },
    { label: 'Fatigue gain', value: <FatigueGain worker={worker} /> },
    { label: 'Fatigue after', value: <FatigueAfter worker={worker} /> },
    { label: 'Wear', value: <Wear worker={worker} /> },
    { label: 'Learning', value: <Learning worker={worker} /> },
    { label: 'This run', value: <ThisRun worker={worker} /> },
  ];
  return (
    <dl className={styles['group']}>
      {items.map((item) => (
        <div key={item.label} className={styles['groupItem']}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The phone card columns: the name as the title, the injury chance as the stat, the rest grouped. */
function cardColumns(options: ColumnOptions) {
  const columns: ColumnDef<PhysicalPreviewWorker>[] = [
    {
      id: 'worker',
      header: 'Worker',
      cell: (worker) => <WorkerName worker={worker} />,
      sortValue: (worker) => worker.name,
      card: 'title',
    },
    {
      id: 'side',
      header: 'Side',
      cell: (worker) => sideText(worker.side),
      sortValue: (worker) => worker.side,
      card: 'subtitle',
    },
    {
      id: 'injuryChance',
      header: 'Injury chance',
      cell: (worker) => <InjuryChance worker={worker} />,
      sortValue: (worker) => worker.injuryChance.value,
      numeric: true,
      card: 'stat',
    },
    {
      id: 'physical',
      header: PHYSICAL_CARD_HEADING,
      cell: (worker) => <PhysicalGroup worker={worker} {...options} />,
      card: 'stat',
    },
  ];
  return columns;
}

function rowId(worker: PhysicalPreviewWorker): string {
  return worker.personId;
}

/**
 * What one match does to each competitor's body (MTCH4-05): fatigue going in (a what-if Select in
 * the Match lab), fatigue gain, fatigue after, wear (with each body part in a popover), ring
 * learning and the injury chance, every number with its Why?, and whether this run's roll hurt
 * them. Built on `DataTable`: a table on desktop; on a phone, one card per worker with the name as
 * the title, the injury chance as the stat and everything else under a "Physical" heading.
 *
 * Never shows a length in minutes, a potential or a ceiling: the engine's traces carry none.
 */
export function PhysicalTollTable({
  workers,
  onFatigueChange,
  disabled = false,
  caption = 'Physical toll of each worker',
  className,
}: PhysicalTollTableProps) {
  const isMobile = useIsMobile();
  const columns = useMemo(
    () =>
      isMobile
        ? cardColumns({ onFatigueChange, disabled })
        : tableColumns({ onFatigueChange, disabled }),
    [disabled, isMobile, onFatigueChange],
  );
  return (
    <DataTable
      rows={workers}
      columns={columns}
      getRowId={rowId}
      caption={caption}
      density="compact"
      className={classNames(styles['table'], className)}
    />
  );
}
