import type { TraceRef } from '@ringside/engine';
import { Badge } from '../Badge';
import { classNames } from '../classNames';
import { DeltaChip } from '../DeltaChip';
import { formatNumber } from '../format';
import { VisuallyHidden } from '../layout';
import { Explained } from '../Trace';
import styles from './HeatChangeChip.module.css';

/** The Why?'s label: the number it explains is the heat once the segment had run. */
export const HEAT_AFTER_LABEL = 'Heat after this segment';

export const NO_CHANGE_TEXT = '(no change)';

export const FINALE_LABEL = 'Finale';

export interface HeatChangeChipProps {
  readonly storylineName: string;
  /** Heat before the segment, 0 to 100 (stored unrounded; shown whole). */
  readonly before: number;
  /** Heat after the segment. */
  readonly after: number;
  /** The heat step's Why?, or null when it is no longer kept: then there is no button. */
  readonly traceRef: TraceRef | null;
  /** Marks the storyline's finale. */
  readonly finale?: boolean;
  readonly className?: string;
}

/**
 * How one linked segment moved a storyline's heat: "Ashfall Rivalry 54 → 62 ▲ +8" with a Why? on
 * the new heat, and a "Finale" badge on the story's finale. A step that left the heat where it was
 * reads "54 → 54 (no change)". Heat is shown in whole points and the change is worked out from
 * the shown numbers, so the chip always adds up.
 */
export function HeatChangeChip({
  storylineName,
  before,
  after,
  traceRef,
  finale = false,
  className,
}: HeatChangeChipProps) {
  const shownBefore = Math.round(before);
  const shownAfter = Math.round(after);
  const change = shownAfter - shownBefore;
  return (
    <span className={classNames(styles['chip'], className)} data-direction={Math.sign(change)}>
      <span className={styles['name']}>{storylineName}</span>
      <span className={styles['numbers']}>
        <span className="tabular">{formatNumber(shownBefore)}</span>
        <span aria-hidden="true">→</span>
        <VisuallyHidden>to</VisuallyHidden>
        <Explained value={shownAfter} label={HEAT_AFTER_LABEL} traceRef={traceRef} />
      </span>
      {change === 0 ? (
        <span className={styles['noChange']}>{NO_CHANGE_TEXT}</span>
      ) : (
        <DeltaChip value={change} />
      )}
      {finale && (
        <Badge tone="prestige" variant="solid">
          {FINALE_LABEL}
        </Badge>
      )}
    </span>
  );
}
