// The policy effect seam (ECO1-04). Design: docs/design/finances.md#seams
import { afterEach, describe, expect, it } from 'vitest';
import {
  listPolicyEffects,
  registerPolicyEffect,
  unregisterPolicyEffect,
  type PolicyEffect,
} from '../../../src/systems/finance';

const IDS = ['test.second', 'test.first', 'test.alsoFirst', 'test.travel'];

function effect(id: string, overrides: Partial<PolicyEffect> = {}): PolicyEffect {
  return { id, area: 'medical', order: 1, lines: () => [], ...overrides };
}

afterEach(() => {
  for (const id of IDS) {
    unregisterPolicyEffect(id);
  }
});

describe('registerPolicyEffect', () => {
  it('lists an area’s effects by order, then id', () => {
    registerPolicyEffect(effect('test.second', { order: 2 }));
    registerPolicyEffect(effect('test.first'));
    registerPolicyEffect(effect('test.alsoFirst'));
    registerPolicyEffect(effect('test.travel', { area: 'travel' }));
    // Only this test's effects: features register their own (WRK6's medical lines).
    const testIds = (area: Parameters<typeof listPolicyEffects>[0]) =>
      listPolicyEffects(area)
        .map((entry) => entry.id)
        .filter((id) => IDS.includes(id));
    expect(testIds('medical')).toEqual(['test.alsoFirst', 'test.first', 'test.second']);
    expect(testIds('travel')).toEqual(['test.travel']);
    expect(testIds('catering')).toEqual([]);
  });

  it('refuses a duplicate id, a malformed id and an order that is not a number', () => {
    registerPolicyEffect(effect('test.first'));
    expect(() => {
      registerPolicyEffect(effect('test.first'));
    }).toThrow(/already registered/);
    expect(() => {
      registerPolicyEffect(effect('Not An Id'));
    }).toThrow(/system\.camelName/);
    expect(() => {
      registerPolicyEffect(effect('test.second', { order: Number.NaN }));
    }).toThrow(/finite/);
  });
});
