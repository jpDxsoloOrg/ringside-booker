// EVT6 x EVT5: a show's popularity change flows into the next show's crowd forecast (EVT6-07).
// The forecast reads `regionalPop` on every query, so a strong show raises the next show's
// "Popularity in <region>" line and its expected crowd, and a weak show lowers both.
// Design: docs/design/box-office.md#integrations
import { describe, expect, it } from 'vitest';
import { OMNISCIENT_VIEWER } from '../../../src/core/api';
import type { EventInstanceId } from '../../../src/core/ids';
import { findTraceNodes, type TraceNode } from '../../../src/core/trace';
import type { ShowForecast } from '../../../src/systems/boxOffice';
import { boxOfficeSystem } from '../../../src/systems/boxOffice';
import { financeSystem } from '../../../src/systems/finance';
import { promoPopSystem } from '../../../src/systems/promoPop';
import { anEventInstance } from '../../support/builders/creative';
import { testId } from '../../support/ids';
import {
  baseWorld,
  completedShow,
  day,
  NORTH_1,
  runShows,
  type PromoPopRun,
} from '../promoPop/show-world';

const PROMOTION_A = testId('promotion', 1);
const SYSTEMS = [promoPopSystem, financeSystem, boxOfficeSystem];
const LINE_PREFIX = 'Popularity in Test Region North 1';

/**
 * Promotion A at popularity 20 in North 1 with its next show scheduled a week out. With `score`,
 * a show scoring that runs on the first day; without it, nothing runs.
 */
async function nextShowAfter(score: number | null): Promise<{
  run: PromoPopRun;
  next: EventInstanceId;
}> {
  let next: EventInstanceId | undefined;
  const builder = baseWorld().with('shows', (context) => {
    if (score !== null) {
      completedShow(context, { score, date: '2026-01-05' });
    }
    next = context.insert(
      'eventInstances',
      anEventInstance(
        {
          promotionId: PROMOTION_A,
          regionId: NORTH_1,
          status: 'scheduled',
          importance: 'regular',
          date: day('2026-01-12'),
          airDate: day('2026-01-12'),
        },
        context.sequence,
      ),
    ).id;
  });
  const run = await runShows(builder, { systems: SYSTEMS });
  if (next === undefined) {
    throw new Error('the next show was not inserted');
  }
  return { run, next };
}

function forecastOf(run: PromoPopRun, eventInstanceId: EventInstanceId): ShowForecast {
  const result = run.engine.query('boxOffice.forecast', { eventInstanceId }, OMNISCIENT_VIEWER);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  return result.data;
}

/** The forecast's "Popularity in North 1" input value. */
function popularityLine(trace: TraceNode): unknown {
  return findTraceNodes(trace, 'input').find((node) => node.label.startsWith(LINE_PREFIX))?.value;
}

describe('promotion popularity and the crowd forecast', () => {
  it('a strong show raises the next show’s popularity line and expected crowd', async () => {
    const baseline = await nextShowAfter(null);
    const strong = await nextShowAfter(95);
    const before = forecastOf(baseline.run, baseline.next);
    const after = forecastOf(strong.run, strong.next);
    const stored = strong.run.promotion(PROMOTION_A).regionalPop[NORTH_1] ?? 0;

    expect(stored).toBeGreaterThan(20);
    expect(popularityLine(before.trace)).toBe(20);
    expect(popularityLine(after.trace)).toBe(stored);
    expect(after.demand).toBeGreaterThan(before.demand);
  });

  it('a weak show lowers the next show’s popularity line and expected crowd', async () => {
    const baseline = await nextShowAfter(null);
    const weak = await nextShowAfter(5);
    const before = forecastOf(baseline.run, baseline.next);
    const after = forecastOf(weak.run, weak.next);
    const stored = weak.run.promotion(PROMOTION_A).regionalPop[NORTH_1] ?? 0;

    expect(stored).toBeLessThan(20);
    expect(popularityLine(after.trace)).toBe(stored);
    expect(after.demand).toBeLessThan(before.demand);
  });
});
