import type { DealRisk, TraceRef } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { VisuallyHidden } from '@/components/layout';
import { Tooltip } from '@/components/Tooltip';
import { WhyButton } from '@/components/Trace';
import { RISK_LABELS, RISK_TONES, riskLabel } from '../networkText';
import styles from './networkBadges.module.css';

export interface DealHealthBadgeProps {
  /** How the network sees the deal today. */
  readonly risk: DealRisk;
  /** Every reason behind it, worst first. The first decides "Missed airing". */
  readonly reasons: readonly string[];
  /** Where the latest stored verdict is, for the Why?; null leaves the Why? out. */
  readonly healthTraceRef?: TraceRef | null;
  /** The network's name, for the Why?'s label. */
  readonly networkName: string;
}

/**
 * The risk on a deal: Safe, Watch, At risk, Cancelling, or "Missed airing" when that is the worst
 * reason. The reasons show in a tooltip and are read out with the badge; the deal sheet lists
 * them as text too, since a tooltip never reaches a touch screen. A Why? opens the stored verdict.
 */
export function DealHealthBadge({
  risk,
  reasons,
  healthTraceRef = null,
  networkName,
}: DealHealthBadgeProps) {
  const label = riskLabel(risk, reasons);
  const badge = <Badge tone={RISK_TONES[risk]}>{label}</Badge>;
  return (
    <span className={styles['health']} data-risk={risk}>
      {reasons.length === 0 ? (
        badge
      ) : (
        <Tooltip content={reasons.join(' · ')}>
          {/* A button so the reasons can be reached by keyboard and by touch; it does nothing else. */}
          <button type="button" className={styles['chip']}>
            {badge}
            <VisuallyHidden>{reasons.join('. ')}</VisuallyHidden>
          </button>
        </Tooltip>
      )}
      {healthTraceRef !== null && (
        <WhyButton
          label={`${networkName}'s view of the deal`}
          value={RISK_LABELS[risk]}
          source={{ traceRef: healthTraceRef }}
        />
      )}
    </span>
  );
}
