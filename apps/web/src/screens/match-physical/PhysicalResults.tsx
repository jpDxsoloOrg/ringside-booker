/**
 * The results page's "Physical toll" section (MTCH4-06): what each match on the show did to its
 * competitors' bodies, read back from the traces show night stored (`match.physicalForSegment`):
 * fatigue gained and where it ended, condition lost, ring learning and the injury chance, each with
 * its Why? while the game keeps it, and an "Injured" badge for anyone hurt. A rival show keeps only
 * fatigue, so the rest reads "Not kept for rival shows". No minutes, potential or ceilings.
 */
import type {
  PhysicalForSegmentResult,
  PhysicalNumber,
  PhysicalWorkerRow,
  SegmentResultView,
  ShowResultsView,
} from '@ringside/engine';
import { learningGainText } from '@ringside/engine';
import type { ReactNode } from 'react';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Badge } from '@/components/Badge';
import { formatNumber } from '@/components/format';
import { VisuallyHidden } from '@/components/layout';
import { slotHeadingLabel } from '@/components/SegmentResultCard';
import { Explained, WhyButton } from '@/components/Trace';
import { WorkerLink } from '@/components/WorkerLink';
import styles from './PhysicalResults.module.css';

/** Said for a number a rival show does not keep, or one the game no longer has. */
export const NOT_KEPT_TEXT = 'Not kept';

/** The lead over the matches. */
export const PHYSICAL_RESULTS_LEAD =
  "What each match cost its workers' bodies: the fatigue it added, the condition it took and what they learned in the ring.";

interface FigureProps {
  readonly label: string;
  readonly children: ReactNode;
}

function Figure({ label, children }: FigureProps) {
  return (
    <div className={styles['figure']}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function NotKept() {
  return <span className={styles['notKept']}>{NOT_KEPT_TEXT}</span>;
}

function explained(
  number: PhysicalNumber,
  label: string,
  unit: 'probability' | 'points',
): ReactNode {
  if (number.value === null) return <NotKept />;
  return <Explained value={number.value} label={label} traceRef={number.traceRef} unit={unit} />;
}

function FatigueFigure({ worker }: { readonly worker: PhysicalWorkerRow }) {
  const { fatigueGain, fatigueAfter } = worker;
  if (fatigueGain.value === null || fatigueAfter.value === null) return <NotKept />;
  return (
    <span className={styles['values']}>
      <span className="tabular">
        +{formatNumber(fatigueGain.value, { maximumFractionDigits: 1 })}
      </span>
      <span aria-hidden="true"> → </span>
      <VisuallyHidden> to </VisuallyHidden>
      {explained(fatigueAfter, `${worker.name}'s fatigue after the match`, 'points')}
    </span>
  );
}

function LearningFigure({ worker }: { readonly worker: PhysicalWorkerRow }) {
  const { learning } = worker;
  if (learning.value === null) return <NotKept />;
  const text = learningGainText(learning.value);
  return (
    <span className={styles['values']}>
      <span className="tabular">{text}</span>
      {learning.traceRef !== null && (
        <WhyButton
          label={`${worker.name}'s learning in this match`}
          value={text}
          source={{ traceRef: learning.traceRef }}
        />
      )}
    </span>
  );
}

function WorkerRow({ worker }: { readonly worker: PhysicalWorkerRow }) {
  return (
    <li className={styles['worker']}>
      <div className={styles['who']}>
        <WorkerLink personId={worker.personId} name={worker.name} className={styles['name']} />
        {worker.injured.value && (
          <span className={styles['values']}>
            <Badge tone="negative">Injured</Badge>
            {worker.injured.traceRef !== null && (
              <WhyButton
                label={`${worker.name}'s injury roll`}
                value="Injured"
                source={{ traceRef: worker.injured.traceRef }}
              />
            )}
          </span>
        )}
      </div>
      <dl className={styles['figures']}>
        <Figure label="Fatigue">
          <FatigueFigure worker={worker} />
        </Figure>
        <Figure label="Condition lost">
          {explained(worker.wearTotal, `${worker.name}'s condition lost`, 'points')}
        </Figure>
        <Figure label="Learning">
          <LearningFigure worker={worker} />
        </Figure>
        <Figure label="Injury chance">
          {explained(worker.injuryChance, `${worker.name}'s injury chance`, 'probability')}
        </Figure>
      </dl>
    </li>
  );
}

export interface PhysicalMatchProps {
  readonly segment: SegmentResultView;
  /** `match.physicalForSegment` for it. */
  readonly data: PhysicalForSegmentResult;
}

/** One match's competitors, drawn with no engine query of its own. */
export function PhysicalMatch({ segment, data }: PhysicalMatchProps) {
  if (!data.applied || data.workers.length === 0) return null;
  return (
    <section className={styles['segment']} aria-label={slotHeadingLabel(segment)}>
      <h3 className={styles['segmentHeading']}>{slotHeadingLabel(segment)}</h3>
      <ul className={styles['workers']}>
        {data.workers.map((worker) => (
          <WorkerRow key={worker.personId} worker={worker} />
        ))}
      </ul>
    </section>
  );
}

function PhysicalMatchQuery({ segment }: { readonly segment: SegmentResultView }) {
  const query = useEngineQuery('match.physicalForSegment', { segmentId: segment.segmentId });
  if (query.data === undefined) return null;
  return <PhysicalMatch segment={segment} data={query.data} />;
}

/** The section's body, or null for a show with no match to show. */
export function PhysicalResultsSection({ view }: { readonly view: ShowResultsView }) {
  const matches = view.segments.filter((segment) => segment.kind === 'match');
  if (view.result === null || matches.length === 0) return null;
  return (
    <div className={styles['section']}>
      <p className={styles['lead']}>{PHYSICAL_RESULTS_LEAD}</p>
      {matches.map((segment) => (
        <PhysicalMatchQuery key={segment.segmentId} segment={segment} />
      ))}
    </div>
  );
}
