import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { SimStatus } from '@ringside/engine';

/** Where a chip is drawn: the desktop top bar, or the phone's status sheet (which has more room). */
export type StatusChipPlacement = 'bar' | 'sheet';

/** What a chip is drawn from. */
export interface StatusChipContext {
  /** The engine's `sim.status` answer for the local seat. */
  readonly status: SimStatus;
  readonly placement: StatusChipPlacement;
  /**
   * Opens the Fan base sheet for the seat's promotion (DAY2-05). Set by the top bar, which owns
   * the one sheet and closes the phone's status sheet first; left out, a chip opens its own.
   */
  readonly openFanBase?: () => void;
}

/** One chip a system adds to the top bar, such as morale. */
export interface StatusChipDefinition {
  /** Unique, such as `social.morale`. */
  readonly id: string;
  /**
   * Its place among the chips, lowest first. The built-in chips use 5 (promotion name), 10 (cash)
   * and 20 (popularity), so a chip at 30 sits after them and one at 15 between cash and popularity.
   */
  readonly order: number;
  /** Draws the chip, or returns null to hide it (for example a seat with no promotion). */
  readonly render: (context: StatusChipContext) => ReactNode;
}

let registered: readonly StatusChipDefinition[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Adds a chip to the top bar, after the date and in `order` among the others, without editing the
 * top bar itself. Returns a function that removes it again. Throws when the id is already taken.
 */
export function registerStatusChip(definition: StatusChipDefinition): () => void {
  if (registered.some((chip) => chip.id === definition.id)) {
    throw new Error(`A status chip with id "${definition.id}" is already registered.`);
  }
  registered = [...registered, definition];
  notify();
  return () => {
    const before = registered.length;
    registered = registered.filter((chip) => chip !== definition);
    if (registered.length !== before) notify();
  };
}

/** Every registered chip, in registration order. */
export function registeredStatusChips(): readonly StatusChipDefinition[] {
  return registered;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The registered chips, kept current as systems add and remove theirs. */
export function useRegisteredStatusChips(): readonly StatusChipDefinition[] {
  return useSyncExternalStore(subscribe, registeredStatusChips, registeredStatusChips);
}

/** Built-in and registered chips together, lowest `order` first, ties in the order given. */
export function orderStatusChips(
  chips: readonly StatusChipDefinition[],
): readonly StatusChipDefinition[] {
  return chips
    .map((chip, index) => ({ chip, index }))
    .sort((left, right) => left.chip.order - right.chip.order || left.index - right.index)
    .map(({ chip }) => chip);
}
