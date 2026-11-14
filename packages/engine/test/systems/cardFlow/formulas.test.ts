// The production ceiling and the bonus slot (EVT4-02). Design: docs/design/card-flow.md
import { describe, expect, it } from 'vitest';
import type { PromotionId } from '../../../src/core/ids';
import type { DecisionNode, Traced } from '../../../src/core/trace';
import type { Promotion } from '../../../src/model/entities/promotion';
import type { GameWorld } from '../../../src/model/tables';
import {
  bonusSlotCount,
  bonusSlotFor,
  bonusSlotProductionCheck,
  productionCeiling,
  productionCeilingOf,
  productionCeilingValue,
  type CeilingLevels,
} from '../../../src/systems/cardFlow';
import { cardFlowTunables } from '../../../src/systems/cardFlow/tunables';
import { ALL_TUNABLES, createEngineTunables } from '../../../src/systems/tunables';
import { worldBuilder, type DeepPartial } from '../../support';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';

const DEFAULTS = createEngineTunables();
const ZERO: CeilingLevels = { stage: 0, camera: 0, editing: 0, pyro: 0 };
const TEN: CeilingLevels = { stage: 10, camera: 10, editing: 10, pyro: 10 };
const ALTURA: CeilingLevels = { stage: 8, camera: 8, editing: 7, pyro: 8 };

function ceilingAt(levels: CeilingLevels, overrides: Record<string, number> = {}) {
  return productionCeiling({ promotionName: 'Test', levels }, createEngineTunables(overrides));
}

describe('production tunables', () => {
  it('declares the seven production keys with their defaults', () => {
    expect(
      Object.fromEntries(Object.entries(cardFlowTunables).map(([key, def]) => [key, def.default])),
    ).toEqual({
      'production.ceilingBase': 40,
      'production.ceilingWeight.stage': 1.5,
      'production.ceilingWeight.camera': 2,
      'production.ceilingWeight.editing': 1.5,
      'production.ceilingWeight.pyro': 1,
      'production.bonusSlotThreshold': 90,
      'production.bonusSlotMinImportance': 'regular',
    });
    for (const [key, def] of Object.entries(cardFlowTunables)) {
      expect(ALL_TUNABLES).toHaveProperty([key]);
      expect(def.category).toBe('Production');
    }
  });
});

describe('productionCeiling', () => {
  it('is the base with every area at level 0', () => {
    const ceiling = ceilingAt(ZERO);
    expect(ceiling.value).toBe(40);
    expectTraceReplays(ceiling);
    expectTraceContains(ceiling, { kind: 'tunable', label: 'Base ceiling' });
  });

  it('is exactly 100 with every area at level 10 at the defaults', () => {
    const ceiling = ceilingAt(TEN);
    expect(ceiling.value).toBe(100);
    expectTraceReplays(ceiling);
  });

  it('adds stage, camera, editing and pyro in that order, by level times weight', () => {
    const ceiling = ceilingAt(ALTURA);
    expect(ceiling.value).toBe(86.5);
    expectTraceReplays(ceiling);
    expectSerialisable(ceiling);
    const adds = ceiling.trace.kind === 'formula' ? ceiling.trace.children : [];
    expect(adds.filter((node) => node.kind === 'add').map((node) => node.label)).toEqual([
      'Stage (level 8 × 1.5)',
      'Camera (level 8 × 2)',
      'Editing (level 7 × 1.5)',
      'Pyro (level 8 × 1)',
    ]);
  });

  it.each([
    ['production.ceilingWeight.stage', 86.5 - 12],
    ['production.ceilingWeight.camera', 86.5 - 16],
    ['production.ceilingWeight.editing', 86.5 - 10.5],
    ['production.ceilingWeight.pyro', 86.5 - 8],
  ])('adds 0 for an area whose weight %s is 0', (key, expected) => {
    const ceiling = ceilingAt(ALTURA, { [key]: 0 });
    expect(ceiling.value).toBe(expected);
    expectTraceReplays(ceiling);
  });

  it('keeps the ceiling within 0..100', () => {
    const high = ceilingAt(TEN, { 'production.ceilingBase': 90 });
    expect(high.value).toBe(100);
    expectTraceContains(high, { kind: 'clamp', label: 'A show score never goes past 100' });
    expectTraceReplays(high);
    expect(ceilingAt(ZERO, { 'production.ceilingBase': 0 }).value).toBe(0);
  });

  it('never rounds', () => {
    expect(ceilingAt({ stage: 1, camera: 1, editing: 0, pyro: 0 }).value).toBe(43.5);
  });

  it('gives the same number untraced', () => {
    for (const levels of [ZERO, TEN, ALTURA, { stage: 3, camera: 7, editing: 1, pyro: 9 }]) {
      expect(productionCeilingValue(levels, DEFAULTS)).toBe(ceilingAt(levels).value);
    }
  });
});

interface TestWorld {
  world: GameWorld;
  promotion: (index: number) => PromotionId;
}

