// EVT5 x ECO1: show popularity changes flow into a promotion's reach and size (EVT5-04).
// `finance.company` reads `regionalPop` on every query and caches nothing, so a show's change
// shows up in the next read. Design: docs/design/promotion-popularity.md#integrations and
// docs/design/finances.md#reach-and-size
import { describe, expect, it } from 'vitest';
import type { CompanyView } from '../../../src/systems/finance';
import { financeSystem } from '../../../src/systems/finance';
import { promoPopSystem } from '../../../src/systems/promoPop';
import { addDays } from '../../../src/core/date';
import { findTraceNodes, type TraceNode } from '../../../src/core/trace';
import { testId } from '../../support/ids';
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

/** A blowout show for promotion A in North 1 every Monday for `weeks` weeks from 2026-01-05. */
function weeklyBlowouts(weeks: number, startPopularity: number) {
  return baseWorld({ regionalPop: { [NORTH_1]: startPopularity } }).with('shows', (context) => {
    for (let week = 0; week < weeks; week++) {
      const date = addDays(day('2026-01-05'), week * 7);
      completedShow(context, { score: 95, date });
    }
  });
}

function company(run: PromoPopRun): CompanyView {
  const result = run.engine.query('finance.company', { promotionId: PROMOTION_A }, OMNISCIENT);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  return result.data;
}

/** The value of the reach trace's "Popularity in <home region>" input line. */
function homeRegionLine(trace: TraceNode): unknown {
  return findTraceNodes(trace, 'input').find(
    (node) => node.label === 'Popularity in Test Region North 1',
  )?.value;
}

const SYSTEMS = [promoPopSystem, financeSystem];

describe('promotion popularity and company reach', () => {
  it('raises reach after several strong shows, with the new home-region value in the Why?', async () => {
    const before = company(await runShows(weeklyBlowouts(0, 20), { systems: SYSTEMS }));
    const after = await runShows(weeklyBlowouts(6, 20), { systems: SYSTEMS, days: 43 });
    const view = company(after);
    const stored = after.promotion(PROMOTION_A).regionalPop[NORTH_1] ?? 0;

    expect(stored).toBeGreaterThan(20);
    expect(view.reach).toBeGreaterThan(before.reach);
    expect(homeRegionLine(before.reachTrace)).toBe(20);
    expect(homeRegionLine(view.reachTrace)).toBe(stored);
  });

  it('changes the size label once growth carries reach over a threshold', async () => {
    // Popularity 5 in North 1 alone is a Local company; a year of weekly blowouts makes it Regional.
    const before = company(await runShows(weeklyBlowouts(0, 5), { systems: SYSTEMS }));
    const after = company(await runShows(weeklyBlowouts(52, 5), { systems: SYSTEMS, days: 365 }));

    expect(before.size).toBe('local');
    expect(after.size).not.toBe('local');
    expect(after.reach).toBeGreaterThan(before.reach);
  });
});
