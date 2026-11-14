/**
 * ECO4-04's three contract lists as registered Contracts tabs: Active (10), Expiring (20) and
 * Ended (30), drawn by the screen's own list. Loaded by the screen, so they are always there.
 */
import type { ContractsTab } from '@ringside/engine';
import { CONTRACT_TAB_LABELS, CONTRACT_TABS } from './contractsParams';
import { registerContractsTab } from './contractsTabs';
import type { ContractsTabDefinition } from './contractsTabs';

const ORDERS: Readonly<Record<ContractsTab, number>> = { active: 10, expiring: 20, ended: 30 };

export const BUILTIN_CONTRACTS_TABS: readonly ContractsTabDefinition[] = CONTRACT_TABS.map(
  (tab) => ({
    id: tab,
    label: CONTRACT_TAB_LABELS[tab],
    order: ORDERS[tab],
    render: (context) => context.contractList(tab),
  }),
);

for (const tab of BUILTIN_CONTRACTS_TABS) registerContractsTab(tab);
