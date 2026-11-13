/**
 * The results page's "Popularity & momentum" body (MTCH3-05), drawn from `match.aftermath` and
 * the page's own `shows.results` answer with no engine: one card per match, in card order, and in
 * each card every competitor's popularity in the show's region and momentum, before → after with
 * the change and a Why? while the breakdown is kept. Phones fold every match after the third
 * behind its own toggle. No morale anywhere: a match result never changes it (D-09).
 */
import { useId, useState } from 'react';
import type {
  AftermathResult,
  AftermathSegmentView,
  AftermathWorkerView,
  ShowResultsView,
} from '@ringside/engine';
import { PersonProfileLink } from '@/app/entityLinks';
import { Badge } from '@/components/Badge';
import { DeltaChip } from '@/components/DeltaChip';
import { VisuallyHidden } from '@/components/layout';
import { resultLine, slotHeadingLabel } from '@/components/SegmentResultCard/segmentResultText';
import { WhyButton } from '@/components/Trace';
import {
  momentumChangeText,
  momentumText,
  noContractText,
  OUTCOME_LABELS,
  OUTCOME_TONES,
  popularityChangeText,
  popularityText,
} from '@/screens/match-lab/aftermath/aftermathText';
import styles from './AftermathSection.module.css';

/** Phones show this many matches open; the rest start folded. */
export const AFTERMATH_OPEN_ON_PHONE = 3;

/** Said when a figure's full breakdown has left the recent-traces store. */
export const BREAKDOWN_GONE_TEXT = 'Full breakdown is only kept for recent results';

/** "Popularity in Northeast". */
export function popularityLabel(regionName: string): string {
  return `Popularity in ${regionName}`;
}

/** "Slot 2: Opener" or "Pre-show slot 1: Opener", from the page's own card. */
function segmentHeading(segment: AftermathSegmentView, view: ShowResultsView): string {
  const card = view.segments.find((entry) => entry.segmentId === segment.segmentId);
  if (card === undefined) {
    return `${segment.preShow ? 'Pre-show slot' : 'Slot'} ${String(segment.slot + 1)}`;
  }
  const heading = slotHeadingLabel(card);
  return segment.preShow
    ? `Pre-show ${heading.charAt(0).toLowerCase()}${heading.slice(1)}`
    : heading;
}

function segmentResult(segment: AftermathSegmentView, view: ShowResultsView): string | null {
  const card = view.segments.find((entry) => entry.segmentId === segment.segmentId);
  return card === undefined ? null : resultLine(card);
}

/** "→", read out as "to". */
function Arrow() {
  return (
    <>
      <span aria-hidden="true"> → </span>
      <VisuallyHidden> to </VisuallyHidden>
    </>
  );
}

function PopularityFigure({
  worker,
  regionName,
}: {
  readonly worker: AftermathWorkerView;
  readonly regionName: string;
}) {
  const showRegion = worker.popularity.regions[0];
  if (showRegion === undefined) return null;
  const changeText = popularityChangeText(showRegion.change);
  return (
    <div className={styles['figure']}>
      <span className={styles['figureLabel']}>{popularityLabel(regionName)}</span>
      <span className={styles['figureValues']}>
        <span className="tabular">{popularityText(showRegion.before)}</span>
        <Arrow />
        <span className="tabular">{popularityText(showRegion.after)}</span>
        <DeltaChip value={showRegion.change} display={changeText} goodWhen="up" variant="plain" />
        {worker.popularity.traceRef !== null && (
          <WhyButton
            label={`${worker.name}'s popularity gain`}
            value={worker.popularity.delta}
            source={{ traceRef: worker.popularity.traceRef }}
          />
        )}
      </span>
    </div>
  );
}

