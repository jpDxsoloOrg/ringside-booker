// Per-show production costs (ECO7-01). Design: docs/design/production.md#per-show-costs
import { describe, expect, it } from 'vitest';
import { makeGameDate } from '../../../src/core/date';
import {
  NO_PAID_PRODUCTION_NOTE,
  NO_SHOWS_IN_WINDOW_NOTE,
  productionShowCost,
  upcomingShowCost,
} from '../../../src/systems/production';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';
import { ALTURA, deps, HARDPAN, NOTHING } from './support';

function checked<T extends ReturnType<typeof productionShowCost>>(result: T): T {
  expectTraceReplays(result);
  expectSerialisable(result.trace);
  return result;
}

describe('productionShowCost', () => {
  it('charges Hardpan Friday $710, and $4,910 once camera is at 4', () => {
    const before = checked(
      productionShowCost(
        {
          promotionName: 'Hardpan',
          showName: 'Hardpan Friday',
          importance: 'minor',
          levels: HARDPAN,
        },
        deps(),
      ),
    );
    expect(before.value).toBe(71_000);
    expectTraceContains(before, { kind: 'add', label: 'Camera (level 2)' });
    const after = checked(
      productionShowCost(
        {
          promotionName: 'Hardpan',
          showName: 'Hardpan Friday',
          importance: 'minor',
          levels: { ...HARDPAN, camera: 4 },
        },
        deps(),
      ),
    );
    expect(after.value).toBe(491_000);
  });

  it('charges Altura $203,260 for a regular show', () => {
    const result = checked(
      productionShowCost(
        { promotionName: 'Altura', showName: 'Mainstage', importance: 'regular', levels: ALTURA },
        deps(),
      ),
    );
    expect(result.value).toBe(20_326_000);
  });

  it('notes a show with no paid production', () => {
    const result = checked(
      productionShowCost(
        {
          promotionName: 'Wattle',
          showName: 'Wattle Night',
          importance: 'flagship',
          levels: NOTHING,
        },
        deps(),
      ),
    );
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: NO_PAID_PRODUCTION_NOTE });
  });
});

describe('upcomingShowCost', () => {
  it('adds one line per show', () => {
    const result = checked(
      upcomingShowCost(
        {
          promotionName: 'Hardpan',
          levels: HARDPAN,
          shows: [
            { name: 'Hardpan Friday', date: makeGameDate(2026, 1, 8), importance: 'minor' },
            { name: 'Hardpan Friday', date: makeGameDate(2026, 1, 15), importance: 'minor' },
            { name: 'Dust Bowl', date: makeGameDate(2026, 1, 24), importance: 'major' },
          ],
        },
        deps(),
      ),
    );
    // Two minor shows at $710 and a major one at 3 × $710.
    expect(result.value).toBe(71_000 * 2 + 213_000);
    expectTraceContains(result, { kind: 'add', label: 'Hardpan Friday, 8 Jan (minor)' });
    expectTraceContains(result, { kind: 'add', label: 'Dust Bowl, 24 Jan (major)' });
  });

  it('is 0 with a note when the window has no shows', () => {
    const result = checked(
      upcomingShowCost({ promotionName: 'Hardpan', levels: HARDPAN, shows: [] }, deps()),
    );
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: NO_SHOWS_IN_WINDOW_NOTE });
  });
});
