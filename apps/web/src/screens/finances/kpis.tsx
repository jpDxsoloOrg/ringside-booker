import { cents, inputOf, startCalc } from '@ringside/engine';
import type {
  CompanyView,
  FinanceOverview,
  PromotionId,
  TraceNode,
  YearMonth,
} from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import {
  formatNumber,
  formatSignedMoney,
  MINUS_SIGN,
  useMoneyFormatter,
} from '@/components/format';
import { KpiCard } from '@/components/KpiCard';
import { Explained, traceSourceOf, WhyButton } from '@/components/Trace';
import { useSettingsStore } from '@/app/settings/settingsStore';
import type { FinanceKpiProps } from './financeRegistry';
import styles from './Finances.module.css';

/** Months of cash the Overview's sparkline covers. */
export const CASH_TREND_MONTHS = 12;

/** What the sparkline says when the game has run for less than two months. */
export const NO_TREND_TEXT = 'No trend yet';

/**
 * The month-end balances worth drawing: only months from the one the game started in, since
 * earlier months had no money moving. `startMonth` unknown (still loading) keeps them all.
 */
export function cashTrendValues(
  monthEndCash: FinanceOverview['monthEndCash'],
  startMonth: YearMonth | null,
): number[] {
  return monthEndCash
    .filter((entry) => startMonth === null || entry.month >= startMonth)
    .map((entry) => entry.cash);
}

export interface CashKpiCardProps {
  readonly overview: FinanceOverview;
  /** The month the game started in, so the sparkline leaves out the months before it. */
  readonly startMonth: YearMonth | null;
}

/** Cash now, its Why?, and the last twelve month-ends as a sparkline. */
export function CashKpiCard({ overview, startMonth }: CashKpiCardProps) {
  const formatMoney = useMoneyFormatter();
  const formatValue = (value: number): string => formatMoney(cents(value));
  const trend = cashTrendValues(overview.monthEndCash, startMonth);
  const source = traceSourceOf(null, overview.cashTraceRef);
  return (
    <KpiCard
      label="Cash"
      icon="finance"
      value={formatMoney(cents(overview.cash))}
      tone={overview.cash < 0 ? 'negative' : 'neutral'}
      trend={{ values: trend, period: 'last 12 months', formatValue }}
      footer={
        trend.length < 2
          ? `${NO_TREND_TEXT}: the line starts after a month of play`
          : overview.cash < 0
            ? 'In the red: costs are still paid'
            : 'Month-end cash, last 12 months'
      }
      {...(source === null
        ? {}
        : { why: <WhyButton label="Cash" value={overview.cash} unit="money" source={source} /> })}
    />
  );
}

/** This month's income less its costs, as a trace the Why? panel can read. */
export function thisMonthTrace(month: FinanceOverview['thisMonth']): TraceNode {
  return startCalc(
    "This month's net",
    inputOf('Income this month', month.income, undefined, 'money'),
    {
      unit: 'money',
    },
  )
    .add('Costs this month', month.costs)
    .done().trace;
}

/** A word joiner after the minus sign, so `−$19K` never breaks across two lines. */
function keepTogether(amount: string): string {
  return amount.replace(MINUS_SIGN, `${MINUS_SIGN}\u2060`);
}

export interface ThisMonthKpiCardProps {
  readonly overview: FinanceOverview;
}

/** This month's net so far, against last month's, with income and costs written out. */
export function ThisMonthKpiCard({ overview }: ThisMonthKpiCardProps) {
  const moneyStyle = useSettingsStore((state) => state.settings.moneyStyle);
  const signed = (amount: number, showPlus = false): string =>
    formatSignedMoney(cents(amount), { style: moneyStyle, showPlus });
  const { thisMonth, lastMonth } = overview;
  const change = lastMonth === null ? null : thisMonth.net - lastMonth.net;
  return (
    <KpiCard
      label="This month so far"
      icon="calendar"
      value={signed(thisMonth.net, true)}
      tone={thisMonth.net < 0 ? 'negative' : 'neutral'}
      {...(change === null
        ? {}
        : {
            delta: {
              value: change,
              display: signed(change, true),
              suffix: 'vs last month',
            },
          })}
      footer={`Income ${keepTogether(signed(thisMonth.income))} · Costs ${keepTogether(signed(thisMonth.costs))}`}
      why={
        <WhyButton
          label="This month's net"
          value={thisMonth.net}
          unit="money"
          source={{ trace: thisMonthTrace(thisMonth) }}
        />
      }
    />
  );
}

export interface PayrollKpiCardProps {
  readonly overview: FinanceOverview;
}

/** What the paid contracts cost a month, and what one day's Wages row comes to. */
export function PayrollKpiCard({ overview }: PayrollKpiCardProps) {
  const formatMoney = useMoneyFormatter();
  const contracts = overview.paidContracts;
  return (
    <KpiCard
      label="Projected payroll"
      icon="contracts"
      value={formatMoney(cents(overview.monthlyPayroll))}
      unit="/month"
      footer={`Paid daily: ${formatMoney(cents(overview.dailyWages))}/day · ${formatNumber(contracts)} paid ${contracts === 1 ? 'contract' : 'contracts'}`}
      why={
        <WhyButton
          label="Projected payroll"
          value={overview.monthlyPayroll}
          unit="money"
          source={{ trace: overview.monthlyPayrollTrace }}
        />
      }
    />
  );
}

/** Reach as it is shown: one decimal. */
export function roundedReach(reach: number): number {
  return Math.round(reach * 10) / 10;
}

export interface CompanySizeKpiCardProps {
  readonly company: CompanyView;
}

/** The company's size label with its Why?, reach with its own, and the next size up. */
export function CompanySizeKpiCard({ company }: CompanySizeKpiCardProps) {
  const reach = roundedReach(company.reach);
  return (
    <KpiCard
      label="Company size"
      icon="building"
      value={company.sizeLabel}
      footer={
        <span className={styles['kpiFooterLine']}>
          <span className={styles['reach']}>
            Reach <Explained value={reach} label="Reach" trace={company.reachTrace} />
          </span>
          <span>
            {company.nextSize === null
              ? 'The largest size there is'
              : `${company.nextSize.label} at reach ${formatNumber(company.nextSize.at)}`}
          </span>
        </span>
      }
      why={
        <WhyButton
          label="Company size"
          value={company.sizeLabel}
          source={{ trace: company.sizeTrace }}
        />
      }
    />
  );
}

/** The Cash card, with the start month from `finance.monthly` for its sparkline. */
export function CashKpi({ promotionId, overview }: FinanceKpiProps) {
  const monthly = useEngineQuery('finance.monthly', { promotionId, months: CASH_TREND_MONTHS });
  return <CashKpiCard overview={overview} startMonth={monthly.data?.startMonth ?? null} />;
}

/** The Company size card, from `finance.company`. Nothing while it loads or if it is refused. */
export function CompanySizeKpi({ promotionId }: { readonly promotionId: PromotionId }) {
  const company = useEngineQuery('finance.company', { promotionId });
  if (company.data === undefined) return null;
  return <CompanySizeKpiCard company={company.data} />;
}
