import type { PreviewAngleBeat, PreviewAngleResult, SegmentWarning } from '@ringside/engine';
import { DURATION_CLASS_LABELS } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatNumber } from '@/components/format';
import { Icon } from '@/components/Icon';
import { Panel } from '@/components/Panel';
import { ScoreBug } from '@/components/ScoreBug';
import type { ScoreBugStats } from '@/components/ScoreBug';
import { StarRating, STAR_RATING_MAX } from '@/components/StarRating';
import { Explained, WhyButton } from '@/components/Trace';
import { OUT_OF_DATE_TEXT } from '../LabResult';
import { orderedWarnings } from '../LabWarnings';
import { starsText } from '../labText';
import { angleWarningText, beatWeightOf, factorText, personStatText } from './angleText';
import type { BeatWeight } from './angleText';
import type { AngleLabState } from './useAngleLab';
import styles from './AngleLab.module.css';

/** The stars as the glyphs draw them: a raised cap can go past five, the glyphs can't. */
function glyphStars(stars: number): number {
  return Math.min(STAR_RATING_MAX, Math.max(0, Math.round(stars * 4) / 4));
}

/** One row of the per-beat table. */
interface BeatRow {
  readonly beat: PreviewAngleBeat;
  readonly weight: BeatWeight | null;
}

function PeopleCell({ beat }: { readonly beat: PreviewAngleBeat }) {
  const people = beat.groups.flatMap((group) => group.people);
  if (people.length === 0) return <span>Nobody</span>;
  return (
    <ul className={styles['people']}>
      {people.map((person) => (
        <li key={person.personId} className={styles['person']}>
          {person.name} — {personStatText(person)}{' '}
          <WhyButton
            label={`${person.name} in ${beat.name}`}
            value={Math.round(person.value.value)}
            source={person.value}
          />
        </li>
      ))}
    </ul>
  );
}

function WeightCell({ row }: { readonly row: BeatRow }) {
  const { beat, weight } = row;
  if (!beat.counted) return <Badge tone="negative">Not counted</Badge>;
  if (weight === null) return <span>Not shown</span>;
  return (
    <span className={styles['weight']}>
      <span>{factorText(weight.weight)}</span>
      {weight.closing && <Badge tone="data">closing</Badge>}
      {weight.repeat !== null && <Badge tone="neutral">repeat {factorText(weight.repeat)}</Badge>}
      <WhyButton
        label={`Weight of ${beat.name}`}
        value={weight.weight}
        unit="multiplier"
        panelTitle={`How beat ${String(beat.index + 1)}, ${beat.name}, counts`}
        source={{ trace: weight.trace }}
      />
    </span>
  );
}

const BEAT_COLUMNS: readonly ColumnDef<BeatRow>[] = [
  {
    id: 'index',
    header: '#',
    cell: (row) => String(row.beat.index + 1),
    sortValue: (row) => row.beat.index,
    numeric: true,
    card: 'subtitle',
    cardLabel: 'Beat',
    width: 'xs',
  },
  {
    id: 'beat',
    header: 'Beat',
    cell: (row) => row.beat.name,
    sortValue: (row) => row.beat.name,
    card: 'title',
    width: 'sm',
  },
  {
    id: 'people',
    header: 'People',
    cell: (row) => <PeopleCell beat={row.beat} />,
    card: 'meta',
    width: 'lg',
  },
  {
    id: 'weight',
    header: 'Weight',
    cell: (row) => <WeightCell row={row} />,
    sortValue: (row) => row.weight?.weight ?? 0,
    card: 'meta',
    width: 'md',
  },
  {
    id: 'score',
    header: 'Score',
    cell: (row) =>
      row.beat.score === null ? (
        'None'
      ) : (
        <Explained
          label={`${row.beat.name} score`}
          value={Math.round(row.beat.score.value)}
          trace={row.beat.score.trace}
        />
      ),
    sortValue: (row) => row.beat.score?.value ?? -1,
    numeric: true,
    card: 'stat',
    width: 'sm',
  },
];

function beatRowId(row: BeatRow): string {
  return `beat-${String(row.beat.index)}`;
}

