import { CashKpi, CompanySizeKpi, PayrollKpiCard, ThisMonthKpiCard } from './kpis';
import { FINANCE_TAB_IDS } from './financeParams';
import { registerBuiltinFinanceKpi, registerBuiltinFinanceTab } from './financeRegistry';
import { LedgerTab } from './LedgerTab';
import { MonthlyTab } from './MonthlyTab';
import { OverviewTab } from './OverviewTab';
import { PoliciesTab } from './PoliciesTab';

/**
 * The screen's own tabs and KPI cards, registered once when the screen's chunk loads. They own
 * orders 10, 20, 30 and 40; features fill the gaps (see README.md).
 */
registerBuiltinFinanceTab({
  id: FINANCE_TAB_IDS.overview,
  label: 'Overview',
  order: 10,
  render: ({ promotionId }) => <OverviewTab promotionId={promotionId} />,
});
registerBuiltinFinanceTab({
  id: FINANCE_TAB_IDS.monthly,
  label: 'Monthly',
  order: 20,
  render: ({ promotionId }) => <MonthlyTab promotionId={promotionId} />,
});
registerBuiltinFinanceTab({
  id: FINANCE_TAB_IDS.ledger,
  label: 'Ledger',
  order: 30,
  render: ({ promotionId }) => <LedgerTab promotionId={promotionId} />,
});
registerBuiltinFinanceTab({
  id: FINANCE_TAB_IDS.policies,
  label: 'Policies',
  order: 40,
  render: ({ promotionId }) => <PoliciesTab promotionId={promotionId} />,
});

registerBuiltinFinanceKpi({
  id: 'finance.cash',
  order: 10,
  render: (props) => <CashKpi {...props} />,
});
registerBuiltinFinanceKpi({
  id: 'finance.thisMonth',
  order: 20,
  render: ({ overview }) => <ThisMonthKpiCard overview={overview} />,
});
registerBuiltinFinanceKpi({
  id: 'finance.payroll',
  order: 30,
  render: ({ overview }) => <PayrollKpiCard overview={overview} />,
});
registerBuiltinFinanceKpi({
  id: 'finance.companySize',
  order: 40,
  render: ({ promotionId }) => <CompanySizeKpi promotionId={promotionId} />,
});
