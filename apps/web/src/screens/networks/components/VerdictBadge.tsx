import type { DealRefusal, DealVerdictValue, TraceNode } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { WhyButton } from '@/components/Trace';
import styles from './networkBadges.module.css';

export const VERDICT_LABELS: Readonly<Record<DealVerdictValue, string>> = {
  accept: 'Would accept',
  refuse: 'Would refuse',
};

export interface VerdictBadgeProps {
  readonly verdict: DealVerdictValue;
  /** Every reason it would refuse; the first is shown beside the badge. Empty on accept. */
  readonly refusals: readonly DealRefusal[];
  /** The verdict's breakdown, for a Why?; null leaves it out. */
  readonly trace?: TraceNode | null;
  /** The network's name, for the Why?'s label. */
  readonly networkName: string;
  /** Show the first refusal's words beside the badge. True by default. */
  readonly showReason?: boolean;
}

/**
 * Whether a network would sign: "Would accept" or "Would refuse" with the first reason it gives
 * in plain text beside it (never only in a tooltip), and a Why? on the verdict when there is one.
 */
export function VerdictBadge({
  verdict,
  refusals,
  trace = null,
  networkName,
  showReason = true,
}: VerdictBadgeProps) {
  const first = refusals[0];
  return (
    <span className={styles['verdict']} data-verdict={verdict}>
      <Badge tone={verdict === 'accept' ? 'positive' : 'negative'}>{VERDICT_LABELS[verdict]}</Badge>
      {showReason && first !== undefined && (
        <span className={styles['reason']}>{first.message}</span>
      )}
      {trace !== null && (
        <WhyButton
          label={`${networkName}'s answer`}
          value={VERDICT_LABELS[verdict]}
          source={{ trace }}
        />
      )}
    </span>
  );
}
