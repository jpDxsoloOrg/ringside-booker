// Expected push. Design: docs/design/workers.md#expected-push
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../src/core/trace';
import { describeTunables } from '../../../src/core/tunables/describe';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import {
  EMPLOYMENT_ROLES,
  type EmploymentRole,
  type Push,
} from '../../../src/model/entities/employment';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  CREW_NOT_PUSHED_RULE,
  CREW_ROLES,
  expectedPush,
  NO_FANS_NOTE,
  pushStanding,
  STAR_REASON,
  type FootprintRegionalPop,
} from '../../../src/systems/workers';
import { testId } from '../../support/ids';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';
import { popEverywhere, testRegions } from './push-fixtures';

const PROMOTION = 'Test Promotion A';
const regions = testRegions(2);

interface Scenario {
  /** The worker's popularity in every region. */
  worker: number;
  /** The promotion's popularity in every region. 40 by default, so standing = worker ÷ 40. */
  promotion?: number;
  role?: EmploymentRole;
  workerPop?: FootprintRegionalPop;
  promotionPop?: FootprintRegionalPop;
  overrides?: TunableOverrides;
}

function inputsOf(scenario: Scenario) {
  return {
    employmentRole: scenario.role ?? 'wrestler',
    workerPop: scenario.workerPop ?? popEverywhere(regions, scenario.worker),
    promotionPop: scenario.promotionPop ?? popEverywhere(regions, scenario.promotion ?? 40),
    promotionName: PROMOTION,
    regions,
  };
}

function pushOf(scenario: Scenario) {
  const deps = { tunables: createEngineTunables(scenario.overrides ?? {}) };
  const result = expectedPush(inputsOf(scenario), deps);
  expectSerialisable(result);
  const decision = expectTraceContains(result, { kind: 'decision', label: 'Expected push' });
  expect(decision.chosen).toBe(result.value);
  expect(decision.docRef).toBe('workers.md#expected-push');
  return { result, decision };
}

function standingOf(scenario: Scenario) {
  const deps = { tunables: createEngineTunables(scenario.overrides ?? {}) };
  const standing = pushStanding(inputsOf(scenario), deps);
  if (standing === null) {
    throw new Error('Expected the promotion to have fans');
  }
  expectTraceReplays(standing.workerPopularity);
  expectTraceReplays(standing.promotionPopularity);
  expectTraceReplays(standing.standing);
  return standing;
}

