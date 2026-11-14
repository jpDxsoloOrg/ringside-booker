import type { SegmentId, SegmentResultView } from '@ringside/engine';
import { classNames } from '@/components/classNames';
import { StarRating } from '@/components/StarRating';
import type { SegmentProgress } from './showNightText';
import { PROGRESS_LABELS, segmentLine, segmentTitle } from './showNightText';
import styles from './ShowNight.module.css';

export interface CardProgressEntry {
  readonly segment: SegmentResultView;
  readonly progress: SegmentProgress;
}

/**
 * Each segment of the card marked done, up next or still to come, from the segments run so far
 * and the next one. The card is in running order already (pre-show first).
 */
export function cardProgress(
  segments: readonly SegmentResultView[],
  ranIds: ReadonlySet<SegmentId>,
  nextId: SegmentId | null,
): readonly CardProgressEntry[] {
  return segments.map((segment) => ({
    segment,
    progress: ranIds.has(segment.segmentId)
      ? 'done'
      : segment.segmentId === nextId
        ? 'next'
        : 'toCome',
  }));
}

export interface CardProgressListProps {
  readonly entries: readonly CardProgressEntry[];
  /** The segment whose report is showing. */
  readonly selectedId: SegmentId | null;
  /** Shows a done segment's report again. */
  readonly onSelect: (segmentId: SegmentId) => void;
}

/**
 * The running order: every segment with its slot, what it is, and where it stands in words
 * ("Done", "Up next", "Still to come"). A done segment shows its stars and is a button that brings
 * its report back; the one showing is marked as current.
 */
export function CardProgressList({ entries, selectedId, onSelect }: CardProgressListProps) {
  return (
    <ol className={styles['progressList']} aria-label="Running order">
      {entries.map(({ segment, progress }) => {
        const title = segmentTitle(segment);
        const body = (
          <>
            <span className={styles['progressHead']}>
              <span className={styles['progressTitle']}>{title}</span>
              <span className={styles['progressState']} data-progress={progress}>
                {PROGRESS_LABELS[progress]}
              </span>
            </span>
            <span className={styles['progressLine']}>{segmentLine(segment)}</span>
            {progress === 'done' && segment.rating !== null && (
              <StarRating value={segment.rating.stars} size="sm" tone="broadcast" />
            )}
          </>
        );
        const current = segment.segmentId === selectedId;
        return (
          <li
            key={segment.segmentId}
            className={classNames(styles['progressItem'], current && styles['progressCurrent'])}
            data-progress={progress}
          >
            {progress === 'done' ? (
              <button
                type="button"
                className={styles['progressButton']}
                aria-current={current ? 'true' : undefined}
                onClick={() => {
                  onSelect(segment.segmentId);
                }}
              >
                {body}
              </button>
            ) : (
              <div className={styles['progressBody']}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
