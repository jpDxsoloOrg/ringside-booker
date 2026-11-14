import { Link } from 'react-router-dom';
import { slotLabel, traceRefFromKey } from '@ringside/engine';
import type {
  EventInstanceId,
  GameDate,
  SegmentId,
  StorylineDetail,
  StorylineTimelineRow,
  TraceRef,
} from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { Badge } from '@/components/Badge';
import { formatGameDate } from '@/components/format';
import { HeatChangeChip } from '@/components/HeatChangeChip';
import { StarRating } from '@/components/StarRating';
import { WhyButton } from '@/components/Trace';
import { EMPTY_TIMELINE_TEXT } from '../storylineText';
import styles from './HeatTimeline.module.css';

/** A linked segment on a show still to run: it counts once the show has run. */
export const BOOKED_TEXT = 'Booked: counts once the show has run';

/** A linked segment that ran but didn't move the story (nobody in it was in the storyline). */
export const NOT_COUNTED_TEXT = "Didn't count: nobody in it was in the storyline";

/** One row of the page's timeline: a counted step, a booked segment or one that didn't count. */
export interface HeatTimelineEntry {
  readonly segmentId: SegmentId;
  readonly eventInstanceId: EventInstanceId;
  readonly showName: string | null;
  readonly date: GameDate;
  readonly preShow: boolean | null;
  readonly slot: number | null;
  readonly label: string | null;
  readonly finale: boolean;
  readonly stars: number | null;
  readonly ratingTraceRef: TraceRef | null;
  /** The heat step, or null when the segment hasn't counted. */
  readonly heat: {
    readonly before: number;
    readonly after: number;
    readonly traceRef: TraceRef | null;
  } | null;
  readonly state: 'counted' | 'booked' | 'notCounted';
}

function compareNewestFirst(left: HeatTimelineEntry, right: HeatTimelineEntry): number {
  if (left.date !== right.date) return left.date < right.date ? 1 : -1;
  if (left.eventInstanceId !== right.eventInstanceId) {
    return left.eventInstanceId < right.eventInstanceId ? 1 : -1;
  }
  // Later on the night first: the main card after the pre-show, higher slots after lower.
  const leftPre = left.preShow === true ? 0 : 1;
  const rightPre = right.preShow === true ? 0 : 1;
  if (leftPre !== rightPre) return rightPre - leftPre;
  return (right.slot ?? 0) - (left.slot ?? 0);
}

/**
 * The page's timeline rows, newest first: every heat step the progress log still holds, joined to
 * the linked segments the storyline page lists, plus the linked segments that haven't counted
 * (still booked, or run without anyone in the story). `today` is the next day to play.
 */
export function heatTimelineEntries(
  storyline: Pick<StorylineDetail, 'timeline'>,
  steps: readonly StorylineTimelineRow[],
  today: GameDate | null,
): HeatTimelineEntry[] {
  const linked = new Map(storyline.timeline.map((entry) => [entry.segmentId, entry]));
  const entries: HeatTimelineEntry[] = steps.map((step) => {
    const entry = linked.get(step.segmentId);
    return {
      segmentId: step.segmentId,
      eventInstanceId: step.eventInstanceId,
      showName: step.showName ?? entry?.eventName ?? null,
      date: step.date,
      preShow: step.preShow ?? entry?.preShow ?? null,
      slot: step.slot ?? entry?.slot ?? null,
      label: step.segmentLabel ?? entry?.label ?? null,
      finale: step.finale,
      stars: entry?.stars ?? null,
      ratingTraceRef:
        entry?.ratingTraceId === undefined || entry.ratingTraceId === null
          ? null
          : traceRefFromKey(entry.ratingTraceId),
      heat: { before: step.heatBefore, after: step.heatAfter, traceRef: step.traceRef },
      state: 'counted',
    };
  });
  const counted = new Set(steps.map((step) => step.segmentId));
  for (const entry of storyline.timeline) {
    if (counted.has(entry.segmentId)) continue;
    // The storyline page carries each linked segment's heat step too (CRTV4-06), so a counted row
    // still reads "Heat 42 → 51" while `storylines.timeline` is loading.
    const step =
      entry.heatBefore === null || entry.heatAfter === null
        ? null
        : { before: entry.heatBefore, after: entry.heatAfter, traceRef: entry.heatTraceRef };
    const booked = entry.stars === null && (today === null || entry.date >= today);
    entries.push({
      segmentId: entry.segmentId,
      eventInstanceId: entry.eventInstanceId,
      showName: entry.eventName,
      date: entry.date,
      preShow: entry.preShow,
      slot: entry.slot,
      label: entry.label,
      finale: entry.isFinale,
      stars: entry.stars,
      ratingTraceRef: entry.ratingTraceId === null ? null : traceRefFromKey(entry.ratingTraceId),
      heat: step,
      state: step !== null ? 'counted' : booked ? 'booked' : 'notCounted',
    });
  }
  return entries.sort(compareNewestFirst);
}