function MomentumFigure({
  worker,
  promotionName,
}: {
  readonly worker: AftermathWorkerView;
  readonly promotionName: string;
}) {
  const { momentum } = worker;
  if (momentum === null) {
    return (
      <div className={styles['figure']}>
        <span className={styles['figureLabel']}>Momentum</span>
        <span className={styles['note']}>{noContractText(promotionName)}</span>
      </div>
    );
  }
  return (
    <div className={styles['figure']}>
      <span className={styles['figureLabel']}>Momentum</span>
      <span className={styles['figureValues']}>
        {momentum.before === null || momentum.change === null ? (
          <>
            <span className="tabular">{momentumText(momentum.after)}</span>
            <span className={styles['note']}>First match under this contract</span>
          </>
        ) : (
          <>
            <span className="tabular">{momentumText(momentum.before)}</span>
            <Arrow />
            <span className="tabular">{momentumText(momentum.after)}</span>
            <DeltaChip
              value={momentum.change}
              display={momentumChangeText(momentum.change)}
              goodWhen="up"
              variant="plain"
            />
          </>
        )}
        {momentum.traceRef !== null && (
          <WhyButton
            label={`${worker.name}'s momentum change`}
            value={momentum.change ?? momentum.after}
            source={{ traceRef: momentum.traceRef }}
          />
        )}
      </span>
    </div>
  );
}

function WorkerRow({
  worker,
  regionName,
  promotionName,
}: {
  readonly worker: AftermathWorkerView;
  readonly regionName: string;
  readonly promotionName: string;
}) {
  const breakdownGone =
    worker.popularity.traceRef === null && (worker.momentum?.traceRef ?? null) === null;
  return (
    <li className={styles['worker']}>
      <div className={styles['who']}>
        <span className={styles['name']}>{worker.name}</span>
        <Badge tone={OUTCOME_TONES[worker.outcome]}>{OUTCOME_LABELS[worker.outcome]}</Badge>
        <PersonProfileLink personId={worker.personId} className={styles['profileLink']}>
          Open in profile<VisuallyHidden>: {worker.name}</VisuallyHidden>
        </PersonProfileLink>
      </div>
      <PopularityFigure worker={worker} regionName={regionName} />
      <MomentumFigure worker={worker} promotionName={promotionName} />
      {breakdownGone && <p className={styles['note']}>{BREAKDOWN_GONE_TEXT}</p>}
    </li>
  );
}

function SegmentCard({
  segment,
  view,
  foldOnPhone,
}: {
  readonly segment: AftermathSegmentView;
  readonly view: ShowResultsView;
  readonly foldOnPhone: boolean;
}) {
  const headingId = useId();
  const bodyId = useId();
  const [open, setOpen] = useState(!foldOnPhone);
  const heading = segmentHeading(segment, view);
  const result = segmentResult(segment, view);
  return (
    <section
      className={styles['segment']}
      aria-labelledby={headingId}
      data-folded={open ? undefined : 'true'}
    >
      <div className={styles['segmentHeader']}>
        <h3 id={headingId} className={styles['segmentHeading']}>
          {heading}
        </h3>
        {foldOnPhone && (
          <button
            type="button"
            className={styles['foldToggle']}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => {
              setOpen((current) => !current);
            }}
          >
            {open ? 'Hide' : 'Show'}
            <VisuallyHidden> {heading}</VisuallyHidden>
          </button>
        )}
      </div>
      {result !== null && <p className={styles['resultLine']}>{result}</p>}
      <ul id={bodyId} className={styles['workers']}>
        {segment.workers.map((worker) => (
          <WorkerRow
            key={worker.aftermathId}
            worker={worker}
            regionName={segment.showRegionName}
            promotionName={view.promotion.name}
          />
        ))}
      </ul>
    </section>
  );
}

export interface AftermathResultsProps {
  /** `match.aftermath { eventInstanceId }` for the show. */
  readonly data: AftermathResult;
  /** The page's `shows.results` answer, for each match's heading and result line. */
  readonly view: ShowResultsView;
}

/** One card per match that changed anyone; the caller handles a show with none. */
export function AftermathResults({ data, view }: AftermathResultsProps) {
  return (
    <div className={styles['section']}>
      <p className={styles['lead']}>
        What each match did to its competitors' popularity in {view.region.name}, where the show
        took place, and their momentum with {view.promotion.name}.
      </p>
      {data.segments.map((segment, index) => (
        <SegmentCard
          key={segment.segmentId}
          segment={segment}
          view={view}
          foldOnPhone={index >= AFTERMATH_OPEN_ON_PHONE}
        />
      ))}
    </div>
  );
}
