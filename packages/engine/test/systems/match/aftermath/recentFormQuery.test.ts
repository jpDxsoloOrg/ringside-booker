// `match.recentForm` (MTCH3-04): a worker's last matches with the stored popularity and momentum
// changes. Design: docs/design/match-aftermath.md#recent-form
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  defineSystem,
  initialEngineState,
  OMNISCIENT_VIEWER,
} from '../../../../src/core/api';
import { simSystem } from '../../../../src/core/api/builtins';
import { definePhase } from '../../../../src/core/pipeline/phase';
import { aftermathSegmentPersonKey } from '../../../../src/model/entities/aftermath';
import {
  applySegmentAftermath,
  matchSystem,
  momentumGainTraceRef,
  popularityGainTraceRef,
  RECENT_FORM_DEFAULT_LIMIT,
} from '../../../../src/systems/match';
import { workersSystem } from '../../../../src/systems/workers';
import { DEFAULT_METHOD_KEY } from '../../../support/builders/creative';
import { testId } from '../../../support/ids';
import { expectSerialisable } from '../../../support/trace';
import { aftermathWorld } from './fixtures';

const STAR = 0;

/**
 * Person 0 wins slot 0, loses slot 1 and draws slot 2 of one show; the aftermaths of all three are
 * applied on the first day, then the row of the middle match is deleted, as the weekly prune would.
 */
async function formEngine() {
  const built = aftermathWorld({
    popularity: [40, 50, 45, 30],
    // The day of the show, so it is in the past once the day is run.
    currentDate: '2026-02-04',
    matches: [
      { slot: 0, sides: [[STAR], [1]], result: 0 },
      { slot: 1, sides: [[2], [STAR]], result: 0 },
      { slot: 2, sides: [[STAR], [3]], result: 'draw' },
    ],
  });
  const applier = defineSystem({
    id: 'recentFormTest',
    phases: [
      definePhase({
        id: 'recentFormTest.apply',
        group: 'housekeeping',
        order: 10,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          if (ctx.read.tables.aftermaths.size > 0) {
            return;
          }
          for (const index of [0, 1, 2]) {
            applySegmentAftermath(ctx, built.segment(index));
          }
          const pruned = ctx.read.tables.aftermaths
            .lookup(
              'bySegmentPerson',
              aftermathSegmentPersonKey(built.segment(1), built.person(STAR)),
            )
            .at(0);
          if (pruned !== undefined) {
            ctx.tx.delete('aftermaths', pruned.id);
          }
        },
      }),
    ],
  });
  const engine = createEngine({
    state: initialEngineState(built.world),
    systems: [simSystem, workersSystem, matchSystem, applier],
  });
  const advance = await engine.advanceDays({ maxDays: 1 });
  expect(advance.failures).toEqual([]);
  return { built, engine };
}

describe('match.recentForm', () => {
  it('lists the matches newest first with the stored changes', async () => {
    const { built, engine } = await formEngine();
    const result = engine.query(
      'match.recentForm',
      { personId: built.person(STAR) },
      OMNISCIENT_VIEWER,
    );
    if (!result.ok) {
      throw new Error(JSON.stringify(result.reasons));
    }
    expectSerialisable(result.data);
    const { matches } = result.data;
    expect(matches.map((row) => [row.segmentId, row.result])).toEqual([
      [built.segment(2), 'draw'],
      [built.segment(1), 'loss'],
      [built.segment(0), 'win'],
    ]);
    const [draw, loss, win] = matches;
    expect(win).toMatchObject({
      eventInstanceId: built.show,
      methodKey: DEFAULT_METHOD_KEY,
      opponents: [{ personId: built.person(1) }],
      traceRefs: {
        popularity: popularityGainTraceRef(built.segment(0), built.person(STAR)),
        momentum: momentumGainTraceRef(built.segment(0), built.person(STAR)),
      },
    });
    expect(win?.opponents[0]?.name).not.toBe('');
    expect(win?.popularityChange).toBeGreaterThan(0);
    // Momentum started at 0 and an equal-ish win adds to it.
    expect(win?.momentumChange).toBeGreaterThan(0);
    expect(draw?.methodKey).toBeNull();
    expect(draw?.momentumChange).toBeLessThan(0);
    // The pruned row keeps the match but loses its numbers and Why?.
    expect(loss).toMatchObject({
      popularityChange: null,
      momentumChange: null,
      traceRefs: { popularity: null, momentum: null },
    });
  });

  it('keeps to the limit, 5 by default', async () => {
    const { built, engine } = await formEngine();
    const one = engine.query(
      'match.recentForm',
      { personId: built.person(STAR), limit: 1 },
      OMNISCIENT_VIEWER,
    );
    expect(one.ok && one.data.matches.map((row) => row.segmentId)).toEqual([built.segment(2)]);
    expect(RECENT_FORM_DEFAULT_LIMIT).toBe(5);
    const tooMany = engine.query(
      'match.recentForm',
      { personId: built.person(STAR), limit: 11 },
      OMNISCIENT_VIEWER,
    );
    expect(tooMany.ok).toBe(false);
  });

  it('lists only that person’s matches, and refuses an unknown person', async () => {
    const { built, engine } = await formEngine();
    const result = engine.query(
      'match.recentForm',
      { personId: built.person(3) },
      OMNISCIENT_VIEWER,
    );
    expect(result.ok && result.data.matches).toHaveLength(1);
    const unknown = engine.query(
      'match.recentForm',
      { personId: testId('person', 999) },
      OMNISCIENT_VIEWER,
    );
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.reasons[0]?.code).toBe('notFound');
  });
});
