import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { PromotionId, PromotionProfile } from '@ringside/engine';

/** What a promotion profile tab is drawn from. */
export interface PromotionTabContext {
  /** The engine's `promotions.profile` answer for the local seat. */
  readonly profile: PromotionProfile;
  readonly promotionId: PromotionId;
  /** True when the local seat runs this promotion. */
  readonly isOwn: boolean;
  /** The promotion the local seat runs, or null while it runs none. */
  readonly viewerPromotionId: PromotionId | null;
}

/** One tab on the promotion profile. */
export interface PromotionTabDefinition {
  /** Unique, and what the URL carries: `?tab=<id>`. Letters, digits and dashes. */
  readonly id: string;
  /** The words on the tab. */
  readonly label: string;
  /**
   * Its place in the strip, lowest first. The built-in tabs use 10 (Overview), 20 (Roster) and 90
   * (Decision log). The rival desk's later screens use 30 to 80 (Front office 30, Shows 40); any
   * other feature uses 100 and up. Say which in the feature's own docs so no two fight for a slot.
   */
  readonly order: number;
  /** Draws the tab's panel. Only called while the tab is selected. */
  readonly render: (context: PromotionTabContext) => ReactNode;
  /** Return false to leave the tab out for this promotion. */
  readonly visible?: (context: PromotionTabContext) => boolean;
}

/** The ids of the built-in tabs. `overview` is always shown and is where a bad `?tab=` lands. */
export const BUILTIN_PROMOTION_TAB_IDS = ['overview', 'roster', 'decision-log'] as const;
export type BuiltinPromotionTabId = (typeof BUILTIN_PROMOTION_TAB_IDS)[number];

/** The tab shown when the URL names none, or one that is unknown or hidden. */
export const DEFAULT_PROMOTION_TAB_ID: BuiltinPromotionTabId = 'overview';

/** The order band the rival desk's own later tabs use (AIP2 to AIP8). */
export const RIVAL_DESK_TAB_ORDERS = { first: 30, last: 80 } as const;

/** The lowest `order` a tab from any other feature should use. */
export const FIRST_FEATURE_PROMOTION_TAB_ORDER = 100;

let registered: readonly PromotionTabDefinition[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function isBuiltinId(id: string): boolean {
  return BUILTIN_PROMOTION_TAB_IDS.some((builtinId) => builtinId === id);
}

/**
 * Adds a tab to every promotion profile, in `order` among the others, without editing the
 * profile screen. Returns a function that removes it again. Throws when the id is already taken,
 * by a built-in tab or by another registered one.
 */
export function registerPromotionTab(definition: PromotionTabDefinition): () => void {
  if (isBuiltinId(definition.id) || registered.some((tab) => tab.id === definition.id)) {
    throw new Error(`A promotion tab with id "${definition.id}" is already registered.`);
  }
  registered = [...registered, definition];
  notify();
  return () => {
    const before = registered.length;
    registered = registered.filter((tab) => tab !== definition);
    if (registered.length !== before) notify();
  };
}

/** Every tab registered by a feature, in registration order. The built-in tabs are not in it. */
export function registeredPromotionTabs(): readonly PromotionTabDefinition[] {
  return registered;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The tabs registered by features, kept current as they add and remove theirs. */
export function usePromotionTabs(): readonly PromotionTabDefinition[] {
  return useSyncExternalStore(subscribe, registeredPromotionTabs, registeredPromotionTabs);
}

/** The tabs to show for one promotion: ordered (ties in the order given), hidden ones out. */
export function visiblePromotionTabs(
  tabs: readonly PromotionTabDefinition[],
  context: PromotionTabContext,
): readonly PromotionTabDefinition[] {
  return tabs
    .map((tab, index) => ({ tab, index }))
    .sort((left, right) => left.tab.order - right.tab.order || left.index - right.index)
    .map(({ tab }) => tab)
    .filter((tab) => tab.visible?.(context) ?? true);
}
