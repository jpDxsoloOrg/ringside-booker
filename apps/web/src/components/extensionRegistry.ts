import { useSyncExternalStore } from 'react';

/**
 * A list other features add to without editing the screen that draws it: status chips, profile
 * tabs, the calendar's slots. Every registry behaves the same way, so they are built here once.
 */
export interface ExtensionRegistry<Definition extends { readonly id: string }> {
  /**
   * Adds a definition. Returns a function that removes it again. Throws when the id is already
   * taken.
   */
  readonly register: (definition: Definition) => () => void;
  /** Every registered definition, in registration order. */
  readonly list: () => readonly Definition[];
  /** The same list as a hook, kept current as features add and remove theirs. */
  readonly useDefinitions: () => readonly Definition[];
}

/** `what` names one definition in the duplicate-id error: "A show sheet action with id ...". */
export function createExtensionRegistry<Definition extends { readonly id: string }>(
  what: string,
): ExtensionRegistry<Definition> {
  let registered: readonly Definition[] = [];
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const list = (): readonly Definition[] => registered;
  const subscribe = (onChange: () => void): (() => void) => {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  };

  return {
    register: (definition) => {
      if (registered.some((existing) => existing.id === definition.id)) {
        throw new Error(`${what} with id "${definition.id}" is already registered.`);
      }
      registered = [...registered, definition];
      notify();
      return () => {
        const before = registered.length;
        registered = registered.filter((existing) => existing !== definition);
        if (registered.length !== before) notify();
      };
    },
    list,
    useDefinitions: () => useSyncExternalStore(subscribe, list, list),
  };
}

/** Definitions lowest `order` first, ties in the order given. */
export function sortedByOrder<Definition extends { readonly order: number }>(
  definitions: readonly Definition[],
): readonly Definition[] {
  return definitions
    .map((definition, index) => ({ definition, index }))
    .sort(
      (left, right) => left.definition.order - right.definition.order || left.index - right.index,
    )
    .map(({ definition }) => definition);
}
