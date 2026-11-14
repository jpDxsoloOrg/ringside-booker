/**
 * ECO7's card on the Finances Overview: what production costs every month, registered through
 * ECO1's KPI registry from here. `FinancesView.tsx` imports this module once, so it loads with the
 * Finances chunk.
 */
import { Link } from 'react-router-dom';
import { cents } from '@ringside/engine';
import type { PromotionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { useMoneyFormatter } from '@/components/format';
import { KpiCard } from '@/components/KpiCard';
import { WhyButton } from '@/components/Trace';
import { registerFinanceKpi } from '@/screens/finances/financeRegistry';
import { forecastWindowText } from './productionText';
import { CASH_RUNWAY_KPI_ID, CASH_RUNWAY_KPI_ORDER, CashRunwayCard } from './cashRunway';
import styles from './financeKpi.module.css';

/** The card's id in the Finances KPI registry. */
export const MONTHLY_OVERHEAD_KPI_ID = 'eco7.monthlyOverhead';

/** After Projected payroll (30), before Company size (40): the two fixed monthly costs together. */
export const MONTHLY_OVERHEAD_KPI_ORDER = 35;

export interface MonthlyOverheadKpiProps {
  readonly promotionId: PromotionId;
}

/**
 * "Monthly overhead": music, writing, marketing and back office a month, with its Why?, what the
 * shows coming up will add, and a link to Production. Nothing while it loads or if it is refused.
 */
export function MonthlyOverheadKpi({ promotionId }: MonthlyOverheadKpiProps) {
  const overview = useEngineQuery('production.overview', { promotionId });
  const formatMoney = useMoneyFormatter();
  const overhead = overview.data?.monthlyOverhead ?? null;
  if (overhead === null) return null;
  const upcoming = overview.data?.upcomingShows ?? null;
  return (
    <KpiCard
      label="Monthly overhead"
      icon="video"
      value={formatMoney(cents(overhead.total))}
      unit="/month"
      footer={
        <span className={styles['footer']}>
          {upcoming !== null && upcoming.total > 0 && (
            <span>
              plus about {formatMoney(cents(upcoming.total))} for show production in the next{' '}
              {forecastWindowText(upcoming.days)}
            </span>
          )}
          <Link to={routes.game.production()} className={styles['kpiLink']}>
            Production
          </Link>
        </span>
      }
      why={
        <WhyButton
          label="Monthly overhead"
          value={overhead.total}
          unit="money"
          source={{ trace: overhead.trace }}
        />
      }
    />
  );
}

registerFinanceKpi({
  id: MONTHLY_OVERHEAD_KPI_ID,
  order: MONTHLY_OVERHEAD_KPI_ORDER,
  render: ({ promotionId }) => <MonthlyOverheadKpi promotionId={promotionId} />,
});

// ECO7-06: how long the cash lasts at this rate, right after Cash.
registerFinanceKpi({
  id: CASH_RUNWAY_KPI_ID,
  order: CASH_RUNWAY_KPI_ORDER,
  render: ({ promotionId }) => <CashRunwayCard promotionId={promotionId} link="production" />,
});