describe('expectedPush', () => {
  describe('crew', () => {
    it.each(CREW_ROLES)('expects no push for a %s', (role) => {
      const { result, decision } = pushOf({ worker: 100, role });
      expect(result.value).toBe('none');
      expect(decision.reason).toBe(CREW_NOT_PUSHED_RULE);
      const rule = expectTraceContains(result, { kind: 'branch', label: CREW_NOT_PUSHED_RULE });
      expect(rule.taken).toBe(true);
      // Nothing else is worked out for crew.
      expect(findTraceNodes(result.trace, 'formula')).toEqual([]);
    });

    it('covers every role but wrestler and manager', () => {
      expect(new Set([...CREW_ROLES, 'wrestler', 'manager'])).toEqual(new Set(EMPLOYMENT_ROLES));
    });

    it.each(['wrestler', 'manager'] as const)('pushes a %s', (role) => {
      const { result } = pushOf({ worker: 20, role });
      expect(result.value).toBe('midCard');
      expect(
        expectTraceContains(result, { kind: 'branch', label: CREW_NOT_PUSHED_RULE }).taken,
      ).toBe(false);
    });
  });

  describe('bands', () => {
    // The promotion is at 40 everywhere, so the thresholds 0.85, 0.65, 0.45 and 0.25 fall on a
    // worker popularity of 34, 26, 18 and 10.
    const boundaries: readonly (readonly [number, Push])[] = [
      [34, 'mainEvent'],
      [33.9, 'upperCard'],
      [26, 'upperCard'],
      [25.9, 'midCard'],
      [18, 'midCard'],
      [17.9, 'lowerCard'],
      [10, 'lowerCard'],
      [9.9, 'enhancement'],
      [0, 'enhancement'],
    ];
    it.each(boundaries)('a worker at %d expects %s', (worker, expected) => {
      const { result } = pushOf({ worker });
      expect(result.value).toBe(expected);
      standingOf({ worker });
    });

    it('lists every band with the standing as its score and its threshold as the reason', () => {
      const { decision } = pushOf({ worker: 20 });
      expect(decision.considered).toEqual([
        { option: 'mainEvent', score: 0.5, reason: 'Needs a standing of at least 0.85' },
        { option: 'upperCard', score: 0.5, reason: 'Needs a standing of at least 0.65' },
        { option: 'midCard', score: 0.5, reason: 'Needs a standing of at least 0.45' },
        { option: 'lowerCard', score: 0.5, reason: 'Needs a standing of at least 0.25' },
        { option: 'enhancement', score: 0.5, reason: 'Anyone below the lower card' },
      ]);
      expect(decision.reason).toBe(
        `A standing of 0.5 at ${PROMOTION} reaches the mid card mark of 0.45`,
      );
    });

    it('names every threshold by its tunable', () => {
      const { result } = pushOf({ worker: 20 });
      const keys = findTraceNodes(result.trace, 'tunable').map((node) => node.key);
      for (const key of [
        'workers.expectedPush.footprintMinPop',
        'workers.expectedPush.minPromotionPop',
        'workers.expectedPush.starPop',
        'workers.expectedPush.mainEventRatio',
        'workers.expectedPush.upperCardRatio',
        'workers.expectedPush.midCardRatio',
        'workers.expectedPush.lowerCardRatio',
      ]) {
        expect(keys).toContain(key);
      }
    });

    it('shows the standing with both popularity figures under it, once', () => {
      const { result } = pushOf({ worker: 20 });
      const formulas = findTraceNodes(result.trace, 'formula').map((node) => node.label);
      expect(formulas).toEqual([
        `Standing at ${PROMOTION}`,
        `Popularity where ${PROMOTION} draws`,
        `${PROMOTION}'s popularity with its own fans`,
        `Popularity where ${PROMOTION} draws`,
      ]);
      const standing = standingOf({ worker: 20 });
      expect(standing.workerPopularity.value).toBe(20);
      expect(standing.promotionPopularity.value).toBe(40);
      expect(standing.standing.value).toBe(0.5);
      expect(expectTraceContains(standing.standing, { kind: 'formula' }).unit).toBe('ratio');
    });

    it('explains enhancement as below every position', () => {
      const { decision } = pushOf({ worker: 4 });
      expect(decision.reason).toBe(
        `A standing of 0.1 at ${PROMOTION} is below every card position`,
      );
    });

    it('moves a band when its threshold is overridden', () => {
      expect(pushOf({ worker: 18 }).result.value).toBe('midCard');
      const moved = pushOf({ worker: 18, overrides: { 'workers.expectedPush.midCardRatio': 0.5 } });
      expect(moved.result.value).toBe('lowerCard');
      const threshold = expectTraceContains(moved.result, {
        kind: 'tunable',
        label: 'Mid card starts at a standing of',
      });
      expect(threshold.value).toBe(0.5);
      expect(threshold.overridden).toBe(true);
    });

    it('never throws on thresholds out of order: the band is just unreachable', () => {
      const overrides = { 'workers.expectedPush.upperCardRatio': 0.9 };
      expect(pushOf({ worker: 34, overrides }).result.value).toBe('mainEvent');
      expect(pushOf({ worker: 30, overrides }).result.value).toBe('midCard');
    });
  });

  describe('promotion size', () => {
    it('expects less from a bigger promotion for the same worker', () => {
      const pushes = [20, 40, 60, 90].map(
        (promotion) => pushOf({ worker: 20, promotion }).result.value,
      );
      expect(pushes).toEqual(['mainEvent', 'midCard', 'lowerCard', 'enhancement']);
    });

    it('never measures against less than the smallest promotion popularity', () => {
      // The promotion is at 2 with its fans. Without the floor of 5 a worker at 4 would stand at 2.
      const scenario = { worker: 4, promotion: 2 };
      expect(standingOf(scenario).standing.value).toBe(0.8);
      expect(pushOf(scenario).result.value).toBe('upperCard');
      const floor = expectTraceContains(pushOf(scenario).result, { kind: 'max' });
      expect(floor.applied).toBe(true);
      expect(floor.limit).toBe(5);

      const overrides = { 'workers.expectedPush.minPromotionPop': 0 };
      expect(standingOf({ ...scenario, overrides }).standing.value).toBe(2);
      expect(pushOf({ ...scenario, overrides }).result.value).toBe('mainEvent');
    });

    it('gives enhancement with a note when the promotion has no fans', () => {
      const { result, decision } = pushOf({ worker: 90, promotionPop: {} });
      expect(result.value).toBe('enhancement');
      expect(decision.reason).toBe(NO_FANS_NOTE);
      expectTraceContains(result, { kind: 'note', label: NO_FANS_NOTE });
      expect(
        pushStanding(inputsOf({ worker: 90, promotionPop: {} }), {
          tunables: createEngineTunables(),
        }),
      ).toBeNull();
    });

    it('only counts popularity where the promotion draws', () => {
      const home = testId('region', 1);
      const away = testId('region', 2);
      const promotionPop = { [home]: 40 };
      expect(pushOf({ worker: 0, workerPop: { [away]: 100 }, promotionPop }).result.value).toBe(
        'enhancement',
      );
      expect(pushOf({ worker: 0, workerPop: { [home]: 36 }, promotionPop }).result.value).toBe(
        'mainEvent',
      );
    });
  });

  describe('the star rule', () => {
    // Against a promotion at 100 a worker at 75 stands at 0.75: upper card by the bands alone.
    it('sends a worker at the star mark to the main event', () => {
      const { result, decision } = pushOf({ worker: 75, promotion: 100 });
      expect(result.value).toBe('mainEvent');
      expect(decision.reason).toBe(STAR_REASON);
      const rule = expectTraceContains(result, {
        kind: 'branch',
        label: `Popularity of 75 among ${PROMOTION}'s fans is at least 75`,
      });
      expect(rule.taken).toBe(true);
    });

    it('leaves a worker just below it to the bands', () => {
      const { result } = pushOf({ worker: 74.9, promotion: 100 });
      expect(result.value).toBe('upperCard');
      expect(
        findTraceNodes(result.trace, 'branch').some(
          (node) => node.taken && node.label !== CREW_NOT_PUSHED_RULE,
        ),
      ).toBe(false);
    });

    it('moves with its tunable, and 100 effectively turns it off', () => {
      const lowered = { 'workers.expectedPush.starPop': 70 };
      expect(pushOf({ worker: 70, promotion: 100, overrides: lowered }).result.value).toBe(
        'mainEvent',
      );
      const off = { 'workers.expectedPush.starPop': 100 };
      expect(pushOf({ worker: 80, promotion: 100, overrides: off }).result.value).toBe('upperCard');
    });
  });
});

describe('the expected push tunables', () => {
  it('are listed in the Workers category with the documented defaults', () => {
    const rows = describeTunables(createEngineTunables(), {
      keyPrefix: 'workers.expectedPush.',
    });
    expect(rows.map((row) => [row.key, row.default, row.min, row.max, row.unit])).toEqual([
      ['workers.expectedPush.footprintMinPop', 10, 0, 100, 'points'],
      ['workers.expectedPush.lowerCardRatio', 0.25, 0, 3, 'ratio'],
      ['workers.expectedPush.mainEventRatio', 0.85, 0, 3, 'ratio'],
      ['workers.expectedPush.midCardRatio', 0.45, 0, 3, 'ratio'],
      ['workers.expectedPush.minPromotionPop', 5, 0, 100, 'points'],
      ['workers.expectedPush.starPop', 75, 0, 100, 'points'],
      ['workers.expectedPush.upperCardRatio', 0.65, 0, 3, 'ratio'],
    ]);
    for (const row of rows) {
      expect(row.kind).toBe('number');
      expect(row.category).toBe('Workers');
      expect(row.docRef).toBe('workers.md#expected-push');
    }
  });
});
