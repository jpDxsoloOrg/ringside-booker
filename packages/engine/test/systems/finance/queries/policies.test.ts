// finance.policies and finance.policyPreview (ECO1-04). Design: docs/design/finances.md#policies
import { afterEach, describe, expect, it } from 'vitest';
import {
  controllerViewer,
  createEngine,
  initialEngineState,
  OMNISCIENT_VIEWER,
  type Engine,
} from '../../../../src/core/api';
import { simSystem } from '../../../../src/core/api/builtins';
import { addDays, weekday } from '../../../../src/core/date';
import type { PromotionId } from '../../../../src/core/ids';
import { walkTrace } from '../../../../src/core/trace';
import type { TraceNode } from '../../../../src/core/trace/types';
import type { GameWorld } from '../../../../src/model/tables';
import {
  AWAY_SHOWS_NOTE,
  financeSystem,
  NOT_YOUR_BOOKS,
  POLICY_PREVIEW_DAYS,
  registerPolicyEffect,
  unregisterPolicyEffect,
} from '../../../../src/systems/finance';
import {
  anEventDefinition,
  anEventInstance,
  TEST_PLAYER_ID,
  testId,
  worldBuilder,
} from '../../../support';
import { showCostWorld } from '../show-cost-world';

const PLAYER_VIEWER = controllerViewer({ kind: 'human', playerId: TEST_PLAYER_ID });

interface PolicyWorld {
  readonly world: GameWorld;
  readonly human: PromotionId;
  readonly rival: PromotionId;
}

/** A, the player's, with four wrestlers and a weekly regular show on Mondays (six slots). */
function policyWorld(options: { majorShowInWindow?: boolean } = {}): PolicyWorld {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion(
      {
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
        policies: { travel: 1, catering: 1, medical: 2 },
      },
      (promotion) => promotion.withRoster(4).withWeeklyShow({ weekdays: [0] }),
    )
    .withPromotion({}, (promotion) => promotion.withRoster(2))
    .with('major show', (context) => {
      const human = context.ids.promotions.A;
      const regionId = context.ids.regions[0];
      if (options.majorShowInWindow !== true || human === undefined || regionId === undefined) {
        return;
      }
      context.insert(
        'eventInstances',
        anEventInstance(
          {
            promotionId: human,
            regionId,
            importance: 'major',
            format: { slots: 8, preShowSlots: 0 },
            date: addDays(context.meta.currentDate, 3),
          },
          context.sequence,
        ),
      );
    })
    .build();
  const { A: human, B: rival } = ids.promotions;
  if (human === undefined || rival === undefined) {
    throw new Error('policyWorld: missing a promotion');
  }
  return { world, human, rival };
}

function engineOver(world: GameWorld): Engine {
  return createEngine({ state: initialEngineState(world), systems: [simSystem, financeSystem] });
}

/** Mondays from today for the preview window: the weekly show's dates. */
function mondaysAhead(world: GameWorld): number {
  const today = world.meta.currentDate;
  let count = 0;
  for (let offset = 0; offset < POLICY_PREVIEW_DAYS; offset += 1) {
    if (weekday(addDays(today, offset)) === 0) {
      count += 1;
    }
  }
  return count;
}

function labelsOf(trace: TraceNode): string[] {
  const labels: string[] = [];
  walkTrace(trace, (node) => {
    labels.push(node.label);
  });
  return labels;
}

function preview(
  engine: Engine,
  promotionId: PromotionId,
  area: 'travel' | 'catering' | 'medical',
) {
  const result = engine.query('finance.policyPreview', { promotionId, area }, PLAYER_VIEWER);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  return result.data;
}

const EFFECT_ID = 'test.cateringMorale';

const EMPTY_NODE: TraceNode = { kind: 'note', label: '', value: null };

afterEach(() => {
  unregisterPolicyEffect(EFFECT_ID);
});

describe('finance.policies', () => {
  it('lists each policy with its level, words and a monthly estimate with a Why?', () => {
    const built = policyWorld();
    const result = engineOver(built.world).query(
      'finance.policies',
      { promotionId: built.human },
      PLAYER_VIEWER,
    );
    if (!result.ok) {
      throw new Error(JSON.stringify(result.reasons));
    }
    const shows = mondaysAhead(built.world);
    // No show has run yet, so a show is six slots × two workers = 12 workers.
    for (const policy of result.data.policies) {
      expect(policy.monthlyEstimateTrace.value).toBe(policy.monthlyEstimate);
    }
    expect(
      result.data.policies.map((policy) => ({
        area: policy.area,
        level: policy.level,
        label: policy.label,
        description: policy.description,
        monthlyEstimate: policy.monthlyEstimate,
      })),
    ).toEqual([
      {
        area: 'catering',
        level: 1,
        label: 'Basic',
        description: 'Catering: food backstage on show nights',
        monthlyEstimate: shows * 25_000,
      },
      {
        area: 'travel',
        level: 1,
        label: 'Basic',
        description: 'Travel: who pays for getting to shows',
        monthlyEstimate: shows * 12 * 5_000,
      },
      {
        area: 'medical',
        level: 2,
        label: 'Good',
        description: 'Medical: care for everyone under contract, paid monthly',
        // Four people under contract at $600.
        monthlyEstimate: 4 * 60_000,
      },
    ]);
    const travel = result.data.policies.find((policy) => policy.area === 'travel');
    expect(labelsOf(travel?.monthlyEstimateTrace ?? EMPTY_NODE)).toEqual(
      expect.arrayContaining([`Every show assumed at home. ${AWAY_SHOWS_NOTE}`]),
    );
  });

  it("refuses a rival's books", () => {
    const built = policyWorld();
    const engine = engineOver(built.world);
    for (const name of ['finance.policies', 'finance.policyPreview'] as const) {
      const result =
        name === 'finance.policies'
          ? engine.query(name, { promotionId: built.rival }, PLAYER_VIEWER)
          : engine.query(name, { promotionId: built.rival, area: 'travel' }, PLAYER_VIEWER);
      expect(result).toEqual({
        ok: false,
        reasons: [expect.objectContaining({ code: NOT_YOUR_BOOKS })],
      });
    }
    expect(
      engine.query('finance.policies', { promotionId: built.rival }, OMNISCIENT_VIEWER).ok,
    ).toBe(true);
  });
});

