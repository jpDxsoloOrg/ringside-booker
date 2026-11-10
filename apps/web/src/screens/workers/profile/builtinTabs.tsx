import { AttributesTab } from './tabs/AttributesTab';
import { CareerTab } from './tabs/CareerTab';
import { OverviewTab } from './tabs/OverviewTab';
import { PopularityTab } from './tabs/PopularityTab';
import type { BuiltinProfileTabId, ProfileTabDefinition } from './profileTabs';

type BuiltinProfileTab = ProfileTabDefinition & { readonly id: BuiltinProfileTabId };

/**
 * The four tabs every profile has. They own orders 10 to 40; a feature that adds a tab registers
 * it with `registerProfileTab` at 50 or above (see `profileTabs.ts`), and never edits this list.
 */
export const BUILTIN_PROFILE_TABS: readonly BuiltinProfileTab[] = [
  {
    id: 'overview',
    label: 'Overview',
    order: 10,
    render: (context) => <OverviewTab {...context} />,
  },
  {
    id: 'attributes',
    label: 'Attributes',
    order: 20,
    render: (context) => <AttributesTab {...context} />,
  },
  {
    id: 'popularity',
    label: 'Popularity',
    order: 30,
    render: (context) => <PopularityTab {...context} />,
  },
  {
    id: 'career',
    label: 'Career',
    order: 40,
    render: (context) => <CareerTab {...context} />,
  },
];
