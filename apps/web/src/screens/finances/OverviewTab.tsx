import { Link } from 'react-router-dom';
import { LEDGER_CATEGORIES, LEDGER_CATEGORY_LABELS } from '@ringside/engine';
import type { FinanceMonth, PromotionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { KpiCardGrid } from '@/components/KpiCard';
import { Panel } from '@/components/Panel';
import { CashRunwayBanner } from '@/screens/production/cashRunway';
import { CASH_TREND_MONTHS } from './kpis';
import { FINANCE_TAB_IDS, formatYearMonth } from './financeParams';
import { useFinanceKpis } from './financeRegistry';
import { FinanceQueryError, SignedMoney } from './financeParts';
import styles from './Finances.module.css';

export interface OverviewTabProps {
  readonly promotionId: PromotionId;
}

/** This month's categories in ledger order, each a link to its rows in the Ledger. */
function ThisMonthByCategory({ month }: { readonly month: FinanceMonth }) {
  const lines = LEDGER_CATEGORIES.flatMap((category) => {
    const amount = month.byCategory[category];
    return amount === undefined ? [] : [{ category, amount }];
  });
  return (
    <Panel
      title="This month by category"
      subtitle={formatYearMonth(month.month, 'long')}
      headingLevel={2}
    >
      {lines.length === 0 ? (
        <p className={styles['muted']}>No money has moved this month yet.</p>
      ) : (
        <ul className={styles['categoryList']}>
          {lines.map(({ category, amount }) => (
            <li key={category} className={styles['categoryLine']}>
              <Link
                to={routes.game.finances({
                  tab: FINANCE_TAB_IDS.ledger,
                  month: month.month,
                  category,
                })}
              >
                {LEDGER_CATEGORY_LABELS[category]}
              </Link>
              <SignedMoney amount={amount} />
            </li>
          ))}
          <li className={styles['categoryTotal']}>
            <span>Net</span>
            <SignedMoney amount={month.net} showPlus />
          </li>
        </ul>
      )}
    </Panel>
  );
}

/**
 * The Overview tab: the KPI cards (built-in and registered with `registerFinanceKpi`), then this
 * month's money by category.
 */
export function OverviewTab({ promotionId }: OverviewTabProps) {
  const overview = useEngineQuery('finance.overview', { promotionId });
  const monthly = useEngineQuery('finance.monthly', { promotionId, months: CASH_TREND_MONTHS });
  const kpis = useFinanceKpis();

  if (overview.status === 'loading') {
    return (
      <p className={styles['muted']} role="status">
        Loading the books…
      </p>
    );
  }
  if (overview.data === undefined) {
    return <FinanceQueryError error={overview.error} title="The overview can't be shown" />;
  }
  const data = overview.data;
  const currentMonth = monthly.data?.months.at(-1);

  return (
    <div className={styles['tabBody']}>
      <CashRunwayBanner promotionId={promotionId} />
      <KpiCardGrid label="Key numbers" className={styles['kpis']}>
        {kpis.map((kpi) => {
          const card = kpi.render({ promotionId, overview: data });
          return card === null ? null : (
            <div key={kpi.id} className={styles['kpiSlot']} data-kpi-id={kpi.id}>
              {card}
            </div>
          );
        })}
      </KpiCardGrid>
      {currentMonth !== undefined && <ThisMonthByCategory month={currentMonth} />}
    </div>
  );
}
