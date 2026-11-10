import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_PROFILE_TABS } from './builtinTabs';
import {
  BUILTIN_PROFILE_TAB_IDS,
  FIRST_FEATURE_TAB_ORDER,
  orderProfileTabs,
  registeredProfileTabs,
  registerProfileTab,
} from './profileTabs';
import type { ProfileTabDefinition } from './profileTabs';

function tab(id: string, order: number): ProfileTabDefinition {
  return { id, label: id, order, render: () => null };
}

const cleanups: (() => void)[] = [];

function register(definition: ProfileTabDefinition): () => void {
  const unregister = registerProfileTab(definition);
  cleanups.push(unregister);
  return unregister;
}

afterEach(() => {
  for (const unregister of cleanups.splice(0)) unregister();
});

describe('registerProfileTab', () => {
  it('adds a tab and the returned function removes it again', () => {
    const health = tab('health', 60);

    const unregister = register(health);
    expect(registeredProfileTabs()).toEqual([health]);

    unregister();
    expect(registeredProfileTabs()).toEqual([]);
  });

  it('throws for an id another registered tab already has', () => {
    register(tab('health', 60));

    expect(() => registerProfileTab(tab('health', 70))).toThrow(
      'A profile tab with id "health" is already registered.',
    );
    expect(registeredProfileTabs()).toHaveLength(1);
  });

  it.each(BUILTIN_PROFILE_TAB_IDS)('throws for the built-in id %s', (id) => {
    expect(() => registerProfileTab(tab(id, 60))).toThrow('already registered');
    expect(registeredProfileTabs()).toEqual([]);
  });

  it('lets the same id be registered again once it was removed', () => {
    register(tab('health', 60))();

    expect(() => register(tab('health', 60))).not.toThrow();
  });

  it('does nothing when the same unregister is called twice', () => {
    const unregister = register(tab('health', 60));
    const other = tab('development', 50);
    register(other);

    unregister();
    unregister();

    expect(registeredProfileTabs()).toEqual([other]);
  });
});

describe('built-in tabs', () => {
  it('are Overview, Attributes, Popularity and Career at 10, 20, 30 and 40', () => {
    expect(BUILTIN_PROFILE_TABS.map(({ id, label, order }) => ({ id, label, order }))).toEqual([
      { id: 'overview', label: 'Overview', order: 10 },
      { id: 'attributes', label: 'Attributes', order: 20 },
      { id: 'popularity', label: 'Popularity', order: 30 },
      { id: 'career', label: 'Career', order: 40 },
    ]);
    expect(BUILTIN_PROFILE_TABS.map((builtin) => builtin.id)).toEqual([...BUILTIN_PROFILE_TAB_IDS]);
  });

  it('all sit below the first order a feature tab uses', () => {
    for (const builtin of BUILTIN_PROFILE_TABS) {
      expect(builtin.order).toBeLessThan(FIRST_FEATURE_TAB_ORDER);
    }
  });
});

describe('orderProfileTabs', () => {
  it('sorts by order and keeps the given order for ties', () => {
    const tabs = [tab('c', 50), tab('a', 10), tab('d', 50), tab('b', 20)];

    expect(orderProfileTabs(tabs).map((ordered) => ordered.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never calls render', () => {
    const render = vi.fn(() => null);

    orderProfileTabs([{ ...tab('a', 10), render }]);

    expect(render).not.toHaveBeenCalled();
  });
});
