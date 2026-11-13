import { useSearchParams } from 'react-router-dom';
import type { PromotionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { FINANCES_PARAMS } from '@/app/routes';
import { Tab, TabList, TabPanel, Tabs } from '@/components/Tabs';
import './builtins';
import { DEFAULT_FINANCE_TAB_ID } from './financeParams';
import { useFinanceTabs } from './financeRegistry';
import type { FinanceTabProps } from './financeRegistry';
import { FinanceQueryError } from './financeParts';
import styles from './Finances.module.css';

export interface FinancesViewProps {
  readonly promotionId: PromotionId;
}

/**
 * The tabs of the Finances screen, built from `listFinanceTabs()`. The selected tab is `?tab=` in
 * the URL; an unknown or hidden one falls back to Overview. Changing tab drops the Ledger's
 * filters, which belong to the Ledger.
 *
 * The books are private, so the overview is asked for first: a seat that may not read them (or a
 * world that cannot answer) sees the engine's reason instead of four tabs of errors.
 */
export function FinancesView({ promotionId }: FinancesViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const overview = useEngineQuery('finance.overview', { promotionId });
  const props: FinanceTabProps = { promotionId };
  const tabs = useFinanceTabs().filter((tab) => tab.visible?.(props) ?? true);
  const requested = searchParams.get(FINANCES_PARAMS.tab);
  const selected = tabs.find((tab) => tab.id === requested)?.id ?? DEFAULT_FINANCE_TAB_ID;

  if (overview.status === 'error') {
    return <FinanceQueryError error={overview.error} title="The books can't be shown" />;
  }

  const select = (tabId: string): void => {
    const next = new URLSearchParams();
    if (tabId !== DEFAULT_FINANCE_TAB_ID) next.set(FINANCES_PARAMS.tab, tabId);
    // Replace, so Back leaves Finances instead of stepping through its tabs.
    setSearchParams(next, { replace: true });
  };

  return (
    <Tabs value={selected} onChange={select} className={styles['tabs'] ?? ''}>
      <TabList label="Finances sections">
        {tabs.map((tab) => (
          <Tab key={tab.id} value={tab.id}>
            {tab.label}
          </Tab>
        ))}
      </TabList>
      {tabs.map((tab) => (
        <TabPanel key={tab.id} value={tab.id} className={styles['panel'] ?? ''}>
          {tab.id === selected ? tab.render(props) : null}
        </TabPanel>
      ))}
    </Tabs>
  );
}
