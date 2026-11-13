// Monthly production overhead (ECO7-01). Design: docs/design/production.md#area-costs
import { describe, expect, it } from 'vitest';
import { productionMonthlyCost } from '../../../src/systems/production';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';
import { ALTURA, deps, HARDPAN, NOTHING } from './support';

function monthly(levels: typeof HARDPAN, name = 'Hardpan') {
  const result = productionMonthlyCost({ promotionName: name, levels }, deps());
  for (const traced of [result.total, ...Object.values(result.byCategory)]) {
    expectTraceReplays(traced);
    expectSerialisable(traced.trace);
  }
  return result;
}

describe('productionMonthlyCost', () => {
  it('charges Hardpan $4,700 a month: production $2,500, marketing $1,200, back office $1,000', () => {
    const result = monthly(HARDPAN);
    expect(result.total.value).toBe(470_000);
    expect(result.byCategory.production.value).toBe(250_000);
    expect(result.byCategory.marketing.value).toBe(120_000);
    expect(result.byCategory.backOffice.value).toBe(100_000);
    expect(result.total.trace.unit).toBe('money/month');
    expectTraceContains(result.total, { kind: 'add', label: 'Marketing (level 1)' });
    expectTraceContains(result.total, { kind: 'add', label: 'Writing (level 2)' });
  });

  it('charges Altura $1,214,650 a month', () => {
    const result = monthly(ALTURA, 'Altura');
    expect(result.total.value).toBe(121_465_000);
    expectTraceContains(result.total, { kind: 'add', label: 'Marketing (level 8)' });
  });

  it('splits the whole total across the categories', () => {
    for (const levels of [HARDPAN, ALTURA, NOTHING]) {
      const result = monthly(levels);
      const parts = Object.values(result.byCategory).reduce((sum, part) => sum + part.value, 0);
      expect(parts).toBe(result.total.value);
    }
  });

  it('is 0 with every area at level 0', () => {
    expect(monthly(NOTHING).total.value).toBe(0);
  });
});
