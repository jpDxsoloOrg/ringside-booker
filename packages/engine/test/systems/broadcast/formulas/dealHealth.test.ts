// Deal health and the exit fee (ECO8-05): the risk rules, their reasons and Why?.
// Design: docs/design/broadcast.md#deal-health and #commands
import { describe, expect, it } from 'vitest';
import { addDays, parseGameDate } from '../../../../src/core/date';
import {
  dealHealth,
  exitFee,
  healthDayText,
  type DealHealthAiring,
  type DealHealthInputs,
} from '../../../../src/systems/broadcast';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const TUNABLES = createEngineTunables();
const NEWEST = parseGameDate('2027-01-18');

function aired(ratio: number): Omit<DealHealthAiring, 'airDate'> {
  return { status: 'aired', viewers: Math.round(10_000 * ratio), expectedViewers: 10_000 };
}
const MISSED: Omit<DealHealthAiring, 'airDate'> = {
  status: 'missed',
  viewers: 0,
  expectedViewers: 10_000,
};

function inputs(
  recent: readonly Omit<DealHealthAiring, 'airDate'>[],
  overrides: Partial<DealHealthInputs> = {},
): DealHealthInputs {
  return {
    networkName: 'Local TV',
    reachTier: 2,
    daysSinceStart: 365,
    recent: recent.map((airing, index) => ({ ...airing, airDate: addDays(NEWEST, -7 * index) })),
    upcomingMissed: [],
    ...overrides,
  };
}

function health(input: DealHealthInputs, overrides: Record<string, number | boolean> = {}) {
  return dealHealth(input, { tunables: createEngineTunables(overrides) });
}

const fill = (ratio: number, count: number) => Array.from({ length: count }, () => aired(ratio));

describe('dealHealth', () => {
  it('is safe when viewers meet what the network expects', () => {
    const result = health(inputs(fill(1.05, 6)));
    expect(result.value).toBe('safe');
    expect(result.reasons).toEqual(['Viewers are 105% of what Local TV expects']);
    expect(result.cause).toBeNull();
    expectSerialisable(result);
    if (result.ratio === null) throw new Error('Expected a ratio');
    expectTraceReplays(result.ratio);
  });

  it('cancels at missedToCancel missed airings in the window', () => {
    const result = health(inputs([MISSED, aired(1), MISSED, aired(1), MISSED]));
    expect(result.value).toBe('cancelling');
    expect(result.cause).toBe('missedAirings');
    expect(result.reasons[0]).toBe('3 missed airings: Local TV is pulling the deal');
  });

  it('only counts missed airings inside missedWindow', () => {
    const recent = [MISSED, MISSED, ...fill(1, 6), MISSED];
    expect(health(inputs(recent)).value).toBe('atRisk');
  });

  it('is at risk one missed airing short, with the "one more" reason', () => {
    const result = health(inputs([MISSED, ...fill(1, 3), MISSED]));
    expect(result.value).toBe('atRisk');
    expect(result.cause).toBeNull();
    expect(result.reasons).toEqual([
      'One more missed airing and Local TV cancels',
      'Missed airing: Mon 18 Jan',
      'Missed airing: Mon 21 Dec',
    ]);
  });

  it('is at risk when cancelled shows coming up would reach the limit', () => {
    const result = health(
      inputs([MISSED, ...fill(1, 5)], {
        upcomingMissed: [addDays(NEWEST, 7), addDays(NEWEST, 14)],
      }),
    );
    expect(result.value).toBe('atRisk');
    expect(result.reasons).toContain('Missed airing coming: Mon 25 Jan');
  });

  it('watches a single missed airing', () => {
    const result = health(inputs([...fill(1, 2), MISSED, ...fill(1, 3)]));
    expect(result.value).toBe('watch');
    expect(result.reasons).toEqual(['Missed airing: Mon 4 Jan']);
  });

  it('never cancels for misses when missedToCancel is 0', () => {
    const result = health(inputs([MISSED, MISSED, MISSED, MISSED, ...fill(1, 2)]), {
      'broadcast.health.missedToCancel': 0,
    });
    expect(result.value).toBe('watch');
  });

  it('cancels for low viewers below cancelBelow, naming the chance per airing', () => {
    const result = health(inputs(fill(0.48, 6)));
    expect(result.value).toBe('cancelling');
    expect(result.cause).toBe('lowViewers');
    // Tier 2: the base chance plus two steps.
    const chance =
      TUNABLES.get('broadcast.health.cancelChance') +
      2 * TUNABLES.get('broadcast.health.cancelChancePerTier');
    expect(result.cancelChance).toBeCloseTo(chance);
    expect(result.reasons[0]).toBe(
      `Viewers are 48% of what Local TV expects; each airing it may cancel (${String(Math.round(chance * 100))}%)`,
    );
  });

  it('is at risk below warnBelow', () => {
    const result = health(inputs(fill(0.6, 6)));
    expect(result.value).toBe('atRisk');
    expect(result.reasons[0]).toBe(
      'Viewers are 60% of what Local TV expects; below 55% it may cancel',
    );
  });

  it('judges only the last `window` aired airings', () => {
    const result = health(inputs([...fill(1, 6), ...fill(0.1, 2)]));
    expect(result.value).toBe('safe');
  });

  it('gives a new deal its grace period and too few airings no verdict on viewers', () => {
    expect(health(inputs(fill(0.1, 6), { daysSinceStart: 20 })).value).toBe('safe');
    expect(health(inputs(fill(0.1, 2))).value).toBe('safe');
    const graced = health(inputs(fill(0.1, 6), { daysSinceStart: 20 }));
    expect(JSON.stringify(graced.trace)).toContain('The deal is new');
    expect(graced.ratio).toBeNull();
  });

  it('puts the worst risk first when several apply', () => {
    const result = health(inputs([MISSED, ...fill(0.4, 5), MISSED]));
    expect(result.value).toBe('cancelling');
    expect(result.cause).toBe('lowViewers');
    expect(result.reasons.slice(0, 2)).toEqual([
      expect.stringContaining('Viewers are 40%'),
      'One more missed airing and Local TV cancels',
    ]);
  });

  it('writes days as "Mon 18 Jan"', () => {
    expect(healthDayText(NEWEST)).toBe('Mon 18 Jan');
  });
});

describe('exitFee', () => {
  const base = {
    networkName: 'Local TV',
    kind: 'tv' as const,
    feePerShow: 100_000,
    perThousandViewers: 2_000,
    viewers: 12_345,
    viewersFrom: 'lastAiring' as const,
  };

  it("is exitFeeShows shows' worth of the fee and the per-thousand pay", () => {
    const shows = TUNABLES.get('broadcast.deal.exitFeeShows');
    const result = exitFee(base, { tunables: TUNABLES });
    const perShow = base.feePerShow + Math.floor((base.viewers / 1_000) * base.perThousandViewers);
    expect(result.value).toBe(Math.floor(perShow * shows));
    expectTraceReplays(result);
    expectSerialisable(result);
  });

  it('is 0 when exitFeeShows is 0', () => {
    const tunables = createEngineTunables({ 'broadcast.deal.exitFeeShows': 0 });
    expect(exitFee(base, { tunables }).value).toBe(0);
  });

  it('says when it used the projected viewers', () => {
    const result = exitFee({ ...base, viewersFrom: 'projected' }, { tunables: TUNABLES });
    expect(JSON.stringify(result.trace)).toContain('expected (nothing has aired yet)');
  });
});
