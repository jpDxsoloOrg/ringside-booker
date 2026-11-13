// Daily wages (ECO1-03). Design: docs/design/finances.md#payroll
import { describe, expect, it } from 'vitest';
import { mulRatio, cents } from '../../../../src/core/money';
import { inputOf } from '../../../../src/core/trace/helpers';
import { dailyWageAccrual } from '../../../../src/systems/finance';
import { expectTraceReplays } from '../../../support/trace';

function daily(monthly: number) {
  return dailyWageAccrual(inputOf('Monthly payroll', monthly, undefined, 'money/month'));
}

describe('dailyWageAccrual', () => {
  it('spreads $924,000 a month as $30,357.29 a day', () => {
    const result = daily(92_400_000);
    expect(result.value).toBe(3_035_729);
    expect(result.trace.unit).toBe('money');
    expectTraceReplays(result);
  });

  it('rounds $1 a month to the cent', () => {
    // 100 × 12 ÷ 365.25 = 3.285...
    expect(daily(100).value).toBe(3);
    expectTraceReplays(daily(100));
  });

  it('is 0 for no payroll', () => {
    expect(daily(0).value).toBe(0);
  });

  it('rounds the way mulRatio does, for a spread of amounts', () => {
    for (let monthly = 0; monthly < 50_000; monthly += 97) {
      expect(daily(monthly).value).toBe(mulRatio(cents(monthly * 12), 1 / 365.25));
    }
  });

  it('comes to twelve months of payroll over a year, within a cent a day', () => {
    const monthly = 92_400_000;
    const perDay = daily(monthly).value;
    expect(Math.abs(perDay * 365.25 - monthly * 12)).toBeLessThanOrEqual(365.25);
  });
});
