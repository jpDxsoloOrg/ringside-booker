// EVT5 wired into the Office (DAY2-06): the "Recent shows" lines in the headline popularity Why?
// and the `popularity.monthGains` query behind the Fan base sheet's "This month" figure.
// Design: docs/design/promotion-popularity.md#integrations
import { describe, expect, it } from 'vitest';
import { yearMonthOf } from '../../../src/core/date';
import type { PromotionId } from '../../../src/core/ids';
import { findTraceNodes } from '../../../src/core/trace';
import { isFullTrace } from '../../../src/core/trace/store';
import { officeSystem, POPULARITY_TRACE_KIND } from '../../../src/systems/office';
import {
  MONTH_GAINS_UNKNOWN_PROMOTION_MESSAGE,
  promoPopSystem,
  RECENT_SHOWS_IN_WHY,
  recentShowLines,
  signedPopularity,
} from '../../../src/systems/promoPop';
import { aPopularityShowChange } from '../../support/builders/popularity';
import { testId } from '../../support/ids';
import { expectSerialisable } from '../../support/trace';
import {
  baseWorld,
  completedShow,
  day,
  NORTH_1,
  OMNISCIENT,
  runShows,
  type PromoPopRun,
} from './show-world';

const PROMOTION_A = testId('promotion', 1);

/** Every note line of the promotion's stored headline popularity Why?. */
function headlineNotes(run: PromoPopRun, promotionId: PromotionId): string[] {
  const stored = run.trace({ kind: POPULARITY_TRACE_KIND, id: promotionId });
  if (stored === null || !isFullTrace(stored)) {
    return expect.fail('the headline Why? is stored');
  }
  return findTraceNodes(stored.trace, 'note').map((node) => node.label);
}

describe('the "Recent shows" lines in the headline popularity Why?', () => {
  it('lists the show the chip moved for, the same night', async () => {
    const builder = baseWorld().with('show', (context) => {
      completedShow(context, { score: 90, date: '2026-01-06', name: 'Big Night' });
    });
    const run = await runShows(builder, {
      days: 2,
      systems: [promoPopSystem, officeSystem],
    });
    const record = run.tables.popularityShowChanges[0] ?? expect.fail('the show was applied');
    const change = signedPopularity(record.worldAfter - record.worldBefore);

    expect(headlineNotes(run, PROMOTION_A)).toContain(
      `Recent shows: Big Night on Tue 6 Jan, worldwide ${change}`,
    );
  });

  it('lists at most three shows, newest first, and none dated after the Why?', () => {
    const world = baseWorld()
      .with('records', (context) => {
        const dates = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02'];
        dates.forEach((date, index) => {
          const showId = completedShow(context, {
            score: 60,
            date,
            name: `Show ${String(index + 1)}`,
          });
          context.insert(
            'popularityShowChanges',
            aPopularityShowChange(
              {
                eventInstanceId: showId,
                promotionId: PROMOTION_A,
                date: day(date),
                worldBefore: 5,
                worldAfter: 5 + (index - 2) * 0.25,
              },
              context.sequence,
            ),
          );
        });
      })
      .build().world;

    const lines = recentShowLines(world, PROMOTION_A, day('2026-01-27'));
    expect(lines).toHaveLength(RECENT_SHOWS_IN_WHY);
    expect(lines).toEqual([
      'Recent shows: Show 4 on Mon 26 Jan, worldwide +0.3',
      'Recent shows: Show 3 on Mon 19 Jan, worldwide 0.0',
      'Recent shows: Show 2 on Mon 12 Jan, worldwide −0.3',
    ]);
    expect(recentShowLines(world, testId('promotion', 99), day('2026-01-27'))).toEqual([]);
  });

  it('adds nothing before the first show', () => {
    const world = baseWorld().build().world;
    expect(recentShowLines(world, PROMOTION_A, day('2026-01-05'))).toEqual([]);
  });
});

describe('popularity.monthGains', () => {
  it("gives this month's gains by region with the cap", async () => {
    const builder = baseWorld().with('show', (context) => {
      completedShow(context, { score: 90, date: '2026-01-05' });
    });
    const run = await runShows(builder);
    const result = run.engine.query(
      'popularity.monthGains',
      { promotionId: PROMOTION_A },
      OMNISCIENT,
    );
    if (!result.ok) return expect.fail(JSON.stringify(result.reasons));
    expectSerialisable(result.data);

    expect(result.data.month).toBe(yearMonthOf(day('2026-01-06')));
    expect(result.data.cap).toBe(3);
    expect(result.data.byRegion[NORTH_1]).toBeGreaterThan(0);
    expect(result.data.byRegion[NORTH_1]).toBeLessThanOrEqual(3);
    // Every listed gain is a real one.
    expect(Object.values(result.data.byRegion).every((gain) => gain > 0)).toBe(true);
  });

  it('is empty in a month with no shows yet', async () => {
    const builder = baseWorld().with('show', (context) => {
      completedShow(context, { score: 90, date: '2026-01-30' });
    });
    const run = await runShows(builder, { days: 28 });
    const result = run.engine.query(
      'popularity.monthGains',
      { promotionId: PROMOTION_A },
      OMNISCIENT,
    );
    if (!result.ok) return expect.fail(JSON.stringify(result.reasons));
    expect(result.data.month).toBe(yearMonthOf(day('2026-02-02')));
    expect(result.data.byRegion).toEqual({});
  });

  it('refuses an unknown promotion', async () => {
    const run = await runShows(baseWorld());
    const result = run.engine.query(
      'popularity.monthGains',
      { promotionId: testId('promotion', 99) },
      OMNISCIENT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons[0]?.message).toBe(MONTH_GAINS_UNKNOWN_PROMOTION_MESSAGE);
  });
});
