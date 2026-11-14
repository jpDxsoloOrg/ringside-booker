import type { ReactNode } from 'react';
import type { DealId, NetworkId, PromotionId } from '@ringside/engine';
import { createExtensionRegistry, sortedByOrder } from '@/components/extensionRegistry';

/**
 * Business > Networks' tab strip as a registry, like the status chips and the Finances tabs:
 * the screen draws whatever is registered, so ECO10 adds "Your service" from its own folder
 * without editing the screen. See README.md here.
 */

/** What a Networks tab is drawn with. */
export interface NetworksTabContext {
  /** The promotion the local seat runs. */
  readonly promotionId: PromotionId;
  /** Selects another tab (its id), as the tab strip would. */
  readonly openTab: (tabId: string) => void;
  /** Opens the deal sheet on one of the promotion's deals (`?deal=`). */
  readonly openDeal: (dealId: DealId) => void;
  /** Opens the Propose sheet on a network (`?propose=`). */
  readonly openPropose: (networkId: NetworkId) => void;
  /** A deal just signed: its row takes focus once it is on screen. Null otherwise. */
  readonly focusDealId: DealId | null;
  /** The row took focus: stop asking. */
  readonly onDealFocused: () => void;
}

/** One tab on Business > Networks. */
export interface NetworksTabDefinition {
  /** Unique, prefixed with the feature (`eco.yourDeals`), and what the URL carries: `?tab=<id>`. */
  readonly id: string;
  /**
   * Its place in the strip, lowest first; ties go in the order registered. Your deals is 10,
   * Available networks 20; ECO10's Your service takes 30.
   */
  readonly order: number;
  /** The words on the tab. */
  readonly label: string;
  /** Draws the tab's panel. Only called while the tab is selected, so it may run its own queries. */
  readonly render: (context: NetworksTabContext) => ReactNode;
}

const tabs = createExtensionRegistry<NetworksTabDefinition>('A Networks tab');

/**
 * Adds a tab to the Networks screen, in `order` among the others. Returns a function that removes
 * it again; throws when the id is already taken.
 */
export function registerNetworksTab(definition: NetworksTabDefinition): () => void {
  return tabs.register(definition);
}

/** Every registered tab, lowest `order` first. */
export function networksTabs(): readonly NetworksTabDefinition[] {
  return sortedByOrder(tabs.list());
}

/** The tabs in order, kept current as features add and remove theirs. */
export function useNetworksTabs(): readonly NetworksTabDefinition[] {
  return sortedByOrder(tabs.useDefinitions());
}
