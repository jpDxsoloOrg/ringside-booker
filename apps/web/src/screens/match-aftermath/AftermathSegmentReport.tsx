import type { SegmentId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { AftermathWorkerList } from './AftermathResults';
import styles from './AftermathSection.module.css';

/** Said when the match moved nobody's popularity or momentum. */
export const AFTERMATH_SEGMENT_NONE_TEXT =
  "This match didn't change anyone's popularity or momentum.";

export interface AftermathSegmentReportProps {
  readonly segmentId: SegmentId;
  readonly promotionName: string;
}

/** One match's popularity and momentum changes, for the show night report (EVT10-02). */
export function AftermathSegmentReport({ segmentId, promotionName }: AftermathSegmentReportProps) {
  const query = useEngineQuery('match.aftermath', { segmentId });
  const segment = query.data?.segments.find((entry) => entry.segmentId === segmentId);
  if (query.data === undefined) {
    return (
      <p className={styles['note']} aria-busy="true">
        Loading the popularity and momentum changes…
      </p>
    );
  }
  if (segment === undefined || segment.workers.length === 0) {
    return <p className={styles['note']}>{AFTERMATH_SEGMENT_NONE_TEXT}</p>;
  }
  return <AftermathWorkerList segment={segment} promotionName={promotionName} />;
}
