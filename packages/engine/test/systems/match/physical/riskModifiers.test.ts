// The risk modifier seam (MTCH4-01). Design: docs/design/physical-toll.md#risk-modifiers
import { afterEach, describe, expect, it } from 'vitest';
import type { PersonId } from '../../../../src/core/ids';
import {
  collectRiskContributions,
  registerRiskModifier,
  riskModifierIds,
  type RiskContext,
  type RiskContribution,
} from '../../../../src/systems/match';
import { worldBuilder } from '../../../support/world-builder';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function register(id: string, order: number, contributions: RiskContribution[]): void {
  cleanups.push(registerRiskModifier({ id, order, contribute: () => contributions }));
}

function context(): { ctx: RiskContext; first: PersonId; second: PersonId } {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({}, (promotion) => promotion.withRoster(2))
    .build();
  const [first, second] = ids.people;
  if (first === undefined || second === undefined) throw new Error('no people');
  const ctx: RiskContext = {
    read: world,
    promotionId: ids.promotions.A!,
    importance: 'regular',
    kind: 'match',
    durationClass: 'standard',
    sides: [[{ personId: first, role: 'competitor' }], [{ personId: second, role: 'competitor' }]],
    crew: { producerId: null },
    keepItSafe: false,
  };
  return { ctx, first, second };
}

describe('registerRiskModifier', () => {
  it('reaches every competitor with null personIds and only the named worker otherwise', () => {
    const { ctx, first, second } = context();
    register('stip.ladder', 10, [
      { source: 'Stipulation: Ladder', personIds: null, fatigueMultiplier: 1.3 },
    ]);
    register('note.highSpots', 20, [
      { source: 'Note: High spots', personIds: [second], wearMultiplier: 1.5 },
    ]);
    expect(collectRiskContributions(ctx, first).map((entry) => entry.source)).toEqual([
      'Stipulation: Ladder',
    ]);
    expect(collectRiskContributions(ctx, second).map((entry) => entry.modifierId)).toEqual([
      'stip.ladder',
      'note.highSpots',
    ]);
  });

  it('orders contributions by modifier order, then id', () => {
    const { ctx, first } = context();
    register('zed.late', 5, [{ source: 'Late', personIds: null }]);
    register('bee.tied', 1, [{ source: 'Bee', personIds: null }]);
    register('ant.tied', 1, [{ source: 'Ant', personIds: null }]);
    expect(collectRiskContributions(ctx, first).map((entry) => entry.source)).toEqual([
      'Ant',
      'Bee',
      'Late',
    ]);
  });

  it('refuses a negative multiplier, naming the modifier', () => {
    const { ctx, first } = context();
    register('stip.broken', 1, [{ source: 'Broken', personIds: null, wearMultiplier: -1 }]);
    expect(() => collectRiskContributions(ctx, first)).toThrow(/stip\.broken/);
  });

  it('refuses an injury chance outside 0..1 and a non-finite multiplier', () => {
    const { ctx, first } = context();
    const unregister = registerRiskModifier({
      id: 'stip.odds',
      order: 1,
      contribute: () => [{ source: 'Odds', personIds: null, injuryAdd: 2 }],
    });
    expect(() => collectRiskContributions(ctx, first)).toThrow(/stip\.odds.*injuryAdd/);
    unregister();
    register('stip.infinite', 1, [
      { source: 'Infinite', personIds: null, fatigueMultiplier: Number.POSITIVE_INFINITY },
    ]);
    expect(() => collectRiskContributions(ctx, first)).toThrow(/stip\.infinite/);
  });

  it('refuses a malformed id and a duplicate id', () => {
    expect(() => registerRiskModifier({ id: 'Not An Id', order: 1, contribute: () => [] })).toThrow(
      /system\.camelName/,
    );
    register('stip.once', 1, []);
    expect(() => registerRiskModifier({ id: 'stip.once', order: 2, contribute: () => [] })).toThrow(
      /already registered/,
    );
  });

  it('unregisters', () => {
    const { ctx, first } = context();
    const unregister = registerRiskModifier({
      id: 'stip.gone',
      order: 1,
      contribute: () => [{ source: 'Gone', personIds: null }],
    });
    expect(riskModifierIds()).toContain('stip.gone');
    unregister();
    expect(riskModifierIds()).not.toContain('stip.gone');
    expect(collectRiskContributions(ctx, first)).toEqual([]);
  });
});