/** The angle's warnings, errors first, each naming the people it is about. */
export function AngleWarnings({ warnings }: { readonly warnings: readonly SegmentWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <section className={styles['warnings']} aria-label="Warnings">
      <ul className={styles['warningList']}>
        {orderedWarnings(warnings).map((warning, index) => (
          <li
            key={`${warning.code}-${String(index)}`}
            className={styles['warning']}
            data-severity={warning.severity}
          >
            <Icon name="warning" size="sm" decorative />
            <span>
              <span className={styles['warningSeverity']}>
                {warning.severity === 'error' ? 'Error' : 'Warning'}:
              </span>{' '}
              {angleWarningText(warning)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Score, Stars, Delivered and Crowd on the score bug, then expected against delivered. */
function AngleNight({
  result,
  outOfDate,
}: {
  readonly result: PreviewAngleResult;
  readonly outOfDate: boolean;
}) {
  const stats: ScoreBugStats = [
    {
      id: 'score',
      label: 'Score',
      value: formatNumber(result.score.value),
      tone: 'data',
      highlight: true,
      why: <WhyButton label="Angle score" value={result.score.value} source={result.score} />,
    },
    {
      id: 'stars',
      label: 'Stars',
      value: <StarRating value={glyphStars(result.stars.value)} size="md" tone="broadcast" />,
      subValue: starsText(result.stars.value),
      tone: 'prestige',
      why: (
        <WhyButton label="Stars" value={result.stars.value} unit="stars" source={result.stars} />
      ),
    },
    {
      id: 'delivered',
      label: 'Delivered',
      value: formatNumber(Math.round(result.delivered.value)),
      why: (
        <WhyButton
          label="Delivered"
          value={Math.round(result.delivered.value)}
          source={result.delivered}
        />
      ),
    },
    {
      id: 'crowd',
      label: 'Crowd',
      value: formatNumber(Math.round(result.crowd.value)),
      why: <WhyButton label="Crowd" value={Math.round(result.crowd.value)} source={result.crowd} />,
    },
  ];
  return (
    <div className={styles['result']}>
      {outOfDate && (
        <p className={styles['outOfDate']} role="status">
          <Badge tone="prestige" variant="solid">
            {OUT_OF_DATE_TEXT}
          </Badge>
          <span>The angle or the setup changed since this run.</span>
        </p>
      )}
      <ScoreBug label="Angle result" stats={stats} className={styles['scoreBug']} />
      <p className={styles['resultLine']}>
        <span className={styles['resultPart']}>
          <span>Expected</span>
          <Explained
            label="Expected"
            value={Math.round(result.expected.value)}
            trace={result.expected.trace}
          />
        </span>
        <span aria-hidden="true">·</span>
        <span className={styles['resultPart']}>
          <span>Delivered</span>
          <Explained
            label="Delivered"
            value={Math.round(result.delivered.value)}
            trace={result.delivered.trace}
          />
        </span>
      </p>
      <p className={styles['resultLine']}>
        <span className={styles['resultPart']}>
          {DURATION_CLASS_LABELS[result.durationClass]} slot
        </span>
        <span aria-hidden="true">·</span>
        <span className={styles['resultPart']}>{result.beatLimit.message}</span>
      </p>
      <p className={styles['resultLine']}>{result.policy.label}</p>
    </div>
  );
}

export interface AngleResultProps {
  readonly lab: AngleLabState;
}

/**
 * Angle mode's result column (MTCH5-05): the night on a score bug with every number's Why?, the
 * warnings, and a table of each beat with the stat each person was scored on.
 */
export function AngleResult({ lab }: AngleResultProps) {
  const { shown } = lab;
  let body;
  if (lab.transportError !== null) {
    body = (
      <EmptyState
        icon="warning"
        title="The angle could not be rated"
        body={lab.transportError}
        action={
          <Button iconStart="reset" onClick={lab.run} disabled={lab.blocker !== null}>
            Try again
          </Button>
        }
      />
    );
  } else if (shown === null) {
    body = (
      <EmptyState
        icon="lab"
        title="Nothing run yet"
        body="Put someone in every beat and press Run. Each beat is scored on the best stat of the people in it."
      />
    );
  } else {
    body = (
      <>
        <AngleNight result={shown.result} outOfDate={lab.outOfDate} />
        <AngleWarnings warnings={shown.result.warnings} />
      </>
    );
  }

  const rows: readonly BeatRow[] =
    shown === null
      ? []
      : shown.result.beats.map((beat) => ({
          beat,
          weight: beatWeightOf(shown.result.delivered.trace, beat),
        }));

  return (
    <>
      <Panel
        title={
          <span ref={lab.resultHeadingRef} tabIndex={-1}>
            Result
          </span>
        }
        variant="broadcast"
      >
        {body}
      </Panel>
      {lab.transportError === null && rows.length > 0 && (
        <Panel title="Each beat" padding="none">
          <DataTable
            rows={rows}
            columns={BEAT_COLUMNS}
            getRowId={beatRowId}
            caption="Each beat of the angle"
            density="compact"
          />
        </Panel>
      )}
    </>
  );
}