function TimelineRow({ entry }: { readonly entry: HeatTimelineEntry }) {
  const slot =
    entry.preShow === null || entry.slot === null ? null : slotLabel(entry.preShow, entry.slot);
  const label = entry.label ?? 'A segment no longer kept';
  return (
    <li className={styles['row']} data-state={entry.state}>
      <span className={styles['date']}>{formatGameDate(entry.date)}</span>
      <span className={styles['show']}>
        {entry.showName === null ? (
          'A show no longer kept'
        ) : (
          <Link to={routes.game.showResults(entry.eventInstanceId)}>{entry.showName}</Link>
        )}
        {slot !== null && <span className={styles['slot']}>{slot}</span>}
      </span>
      <span className={styles['segment']}>
        <span className={styles['label']}>{label}</span>
        {entry.finale && entry.heat === null && (
          <Badge tone="prestige" variant="solid">
            Finale
          </Badge>
        )}
        {entry.stars !== null && (
          <span className={styles['stars']}>
            <StarRating value={entry.stars} size="sm" />
            {entry.ratingTraceRef !== null && (
              <WhyButton
                label="Stars"
                value={entry.stars}
                source={{ traceRef: entry.ratingTraceRef }}
                buttonLabel={`Why ${label} got ${String(entry.stars)} stars`}
              />
            )}
          </span>
        )}
      </span>
      <span className={styles['heat']}>
        {entry.heat === null ? (
          <span className={styles['muted']}>
            {entry.state === 'booked' ? BOOKED_TEXT : NOT_COUNTED_TEXT}
          </span>
        ) : (
          <HeatChangeChip
            storylineName="Heat"
            before={entry.heat.before}
            after={entry.heat.after}
            traceRef={entry.heat.traceRef}
            finale={entry.finale}
          />
        )}
      </span>
    </li>
  );
}

export interface HeatTimelineProps {
  readonly storyline: StorylineDetail;
  /** The next day to play, to tell booked segments from ones that ran; null while unknown. */
  readonly today: GameDate | null;
}

/**
 * The storyline page's timeline (CRTV3-04, heat added by CRTV4-05): one row per linked segment,
 * newest first, with its date, show (a link to its results), slot, who was in it, its stars and
 * how it moved the heat, with the heat step's Why? and the finale marked. Rows only go back as far
 * as the detail window keeps them.
 */
export function HeatTimeline({ storyline, today }: HeatTimelineProps) {
  const query = useEngineQuery('storylines.timeline', { storylineId: storyline.id });
  const steps = query.data?.kind === 'ok' ? query.data.rows : [];
  const entries = heatTimelineEntries(storyline, steps, today);
  if (entries.length === 0) {
    return <p className={styles['muted']}>{EMPTY_TIMELINE_TEXT}</p>;
  }
  return (
    <ol className={styles['timeline']} aria-label="Linked segments, newest first">
      {entries.map((entry) => (
        <TimelineRow key={entry.segmentId} entry={entry} />
      ))}
    </ol>
  );
}
