import { useSyncExternalStore } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { ContractsTab, PromotionId } from '@ringside/engine';
import type { NegotiationTarget } from './contractsParams';

/** What a Contracts tab is drawn with. */
export interface ContractsTabContext {
  /** The promotion the local seat runs, or null while it runs none. */
  readonly promotionId: PromotionId | null;
  /** Opens the Negotiation Sheet on talks, a new offer or a renewal (it lives in the URL). */
  readonly openNegotiation: (target: NegotiationTarget) => void;
  /** ECO4's contract list for one of its tabs (Active, Expiring, Ended), with its filters. */
  readonly contractList: (tab: ContractsTab) => ReactNode;
}

/** One tab on Business › Contracts. */
export interface ContractsTabDefinition {
  /** Unique, and what the URL carries: `?tab=<id>`. Letters, digits and dashes. */
  readonly id: string;
  /** The words on the tab. */
  readonly label: string;
  /**
   * Its place in the strip, lowest first: Active 10, Expiring 20, Ended 30, Free agents 40,
   * Offers 50. ECO6's Market and later tabs use 60 and up.
   */
  readonly order: number;
  /** Draws the tab's panel. Only called while the tab is selected. */
  readonly render: (context: ContractsTabContext) => ReactNode;
  /** A small count after the label (Offers' countered talks), drawn as a component. */
  readonly badge?: ComponentType;
}

let registered: readonly ContractsTabDefinition[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Adds a tab to the Contracts screen, in `order` among the others, without editing the screen
 * (same rules as `registerStatusChip` and `registerProfileTab`). Returns a function that removes
 * it again. Throws when the id is already taken.
 */
export function registerContractsTab(definition: ContractsTabDefinition): () => void {
  if (registered.some((tab) => tab.id === definition.id)) {
    throw new Error(`A Contracts tab with id "${definition.id}" is already registered.`);
  }
  registered = [...registered, definition];
  notify();
  return () => {
    const before = registered.length;
    registered = registered.filter((tab) => tab !== definition);
    if (registered.length !== before) notify();
  };
}

/** Every registered tab, lowest `order` first, ties in registration order. */
export function contractsTabs(): readonly ContractsTabDefinition[] {
  return registered;
}

/** Tabs lowest `order` first, ties in the order given. */
export function orderContractsTabs(
  tabs: readonly ContractsTabDefinition[],
): readonly ContractsTabDefinition[] {
  return tabs
    .map((tab, index) => ({ tab, index }))
    .sort((left, right) => left.tab.order - right.tab.order || left.index - right.index)
    .map(({ tab }) => tab);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The registered tabs, kept current as features add and remove theirs. */
export function useContractsTabs(): readonly ContractsTabDefinition[] {
  return useSyncExternalStore(subscribe, contractsTabs, contractsTabs);
}
