import { afterEach, describe, expect, it } from 'vitest';
import { createExtensionRegistry, sortedByOrder } from '@/components/extensionRegistry';
import {
  registerCalendarDayMarkers,
  registerCalendarToolbarItem,
  registeredShowChipBadges,
  registerShowChipBadge,
  registerShowSheetAction,
  registerShowSheetSection,
} from './registry';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const unregister of cleanups.splice(0)) unregister();
});

describe('createExtensionRegistry', () => {
  it('lists definitions in registration order and removes them again', () => {
    const registry = createExtensionRegistry<{ id: string }>('A test thing');
    const first = { id: 'first' };
    const second = { id: 'second' };
    const removeFirst = registry.register(first);
    registry.register(second);
    expect(registry.list()).toEqual([first, second]);

    removeFirst();
    expect(registry.list()).toEqual([second]);
    // Removing twice is harmless.
    removeFirst();
    expect(registry.list()).toEqual([second]);
  });

  it('throws for an id that is already taken, naming what it is', () => {
    const registry = createExtensionRegistry<{ id: string }>('A test thing');
    registry.register({ id: 'taken' });
    expect(() => registry.register({ id: 'taken' })).toThrow(
      'A test thing with id "taken" is already registered.',
    );
  });

  it('frees an id once its definition is removed', () => {
    const registry = createExtensionRegistry<{ id: string }>('A test thing');
    const remove = registry.register({ id: 'reused' });
    remove();
    expect(() => registry.register({ id: 'reused' })).not.toThrow();
  });

  it('sorts by order, keeping ties in the order given', () => {
    const items = [
      { id: 'c', order: 30 },
      { id: 'a', order: 10 },
      { id: 'b1', order: 20 },
      { id: 'b2', order: 20 },
    ];
    expect(sortedByOrder(items).map((item) => item.id)).toEqual(['a', 'b1', 'b2', 'c']);
  });
});

describe('the calendar slots', () => {
  it('each refuse a second definition with the same id', () => {
    cleanups.push(
      registerShowSheetAction({ id: 'test.dup', order: 10, render: () => null }),
      registerShowSheetSection({ id: 'test.dup', order: 10, title: 'Test', render: () => null }),
      registerShowChipBadge({ id: 'test.dup', order: 10, render: () => null }),
      registerCalendarDayMarkers({ id: 'test.dup', useMarkers: () => [] }),
      registerCalendarToolbarItem({ id: 'test.dup', order: 10, render: () => null }),
    );

    expect(() =>
      registerShowSheetAction({ id: 'test.dup', order: 20, render: () => null }),
    ).toThrow('A show sheet action with id "test.dup" is already registered.');
    expect(() =>
      registerShowSheetSection({ id: 'test.dup', order: 20, title: 'Other', render: () => null }),
    ).toThrow('A show sheet section with id "test.dup" is already registered.');
    expect(() => registerShowChipBadge({ id: 'test.dup', order: 20, render: () => null })).toThrow(
      'A show chip badge with id "test.dup" is already registered.',
    );
    expect(() => registerCalendarDayMarkers({ id: 'test.dup', useMarkers: () => [] })).toThrow(
      'A calendar day marker source with id "test.dup" is already registered.',
    );
    expect(() =>
      registerCalendarToolbarItem({ id: 'test.dup', order: 20, render: () => null }),
    ).toThrow('A calendar toolbar item with id "test.dup" is already registered.');
  });

  it('keeps the same id free to use in different slots, and frees it on unregister', () => {
    const removeBadge = registerShowChipBadge({ id: 'test.badge', order: 10, render: () => null });
    expect(registeredShowChipBadges().map((badge) => badge.id)).toContain('test.badge');
    removeBadge();
    expect(registeredShowChipBadges().map((badge) => badge.id)).not.toContain('test.badge');
    cleanups.push(registerShowChipBadge({ id: 'test.badge', order: 10, render: () => null }));
  });
});
