import { decisionLogVisible, DecisionLogTab } from './tabs/DecisionLogTab';
import { OverviewTab } from './tabs/OverviewTab';
import { RosterTab } from './tabs/RosterTab';
import type { BuiltinPromotionTabId, PromotionTabDefinition } from './promotionTabs';

type BuiltinPromotionTab = PromotionTabDefinition & { readonly id: BuiltinPromotionTabId };

/**
 * The three tabs every promotion profile has. They own orders 10, 20 and 90; the rival desk's
 * later tabs use 30 to 80 and every other feature 100 and up, each with `registerPromotionTab`
 * (see `promotionTabs.ts`), never by editing this list.
 */
export const BUILTIN_PROMOTION_TABS: readonly BuiltinPromotionTab[] = [
  {
    id: 'overview',
    label: 'Overview',
    order: 10,
    render: (context) => <OverviewTab {...context} />,
  },
  {
    id: 'roster',
    label: 'Roster',
    order: 20,
    render: (context) => <RosterTab {...context} />,
  },
  {
    id: 'decision-log',
    label: 'Decision log',
    order: 90,
    render: (context) => <DecisionLogTab {...context} />,
    visible: decisionLogVisible,
  },
];
