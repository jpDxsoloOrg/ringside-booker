// Area cost (ECO7-01). Design: docs/design/production.md#area-costs
import { describe, expect, it } from 'vitest';
import { EVENT_IMPORTANCES } from '../../../src/model/entities/event-definition';
import { PRODUCTION_AREAS } from '../../../src/model/entities/promotion';
import {
  AREA_PRICE_KEYS,
  areaCost,
  MONTHLY_IGNORES_IMPORTANCE,
  SHOW_COST_MULTIPLIER_KEYS,
} from '../../../src/systems/production';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';
import { deps } from './support';

function check(result: ReturnType<typeof areaCost>): void {
  expectTraceReplays(result);
  expectSerialisable(result.trace);
}

describe('areaCost', () => {
  it('costs nothing at level 0, for every area and importance', () => {
    for (const area of PRODUCTION_AREAS) {
      for (const importance of [...EVENT_IMPORTANCES, null]) {
        const result = areaCost({ area, level: 0, importance }, deps());
        expect(result.value, `${area} ${String(importance)}`).toBe(0);
        check(result);
      }
    }
  });

  it('costs the full price at level 10 for a regular show or a month', () => {
    const tunables = deps().tunables;
    for (const area of PRODUCTION_AREAS) {
      const result = areaCost({ area, level: 10, importance: null }, deps());
      expect(result.value, area).toBe(tunables.get(AREA_PRICE_KEYS[area]));
      check(result);
    }
    expect(areaCost({ area: 'camera', level: 10, importance: 'regular' }, deps()).value).toBe(
      15_000_000,
    );
  });

  it('reads like the Why? the player sees', () => {
    const result = areaCost({ area: 'camera', level: 4, importance: 'minor' }, deps());
    expect(result.value).toBe(480_000);
    expect(result.trace.label).toBe('Camera at level 4');
    expect(result.trace.unit).toBe('money');
    expectTraceContains(result, { kind: 'input', label: 'Camera level 4 of 10' });
    const power = expectTraceContains(result, { kind: 'power', label: 'Cost curve' });
    expect(power.before).toBeCloseTo(0.4, 9);
    expect(power.operand).toBe(3);
    expectTraceContains(result, {
      kind: 'multiply',
      label: 'Camera at level 10: $150,000 per regular show',
    });
    expectTraceContains(result, { kind: 'multiply', label: 'Minor show × 0.5' });
    check(result);
  });

  it('prices Hardpan camera 2 at a minor show at $600 and camera 4 at $4,800', () => {
    expect(areaCost({ area: 'camera', level: 2, importance: 'minor' }, deps()).value).toBe(60_000);
    expect(areaCost({ area: 'camera', level: 4, importance: 'minor' }, deps()).value).toBe(480_000);
  });

  it('is a straight line when the cost curve is 1', () => {
    const linear = deps({ 'production.costCurve': 1 });
    for (let level = 0; level <= 10; level += 1) {
      const result = areaCost({ area: 'stage', level, importance: null }, linear);
      expect(result.value, String(level)).toBe(level * 1_200_000);
      check(result);
    }
  });

  it('is free when the price is 0', () => {
    const result = areaCost(
      { area: 'marketing', level: 9, importance: null },
      deps({ 'production.monthlyCost.marketing': 0 }),
    );
    expect(result.value).toBe(0);
    check(result);
  });

  it('applies every show importance multiplier, 0 included', () => {
    const tunables = deps().tunables;
    for (const importance of EVENT_IMPORTANCES) {
      const multiplier = tunables.get(SHOW_COST_MULTIPLIER_KEYS[importance]);
      const result = areaCost({ area: 'camera', level: 10, importance }, deps());
      expect(result.value, importance).toBe(Math.round(15_000_000 * multiplier));
      check(result);
    }
    const freeHouse = areaCost(
      { area: 'camera', level: 10, importance: 'house' },
      deps({ 'production.showCostMultiplier.house': 0 }),
    );
    expect(freeHouse.value).toBe(0);
    check(freeHouse);
  });

  it('ignores show importance for a monthly area, and says so', () => {
    const plain = areaCost({ area: 'music', level: 5, importance: null }, deps());
    const withShow = areaCost({ area: 'music', level: 5, importance: 'flagship' }, deps());
    expect(withShow.value).toBe(plain.value);
    expect(withShow.trace.unit).toBe('money/month');
    expectTraceContains(withShow, { kind: 'branch', label: MONTHLY_IGNORES_IMPORTANCE });
    check(withShow);
  });

  it('gives whole cents', () => {
    for (let level = 0; level <= 10; level += 1) {
      const result = areaCost({ area: 'editing', level, importance: 'house' }, deps());
      expect(Number.isInteger(result.value), String(level)).toBe(true);
    }
  });

  it('rejects a level outside 0..10', () => {
    expect(() => areaCost({ area: 'pyro', level: 11, importance: null }, deps())).toThrow();
    expect(() => areaCost({ area: 'pyro', level: 2.5, importance: null }, deps())).toThrow();
  });
});
