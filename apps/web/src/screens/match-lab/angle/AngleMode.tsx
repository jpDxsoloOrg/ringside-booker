import type { MatchCatalog, PromotionId, RegionId } from '@ringside/engine';
import { NO_BEAT_CATALOG_MESSAGE } from '@ringside/engine';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { LabRunBar } from '../LabRunBar';
import styles from '../MatchLab.module.css';
import type { LabRunner } from '../useLabRunner';
import { AngleLab } from './AngleLab';
import { AngleResult } from './AngleResult';
import { useAngleLab } from './useAngleLab';

/** The empty state's heading on a save started before beats existed. */
export const NO_BEATS_TITLE = 'No beats in this save';

export interface AngleModeProps {
  readonly catalog: MatchCatalog;
  readonly regionId: RegionId;
  readonly promotionId: PromotionId | null;
  /** The match Run; the Run bar takes it but Angle mode runs its own. */
  readonly runner: LabRunner;
}

/**
 * The Match lab in Angle mode (MTCH5-05), beside the shared setup: the builder where the sides
 * were, the one Run bar, and the result. On a save from before beats there is nothing to build.
 */
export function AngleMode({ catalog, regionId, promotionId, runner }: AngleModeProps) {
  const lab = useAngleLab(catalog);
  return (
    <>
      <div className={styles['sidesColumn']}>
        {lab.hasBeats ? (
          <AngleLab catalog={catalog} lab={lab} regionId={regionId} promotionId={promotionId} />
        ) : (
          <Panel title="Angle">
            <EmptyState icon="lab" title={NO_BEATS_TITLE} body={NO_BEAT_CATALOG_MESSAGE} />
          </Panel>
        )}
      </div>
      <LabRunBar
        runner={runner}
        angle={{ blocker: lab.blocker, pending: lab.pending, onRun: lab.run }}
      />
      <div className={styles['resultColumn']}>{lab.hasBeats && <AngleResult lab={lab} />}</div>
    </>
  );
}
