import { describe, expect, it } from 'vitest';
import { inputOf, startCalc } from '@ringside/engine';
import { formatTraceNode } from '../src/traceText';

describe('formatTraceNode', () => {
  it('prints every step of a money calculation as dollars, not cents', () => {
    const trace = startCalc('Change in cash', 3_870_320_840, {
      unit: 'money',
      startLabel: 'This week',
    })
      .subtract('Last week', 3_903_713_859)
      .multiply('Shows', inputOf('Shows this week', 2))
      .done().trace;

    expect(formatTraceNode(trace)).toEqual([
      'Change in cash: -$667860.38',
      '  This week: $38703208.40',
      '  Last week: -$333930.19 ($38703208.40 - $39037138.59)',
      '  Shows: -$667860.38 (-$333930.19 × 2)',
      '    Shows this week: 2',
    ]);
  });

  it('keeps the unit word for other units and reads a monthly cost per month', () => {
    const points = startCalc('Popularity', 70, { unit: 'points' }).add('Show', 0.29).done().trace;
    const payroll = startCalc('Payroll', 0, { unit: 'money/month' }).add('Rex', 500_000).done();

    expect(formatTraceNode(points)[2]).toBe('  Show: 70.29 points (70 + 0.29)');
    expect(formatTraceNode(payroll.trace)[2]).toBe('  Rex: $5000.00/month ($0.00 + $5000.00)');
  });

  it('prints a crowd times a price per head with each number in its own unit', () => {
    const trace = startCalc('Merch sales', inputOf('Crowd', 1_200, undefined, 'count'), {
      unit: 'money',
    })
      .multiply('Spent per fan', inputOf('Per fan', 1_550, undefined, 'money'))
      .done().trace;

    expect(formatTraceNode(trace)).toEqual([
      'Merch sales: $18600.00',
      '  Crowd: 1200 count',
      '  Spent per fan: $18600.00 (1200 × $15.50)',
      '    Per fan: $15.50',
    ]);
  });
});
