import { useSyncExternalStore } from 'react';
import type { GameDate } from '@ringside/engine';
import type { AdvanceRequest } from '@/worker/engineHost';

/** What one skip target asks for today: the advance, and a line under its label. */
export interface SkipTargetChoice {
  readonly request: AdvanceRequest;
  /** Shown under the label, for example "Mon 1 Feb 2027 · 28 days". */
  readonly detail: string;
}

/**
 * One quick choice in the Skip days sheet's "How long": "7 days", "Until the 1st of next month",
 * or a feature's own ("Until next show").
 */
export interface SkipTarget {
  /** Unique, such as `days.7` or `month.next`. Remembered per browser as the last choice. */
  readonly id: string;
  /** The chip's words, which are also its accessible name. */
  readonly label: string;
  /** Its place among the chips, lowest first. */
  readonly order: number;
  /**
   * A hook: what the target means today, or null to hide its chip (nothing to skip to). It may
   * call engine hooks such as `useEngineQuery`. The sheet calls every registered target's hook on
   * every render, in registration order, so the order of hooks stays the same.
   */
  readonly useResolve: (today: GameDate) => SkipTargetChoice | null;
}

/** A target that showed a chip today, with what it asks for. */
export interface ResolvedSkipTarget {
  readonly target: SkipTarget;
  readonly choice: SkipTargetChoice;
}

let registered: readonly SkipTarget[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Code-unit order, so ties never depend on the browser's locale. */
function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function byOrderThenId(left: SkipTarget, right: SkipTarget): number {
  return left.order - right.order || compareIds(left.id, right.id);
}

/**
 * Adds a quick choice to the Skip days sheet without editing the sheet. Returns a function that
 * removes it again (for tests). Throws when the id is already taken.
 */
export function registerSkipTarget(target: SkipTarget): () => void {
  if (registered.some((existing) => existing.id === target.id)) {
    throw new Error(`A skip target with id "${target.id}" is already registered.`);
  }
  registered = [...registered, target];
  notify();
  return () => {
    const before = registered.length;
    registered = registered.filter((existing) => existing !== target);
    if (registered.length !== before) notify();
  };
}

/** Every registered target, lowest `order` first, then by id. */
export function skipTargets(): readonly SkipTarget[] {
  return [...registered].sort(byOrderThenId);
}

/** The registered target with this id, if any. */
export function skipTarget(id: string): SkipTarget | undefined {
  return registered.find((target) => target.id === id);
}

function registeredInOrder(): readonly SkipTarget[] {
  return registered;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * The registered targets in registration order, kept current. A component that resolves them
 * should be keyed on this list (it is a new array whenever a target is added or removed), so a
 * late registration remounts it rather than changing its number of hooks.
 */
export function useRegisteredSkipTargets(): readonly SkipTarget[] {
  return useSyncExternalStore(subscribe, registeredInOrder, registeredInOrder);
}

/**
 * Resolves `targets` (registration order, from {@link useRegisteredSkipTargets}) for `today`:
 * calls every target's `useResolve`, in that order, then drops the hidden ones and sorts the rest
 * by `order`, then id.
 */
export function useResolvedSkipTargets(
  targets: readonly SkipTarget[],
  today: GameDate,
): readonly ResolvedSkipTarget[] {
  const resolved: ResolvedSkipTarget[] = [];
  for (const target of targets) {
    // The list is fixed for the component's life (its parent keys it on the list), so the hooks
    // run in the same order on every render.
    const choice = target.useResolve(today);
    if (choice !== null) resolved.push({ target, choice });
  }
  return resolved.sort((left, right) => byOrderThenId(left.target, right.target));
}
