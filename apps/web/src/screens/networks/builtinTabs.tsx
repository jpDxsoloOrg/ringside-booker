/**
 * The two built-in Networks tabs: Your deals (10) and Available networks (20). Loaded by the
 * screen, so they are always there; ECO10 registers Your service (30) from its own folder.
 */
import { AvailableNetworksTab } from './AvailableNetworksTab';
import { AVAILABLE_TAB_ID, YOUR_DEALS_TAB_ID } from './networksParams';
import { networksTabs, registerNetworksTab } from './registry';
import type { NetworksTabDefinition } from './registry';
import { YourDealsTab } from './YourDealsTab';

export const BUILTIN_NETWORKS_TABS: readonly NetworksTabDefinition[] = [
  {
    id: YOUR_DEALS_TAB_ID,
    order: 10,
    label: 'Your deals',
    render: (context) => <YourDealsTab {...context} />,
  },
  {
    id: AVAILABLE_TAB_ID,
    order: 20,
    label: 'Available networks',
    render: (context) => <AvailableNetworksTab {...context} />,
  },
];

for (const tab of BUILTIN_NETWORKS_TABS) {
  // A module loaded twice (a hot reload in development) keeps the first registration.
  if (!networksTabs().some((existing) => existing.id === tab.id)) registerNetworksTab(tab);
}
