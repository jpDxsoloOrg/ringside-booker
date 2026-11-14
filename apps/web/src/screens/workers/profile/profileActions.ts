import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { ProfileTabContext } from './profileTabs';

/** One action in the worker profile's header (ECO5-06's Offer contract / Renew contract). */
export interface ProfileActionDefinition {
  /** Unique, such as `contract`. */
  readonly id: string;
  /** Its place in the row, lowest first. */
  readonly order: number;
  /**
   * Draws the action for one profile, or null to leave it out. Called as a component child, so it
   * may return components that read the engine.
   */
  readonly render: (context: ProfileTabContext) => ReactNode;
}

let registered: readonly ProfileActionDefinition[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Adds an action under the worker profile's header, in `order` among the others, without editing
 * the profile screen (same rules as `registerProfileTab`). Returns a function that removes it.
 * Throws when the id is already taken.
 */
export function registerProfileAction(definition: ProfileActionDefinition): () => void {
  if (registered.some((action) => action.id === definition.id)) {
    throw new Error(`A profile action with id "${definition.id}" is already registered.`);
  }
  registered = [...registered, definition];
  notify();
  return () => {
    const before = registered.length;
    registered = registered.filter((action) => action !== definition);
    if (registered.length !== before) notify();
  };
}

/** Every registered action, lowest `order` first, ties in registration order. */
export function profileActions(): readonly ProfileActionDefinition[] {
  return registered;
}

export function orderProfileActions(
  actions: readonly ProfileActionDefinition[],
): readonly ProfileActionDefinition[] {
  return actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => left.action.order - right.action.order || left.index - right.index)
    .map(({ action }) => action);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The registered actions, kept current as features add and remove theirs. */
export function useProfileActions(): readonly ProfileActionDefinition[] {
  return useSyncExternalStore(subscribe, profileActions, profileActions);
}
