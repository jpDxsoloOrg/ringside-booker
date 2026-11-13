import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { ROSTER_ROLE_GROUPS } from '@ringside/engine';
import type { BrandId, PromotionId, RosterSummary } from '@ringside/engine';

/**
 * Extra tabs on Your promotion > Roster, added by later features without editing the screen.
 *
 * The built-in role tabs (Wrestlers to Others) take orders 10 to 60, ten apart. Reserved:
 *
 * - 70: WRK6 "Injuries";
 * - 80: ECO11 "In development".
 *
 * Tabs are drawn lowest `order` first, so a registered tab at 70 or more comes after the role
 * tabs. `?tab=<id>` in the URL opens a registered tab like a built-in one.
 */

/** What a registered tab is drawn from. */
export interface RosterTabContext {
  /** The promotion whose roster is open. */
  readonly promotionId: PromotionId;
  /** The brand the player narrowed the roster to, `'shared'` for no brand, or null for all. */
  readonly brandId: BrandId | 'shared' | null;
  /** `roster.summary` for that promotion and brand. */
  readonly summary: RosterSummary;
}

export interface RosterTabDefinition {
  /** Unique, and the `?tab=` value: `injuries`. Must not be a role group's id. */
  readonly id: string;
  /** The tab's text: "Injuries". */
  readonly label: string;
  /** Its place among the tabs, lowest first (see the reserved orders above). */
  readonly order: number;
  /** The tab's panel. */
  readonly render: (context: RosterTabContext) => ReactNode;
  /** The number in the tab's badge. No badge when left out. */
  readonly count?: (context: RosterTabContext) => number;
}

/** The orders of the built-in role tabs. */
export const BUILT_IN_TAB_ORDER_START = 10;
export const BUILT_IN_TAB_ORDER_STEP = 10;

const BUILT_IN_IDS: ReadonlySet<string> = new Set(ROSTER_ROLE_GROUPS);

let registered: readonly RosterTabDefinition[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Adds a tab to the roster. Returns a function that removes it again. Throws when the id is taken,
 * by another registered tab or by a role tab.
 */
export function registerRosterTab(definition: RosterTabDefinition): () => void {
  if (BUILT_IN_IDS.has(definition.id) || registered.some((tab) => tab.id === definition.id)) {
    throw new Error(`A roster tab with id "${definition.id}" is already registered.`);
  }
  registered = [...registered, definition].sort((left, right) => left.order - right.order);
  notify();
  return () => {
    const before = registered.length;
    registered = registered.filter((tab) => tab !== definition);
    if (registered.length !== before) notify();
  };
}

/** True when a tab with this id is registered (WRK6 asks for "injuries"). Role tabs do not count. */
export function isRosterTabRegistered(id: string): boolean {
  return registered.some((tab) => tab.id === id);
}

/** Every registered tab, lowest `order` first, ties in registration order. */
export function registeredRosterTabs(): readonly RosterTabDefinition[] {
  return registered;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The registered tabs, kept current as features add and remove theirs. */
export function useRosterTabs(): readonly RosterTabDefinition[] {
  return useSyncExternalStore(subscribe, registeredRosterTabs, registeredRosterTabs);
}