describe('finance.policyPreview', () => {
  it('prices all four levels with the change from today', () => {
    const built = policyWorld();
    const result = preview(engineOver(built.world), built.human, 'travel');
    const shows = mondaysAhead(built.world);
    const perLevel = [0, 5_000, 20_000, 50_000].map((rate) => shows * 12 * rate);
    expect(result.area).toBe('travel');
    expect(result.current).toBe(1);
    expect(result.levels.map((level) => level.label)).toEqual(['None', 'Basic', 'Good', 'Premium']);
    expect(result.levels.map((level) => level.monthlyCost)).toEqual(perLevel);
    expect(result.levels.map((level) => level.delta)).toEqual(
      perLevel.map((cost) => cost - (perLevel[1] ?? 0)),
    );
    for (const level of result.levels) {
      expect(level.monthlyCostTrace.value).toBe(level.monthlyCost);
      expect(level.effects).toEqual([]);
    }
  });

  it('prices medical by the people under contract today', () => {
    const built = policyWorld();
    const result = preview(engineOver(built.world), built.human, 'medical');
    expect(result.levels.map((level) => level.monthlyCost)).toEqual([0, 60_000, 240_000, 600_000]);
    expect(result.levels.map((level) => level.delta)).toEqual([-240_000, -180_000, 0, 360_000]);
  });

  it('shows the lines a registered policy effect gives each level', () => {
    registerPolicyEffect({
      id: EFFECT_ID,
      area: 'catering',
      order: 1,
      lines: (_read, _promotionId, level) =>
        level >= 2 ? [{ text: `+${String(level)} morale`, tone: 'positive' }] : [],
    });
    const built = policyWorld();
    const engine = engineOver(built.world);
    const result = preview(engine, built.human, 'catering');
    expect(result.levels.map((level) => level.effects)).toEqual([
      [],
      [],
      [{ text: '+2 morale', tone: 'positive' }],
      [{ text: '+3 morale', tone: 'positive' }],
    ]);
    // Effects belong to their area only.
    expect(
      preview(engine, built.human, 'travel').levels.every((level) => level.effects.length === 0),
    ).toBe(true);
    expect(() => {
      registerPolicyEffect({ id: EFFECT_ID, area: 'travel', order: 2, lines: () => [] });
    }).toThrow(/already registered/);
  });

  it('uses the shows on the calendar when there are any in the window', () => {
    const built = policyWorld({ majorShowInWindow: true });
    const result = preview(engineOver(built.world), built.human, 'catering');
    // Only the major show: Basic catering × 1.5.
    expect(result.levels[1]?.monthlyCost).toBe(37_500);
  });

  it('sizes a show by the paid workers of recent shows once one has run', () => {
    // The show cost world's completed show had four paid workers (the guest is not one).
    const built = showCostWorld();
    const empty = preview(engineOver(built.world), built.human, 'travel');
    expect(empty.levels.map((level) => level.monthlyCost)).toEqual([0, 0, 0, 0]);
    expect(labelsOf(empty.levels[1]?.monthlyCostTrace ?? EMPTY_NODE)).toContain(
      `No shows in the next ${String(POLICY_PREVIEW_DAYS)} days`,
    );

    const added = built.world.transact('weekly show', (tx) => {
      tx.insert(
        'eventDefinitions',
        anEventDefinition({
          id: testId('eventDefinition', 900),
          promotionId: built.human,
          recurrence: { kind: 'weekly', weekdays: [0] },
          activeFrom: built.world.meta.currentDate,
        }),
      );
    });
    expect(added.ok).toBe(true);
    const result = preview(engineOver(built.world), built.human, 'travel');
    expect(result.levels[1]?.monthlyCost).toBe(mondaysAhead(built.world) * 4 * 5_000);
    expect(labelsOf(result.levels[1]?.monthlyCostTrace ?? EMPTY_NODE)).toContain(
      'Workers per show: the average of recent shows',
    );
  });
});
