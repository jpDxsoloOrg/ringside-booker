import { useSyncExternalStore } from 'react';
import type { ContractRow } from '@ringside/engine';

/**
 * Actions other features add to a contract (ECO5's Renew), shown in the contract's sheet beside
 * Release, without editing the Contracts screen. Until one is registered for expiring contracts,
 * the Expiring tab says renewals arrive with contract negotiation.
 */
export interface ContractRowAction {
  /** Unique, such as `renew`. */
  readonly id: string;
  /** The button's words. */
  readonly label: string;
  /** Whether the action applies to this contract. */
  readonly visible: (row: ContractRow) => boolean;
  /** Does it. The sheet stays open; the screen refetches when the world changes. */
  readonly run: (row: ContractRow) => void | Promise<void>;
}

let registered: readonly ContractRowAction[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Adds an action to every contract it is visible for. Returns a function that removes it. */
export function registerContractRowAction(action: ContractRowAction): () => void {
  if (registered.some((other) => other.id === action.id)) {
    throw new Error(`A contract action with id "${action.id}" is already registered.`);
  }
  registered = [...registered, action];
  notify();
  return () => {
    const before = registered.length;
    registered = registered.filter((other) => other !== action);
    if (registered.length !== before) notify();
  };
}

export function contractRowActions(): readonly ContractRowAction[] {
  return registered;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The registered actions, kept current as features add and remove theirs. */
export function useContractRowActions(): readonly ContractRowAction[] {
  return useSyncExternalStore(subscribe, contractRowActions, contractRowActions);
}
