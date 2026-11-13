import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isRosterTabRegistered,
  registeredRosterTabs,
  registerRosterTab,
  useRosterTabs,
} from './rosterTabRegistry';
import type { RosterTabDefinition } from './rosterTabRegistry';

const cleanups: (() => void)[] = [];

function tab(id: string, order: number): RosterTabDefinition {
  return { id, label: id, order, render: () => null };
}

function register(definition: RosterTabDefinition): () => void {
  const unregister = registerRosterTab(definition);
  cleanups.push(unregister);
  return unregister;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('registerRosterTab', () => {
  it('keeps the tabs in order, lowest first, ties in registration order', () => {
    register(tab('test-80', 80));
    register(tab('test-70', 70));
    register(tab('test-70-again', 70));
    expect(registeredRosterTabs().map((each) => each.id)).toEqual([
      'test-70',
      'test-70-again',
      'test-80',
    ]);
    expect(isRosterTabRegistered('test-70')).toBe(true);
    expect(isRosterTabRegistered('wrestlers')).toBe(false);
  });

  it('refuses an id that is taken, by a registered tab or a role tab', () => {
    register(tab('test-injuries', 70));
    expect(() => registerRosterTab(tab('test-injuries', 75))).toThrow(/already registered/);
    expect(() => registerRosterTab(tab('referees', 75))).toThrow(/already registered/);
  });

  it('removes the tab again, and tells the hook', () => {
    const { result } = renderHook(() => useRosterTabs());
    expect(result.current).toEqual([]);

    let unregister: () => void = () => undefined;
    act(() => {
      unregister = register(tab('test-injuries', 70));
    });
    expect(result.current.map((each) => each.id)).toEqual(['test-injuries']);

    act(() => {
      unregister();
    });
    expect(result.current).toEqual([]);
    expect(isRosterTabRegistered('test-injuries')).toBe(false);
  });
});
