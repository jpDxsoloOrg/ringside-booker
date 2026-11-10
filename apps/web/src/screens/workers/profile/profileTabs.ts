import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { PersonId, PromotionId, WorkerProfile } from '@ringside/engine';

/** What a profile tab is drawn from. */
export interface ProfileTabContext {
  /** The engine's `workers.profile` answer for the local seat. */
  readonly profile: WorkerProfile;
  readonly personId: PersonId;
  /** The promotion the local seat runs, or null while it runs none. */
  readonly viewerPromotionId: PromotionId | null;
}

/** One tab on the worker profile. */
export interface ProfileTabDefinition {
  /** Unique, and what the URL carries: `?tab=<id>`. Letters, digits and dashes. */
  readonly id: string;
  /** The words on the tab. */
  readonly label: string;
  /**
   * Its place in the strip, lowest first. The built-in tabs use 10 (Overview), 20 (Attributes),
   * 30 (Popularity) and 40 (Career). Tabs added by other features use 50 and up, and say which in
   * their own docs so no two fight for a slot.
   */
  readonly order: number;
  /** Draws the tab's panel. Only called while the tab is selected. */
  readonly render: (context: ProfileTabContext) => ReactNode;
  /** Return false to leave the tab out for this profile (a Health tab for a crew member, say). */
  readonly visible?: (context: ProfileTabContext) => boolean;
}

/** The ids of the built-in tabs. `overview` is always shown and is where a bad `?tab=` lands. */
export const BUILTIN_PROFILE_TAB_IDS = ['overview', 'attributes', 'popularity', 'career'] as const;
export type BuiltinProfileTabId = (typeof BUILTIN_PROFILE_TAB_IDS)[number];

/** The tab shown when the URL names none, or one that is unknown or hidden. */
export const DEFAULT_PROFILE_TAB_ID: BuiltinProfileTabId = 'overview';

/** The lowest `order` a tab added by another feature should use. */
export const FIRST_FEATURE_TAB_ORDER = 50;

let registered: readonly ProfileTabDefinition[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function isBuiltinId(id: string): boolean {
  return BUILTIN_PROFILE_TAB_IDS.some((builtinId) => builtinId === id);
}

/**
 * Adds a tab to every worker profile, in `order` among the others, without editing the profile
 * screen. Returns a function that removes it again. Throws when the id is already taken, by a
 * built-in tab or by another registered one.
 */
export function registerProfileTab(definition: ProfileTabDefinition): () => void {
  if (isBuiltinId(definition.id) || registered.some((tab) => tab.id === definition.id)) {
    throw new Error(`A profile tab with id "${definition.id}" is already registered.`);
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
export function registeredProfileTabs(): readonly ProfileTabDefinition[] {
  return registered;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The tabs registered by features, kept current as they add and remove theirs. */
export function useProfileTabs(): readonly ProfileTabDefinition[] {
  return useSyncExternalStore(subscribe, registeredProfileTabs, registeredProfileTabs);
}

/** Tabs lowest `order` first, ties in the order given. */
export function orderProfileTabs(
  tabs: readonly ProfileTabDefinition[],
): readonly ProfileTabDefinition[] {
  return tabs
    .map((tab, index) => ({ tab, index }))
    .sort((left, right) => left.tab.order - right.tab.order || left.index - right.index)
    .map(({ tab }) => tab);
}

/** The tabs to show for one profile: built-in and registered together, ordered, hidden ones out. */
export function visibleProfileTabs(
  tabs: readonly ProfileTabDefinition[],
  context: ProfileTabContext,
): readonly ProfileTabDefinition[] {
  return orderProfileTabs(tabs).filter((tab) => tab.visible?.(context) ?? true);
}