function worldWith(...promotions: DeepPartial<Promotion>[]): TestWorld {
  let builder = worldBuilder({ startDate: '2026-01-05' }).withGeography('mini');
  for (const overrides of promotions) {
    builder = builder.withPromotion(overrides);
  }
  const { world } = builder.build();
  const all = world.tables.promotions.values().map((row) => row.id);
  expect(all).toHaveLength(promotions.length);
  return {
    world,
    promotion: (index) => {
      const id = all[index];
      if (id === undefined) throw new Error(`no promotion ${String(index)}`);
      return id;
    },
  };
}

const ALL_TEN = { production: TEN };

function ruleLabels(trace: DecisionNode): [string, boolean][] {
  return (trace.children ?? []).flatMap((node) =>
    node.kind === 'branch' ? [[node.label, node.taken] satisfies [string, boolean]] : [],
  );
}

function decisionOf(result: { decision: Traced<string> }): DecisionNode {
  const { trace } = result.decision;
  if (trace.kind !== 'decision') throw new Error(`expected a decision, got ${trace.kind}`);
  return trace;
}

describe('bonusSlotFor', () => {
  it('gives a regular show of a big production one extra slot', () => {
    const { world, promotion } = worldWith({ name: 'Test Big', ...ALL_TEN });
    const result = bonusSlotFor(
      world,
      { promotionId: promotion(0), importance: 'regular', baseSlots: 6 },
      DEFAULTS,
    );
    expect(result.slots).toBe(7);
    expect(result.decision.value).toBe('bonusSlot');
    const trace = decisionOf(result);
    expect(ruleLabels(trace).map(([, taken]) => taken)).toEqual([true, true, true]);
    expect(
      (trace.children ?? []).some(
        (node) => node.kind === 'formula' && node.label === 'Production ceiling',
      ),
    ).toBe(true);
    expectSerialisable(result.decision);
    expect(
      bonusSlotCount(
        world,
        { promotionId: promotion(0), importance: 'regular', baseSlots: 6 },
        DEFAULTS,
      ),
    ).toBe(7);
  });

  it('stops at a show smaller than the smallest importance', () => {
    const { world, promotion } = worldWith({ name: 'Test Big', ...ALL_TEN });
    const result = bonusSlotFor(
      world,
      { promotionId: promotion(0), importance: 'minor', baseSlots: 5 },
      DEFAULTS,
    );
    expect(result.slots).toBe(5);
    expect(result.decision.value).toBe('standard');
    const trace = decisionOf(result);
    expect(trace.reason).toBe('Only a regular show or bigger gets the extra slot');
    expect(ruleLabels(trace)).toEqual([['A minor show is a regular show or bigger', false]]);
  });

  it('stops at a ceiling below the threshold, with the ceiling attached', () => {
    const { world, promotion } = worldWith({
      name: 'Test Altura',
      production: { ...ALTURA },
    });
    const result = bonusSlotFor(
      world,
      { promotionId: promotion(0), importance: 'flagship', baseSlots: 10 },
      DEFAULTS,
    );
    expect(result.slots).toBe(10);
    const trace = decisionOf(result);
    expect(trace.reason).toBe('The production ceiling is below 90');
    expect(ruleLabels(trace)).toEqual([
      ['A flagship show is a regular show or bigger', true],
      ['Production ceiling 86.5 reaches 90', false],
    ]);
    const ceiling = (trace.children ?? []).find((node) => node.label === 'Production ceiling');
    expect(ceiling?.value).toBe(86.5);
  });

  it('never goes past 12 main slots', () => {
    const { world, promotion } = worldWith({ name: 'Test Big', ...ALL_TEN });
    const result = bonusSlotFor(
      world,
      { promotionId: promotion(0), importance: 'major', baseSlots: 12 },
      DEFAULTS,
    );
    expect(result.slots).toBe(12);
    const trace = decisionOf(result);
    expect(trace.reason).toBe('The show already has 12 main slots');
    expect(ruleLabels(trace).at(-1)).toEqual([
      '12 main slots is fewer than 12 (the show format allows 3 to 12 main slots)',
      false,
    ]);
  });

  it('follows the tunables: a lower threshold, a smaller smallest show', () => {
    const { world, promotion } = worldWith({ name: 'Test Altura', production: { ...ALTURA } });
    const tunables = createEngineTunables({
      'production.bonusSlotThreshold': 80,
      'production.bonusSlotMinImportance': 'house',
    });
    const result = bonusSlotFor(
      world,
      { promotionId: promotion(0), importance: 'house', baseSlots: 5 },
      tunables,
    );
    expect(result.slots).toBe(6);
  });

  it('reads the promotion through productionCeilingOf', () => {
    const { world, promotion } = worldWith({ name: 'Test Altura', production: { ...ALTURA } });
    const ceiling = productionCeilingOf(world, promotion(0), DEFAULTS);
    expect(ceiling.value).toBe(86.5);
    expect(ceiling.trace.label).toBe('Production ceiling (Test Altura)');
  });
});

describe('bonusSlotProductionCheck', () => {
  it('says whether a ceiling reaches the threshold', () => {
    const yes = bonusSlotProductionCheck(ceilingAt(TEN), DEFAULTS);
    expect(yes.value).toBe(true);
    const no = bonusSlotProductionCheck(ceilingAt(ALTURA), DEFAULTS);
    expect(no.value).toBe(false);
    expectSerialisable(no);
  });
});
