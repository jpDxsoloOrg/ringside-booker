/**
 * ECO8's card on the Finances Overview: what TV, streaming and pay-per-view brought in over the
 * last 30 days (income less airtime), with its Why? and the last airing, registered through
 * ECO1's KPI registry from here. `FinancesView.tsx` imports this module once, so it loads with the
 * Finances chunk.
 */
import { Link } from 'react-router-dom';
import { cents } from '@ringside/engine';
import type { BroadcastIncomeSummary, PromotionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { formatGameDate, useMoneyFormatter } from '@/components/format';
import { KpiCard } from '@/components/KpiCard';
import { WhyButton } from '@/components/Trace';
import { registerFinanceKpi } from '@/screens/finances/financeRegistry';
import { networksPath } from '../networksParams';
import styles from './BroadcastIncomeKpi.module.css';

export const BROADCAST_KPI_ID = 'eco.broadcast';
/** After Company size (40) and ECO9's Financial health (45). */
export const BROADCAST_KPI_ORDER = 50;
export const BROADCAST_KPI_LABEL = 'TV income (30 days)';

const COMPACT = { maximumFractionDigits: 1, notation: 'compact' } as const;

/** "2.4M", "4K": a viewer count short enough for a card footer. */
export function shortViewers(viewers: number): string {
  return new Intl.NumberFormat('en-US', COMPACT).format(viewers);
}

/** "Last airing: Mainstage, Jan 3 · 2.4M viewers (expected 1.9M)", or that nothing has aired. */
export function lastAiringText(lastAiring: BroadcastIncomeSummary['lastAiring']): string {
  if (lastAiring === null) return 'Nothing has aired yet';
  return `Last airing: ${lastAiring.showName}, ${formatGameDate(lastAiring.airDate)} · ${shortViewers(lastAiring.viewers)} viewers (expected ${shortViewers(lastAiring.expectedViewers)})`;
}

export interface BroadcastIncomeCardProps {
  readonly summary: BroadcastIncomeSummary;
}

/** The card itself, drawn from a `broadcast.incomeSummary` answer (the gallery draws it alone). */
export function BroadcastIncomeCard({ summary }: BroadcastIncomeCardProps) {
  const money = useMoneyFormatter();
  return (
    <KpiCard
      label={BROADCAST_KPI_LABEL}
      icon="tv"
      value={money(cents(summary.total))}
      tone={summary.total < 0 ? 'negative' : 'neutral'}
      footer={
        <span className={styles['footer']}>
          <span>{lastAiringText(summary.lastAiring)}</span>
          {summary.note !== null && <span>{summary.note}</span>}
          <Link to={networksPath()} className={styles['kpiLink']}>
            Networks
          </Link>
        </span>
      }
      why={
        <WhyButton
          label={BROADCAST_KPI_LABEL}
          value={summary.total}
          unit="money"
          source={{ trace: summary.trace }}
        />
      }
    />
  );
}

export interface BroadcastIncomeKpiProps {
  readonly promotionId: PromotionId;
}

/** The card for the seat's promotion; nothing while it loads or if the engine refuses. */
export function BroadcastIncomeKpi({ promotionId }: BroadcastIncomeKpiProps) {
  const summary = useEngineQuery('broadcast.incomeSummary', { promotionId, days: 30 });
  if (summary.data === undefined) return null;
  return <BroadcastIncomeCard summary={summary.data} />;
}

registerFinanceKpi({
  id: BROADCAST_KPI_ID,
  order: BROADCAST_KPI_ORDER,
  render: ({ promotionId }) => <BroadcastIncomeKpi promotionId={promotionId} />,
});
