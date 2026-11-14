import type { SegmentId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { PhysicalWorkerList } from './PhysicalResults';
import styles from './PhysicalResults.module.css';

/** One match's physical toll, for the show night report (EVT10-02). */
export function PhysicalSegmentReport({ segmentId }: { readonly segmentId: SegmentId }) {
  const query = useEngineQuery('match.physicalForSegment', { segmentId });
  if (query.data === undefined) {
    return (
      <p className={styles['lead']} aria-busy="true">
        Loading the physical toll…
      </p>
    );
  }
  return <PhysicalWorkerList data={query.data} />;
}
