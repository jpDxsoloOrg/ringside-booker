// Days held for a reign (CRTV1-01). Design: docs/design/titles.md#days-held
import { describe, expect, it } from 'vitest';
import { parseGameDate } from '../../../src/core/date';
import { REIGN_DAYS_NOTE, reignDays } from '../../../src/systems/titles';
import { expectTraceContains, expectTraceReplays } from '../../support/trace';

const WON = parseGameDate('2027-01-04');

describe('reignDays', () => {
  it('reads 0 for a reign won today', () => {
    const result = reignDays({ wonOn: WON, lostOn: null, today: WON });
    expect(result.value).toBe(0);
    expectTraceReplays(result);
  });

  it('reads 0 for a reign won and lost on the same day', () => {
    expect(reignDays({ wonOn: WON, lostOn: WON, today: parseGameDate('2027-05-01') }).value).toBe(
      0,
    );
  });

  it('counts an open reign up to today', () => {
    const result = reignDays({ wonOn: WON, lostOn: null, today: parseGameDate('2027-03-12') });
    expect(result.value).toBe(67);
    expectTraceContains(result, { kind: 'input', label: 'From 4 Jan 2027 to today' });
    expectTraceContains(result, { kind: 'note', label: REIGN_DAYS_NOTE });
    expectTraceReplays(result);
  });

  it('counts a closed reign up to the day it ended, not today', () => {
    const result = reignDays({
      wonOn: WON,
      lostOn: parseGameDate('2027-03-12'),
      today: parseGameDate('2028-01-01'),
    });
    expect(result.value).toBe(67);
    expectTraceContains(result, { kind: 'input', label: 'From 4 Jan 2027 to 12 Mar 2027' });
  });

  it('never goes below 0', () => {
    expect(reignDays({ wonOn: WON, lostOn: null, today: parseGameDate('2027-01-01') }).value).toBe(
      0,
    );
  });
});
