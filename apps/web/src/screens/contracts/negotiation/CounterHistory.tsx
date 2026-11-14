import { counterTraceRef, reactionTraceRef } from '@ringside/engine';
import type { NegotiationHistoryView, NegotiationId } from '@ringside/engine';
import { formatGameDate } from '@/components/format';
import { WhyButton } from '@/components/Trace';
import type { ContractMoney } from '../useContractMoney';
import { counterLineText, offeredLineText } from './negotiationText';
import styles from './Negotiation.module.css';

export interface CounterHistoryProps {
  readonly negotiationId: NegotiationId;
  /** The rounds, oldest first (`contracts.negotiation`'s history). */
  readonly history: readonly NegotiationHistoryView[];
  readonly money: ContractMoney;
}

/**
 * The talks so far, one row per offer: "You offered $24,000 a month, 24 months" with how they took
 * it ("Countered"), and "They countered $34,200 a month, 24 months, Upper card". Your rounds with
 * an answer have a Why? on the reaction; their counter-offers a Why? on how they arrived at it.
 */
export function CounterHistory({ negotiationId, history, money }: CounterHistoryProps) {
  if (history.length === 0) return null;
  return (
    <ol className={styles['history']} aria-label="Talks so far">
      {history.map((entry, index) => {
        const worker = entry.by === 'worker';
        return (
          <li
            // A round has at most one entry per side.
            key={`${String(entry.round)}-${entry.by}-${String(index)}`}
            className={styles['historyRow']}
            data-by={entry.by}
          >
            <p className={styles['historyLine']}>
              {worker ? counterLineText(entry.offer, money) : offeredLineText(entry.offer, money)}
            </p>
            <p className={styles['historyMeta']}>
              <span>{`Round ${String(entry.round)} · ${formatGameDate(entry.date, 'short')}`}</span>
              <span className={styles['historyReaction']}>{entry.reactionLabel}</span>
              {worker && (
                <WhyButton
                  label="Their counter-offer"
                  value={entry.reactionLabel}
                  source={{ traceRef: counterTraceRef(negotiationId, entry.round) }}
                  buttonLabel={`Why this counter-offer in round ${String(entry.round)}?`}
                />
              )}
              {!worker && entry.reaction !== null && (
                <WhyButton
                  label="Their reaction"
                  value={entry.reactionLabel}
                  source={{ traceRef: reactionTraceRef(negotiationId, entry.round) }}
                  buttonLabel={`Why ${entry.reactionLabel.toLowerCase()} in round ${String(entry.round)}?`}
                />
              )}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
