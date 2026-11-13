// The weekly prune of stored aftermaths (MTCH3-03): each worker keeps their newest rows.
// Design: docs/design/match-aftermath.md#stored-aftermaths
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState } from '../../../../src/core/api';
import { simSystem } from '../../../../src/core/api/builtins';
import { addDays } from '../../../../src/core/date';
import type { AftermathId } from '../../../../src/core/ids';
import {
  aftermathsToPrune,
  matchSystem,
  pruneAftermathsPhase,
} from '../../../../src/systems/match';
import { workersSystem } from '../../../../src/systems/workers';
import { anAftermath } from '../../../support/builders/aftermath';
import { TEST_START_DATE } from '../../../support/builders/build-row';
import { worldBuilder } from '../../../support/world-builder';

const SHOWS = 12;

/**
 * Twelve one-match shows on the twelve days before the start, worker 0 beating worker 1 in each,
 * with both workers' aftermath rows stored.
 */
function historyWorld() {
  let builder = worldBuilder()
    .withGeography('mini')
    .withPromotion({}, (promotion) => promotion.withRoster(2));
  for (let index = 0; index < SHOWS; index += 1) {
    builder = builder
      .withEventInstance({ date: addDays(TEST_START_DATE, index - SHOWS), status: 'completed' })
      .withCompletedMatch({ show: index, slot: 0, sides: [[0], [1]], result: 0 });
  }
  return builder
    .with('aftermaths', (context) => {
      const { ids } = context;
      ids.segments.forEach((segmentId, index) => {
        const eventInstanceId = ids.eventInstances[index];
        const promotionId = ids.promotions.A;
        const [regionId] = ids.regions;
        if (eventInstanceId === undefined || promotionId === undefined || regionId === undefined) {
          throw new Error('history world is missing a row');
        }
        const date = context.tx.view.tables.eventInstances.require(eventInstanceId).date;
        ids.people.forEach((personId, personIndex) => {
          context.insert(
            'aftermaths',
            anAftermath(
              {
                segmentId,
                eventInstanceId,
                promotionId,
                personId,
                date,
                outcome: personIndex === 0 ? 'win' : 'loss',
                showRegionId: regionId,
              },
              context.sequence,
            ),
          );
        });
      });
    })
    .build();
}

describe('aftermathsToPrune', () => {
  it('keeps each person’s newest rows and lists the rest in id order', () => {
    const { world } = historyWorld();
    const pruned = aftermathsToPrune(world, 10);
    expect(pruned).toHaveLength(4);
    const dates = pruned.map((id) => world.tables.aftermaths.require(id).date);
    // The two oldest shows, for both workers.
    expect(new Set(dates)).toEqual(
      new Set([addDays(TEST_START_DATE, -SHOWS), addDays(TEST_START_DATE, -SHOWS + 1)]),
    );
    expect(pruned).toEqual([...pruned].sort());
  });

  it('prunes nothing when nobody has more than the limit', () => {
    const { world } = historyWorld();
    expect(aftermathsToPrune(world, SHOWS)).toEqual([]);
  });

  it('breaks a same-day tie by keeping the later row', () => {
    const { world, ids } = historyWorld();
    const personId = ids.people[0];
    if (personId === undefined) {
      throw new Error('no person');
    }
    const rows = world.tables.aftermaths.lookup('byPerson', personId);
    const sameDay = rows[rows.length - 1]?.date;
    const result = world.transact('same day', (tx) => {
      for (const row of rows) {
        tx.update('aftermaths', row.id, { date: sameDay ?? row.date });
      }
    });
    if (!result.ok) {
      throw result.error;
    }
    const pruned = new Set<AftermathId>(aftermathsToPrune(world, 10));
    const kept = rows.filter((row) => !pruned.has(row.id)).map((row) => row.id);
    expect(kept).toEqual(
      rows
        .map((row) => row.id)
        .sort()
        .slice(2),
    );
  });
});

describe('match.pruneAftermaths', () => {
  it('runs weekly on Mondays in the periodic group', () => {
    expect(pruneAftermathsPhase).toMatchObject({
      id: 'match.pruneAftermaths',
      group: 'periodic',
      order: 40,
      cadence: { kind: 'weekly', weekday: 'mon' },
    });
  });

  it('leaves each worker 10 rows after a Monday', async () => {
    const { world } = historyWorld();
    const engine = createEngine({
      state: initialEngineState(world),
      systems: [simSystem, workersSystem, matchSystem],
    });
    const advance = await engine.advanceDays({ maxDays: 7 });
    expect(advance.failures).toEqual([]);
    const { aftermaths } = engine.exportState().world.tables;
    expect(aftermaths).toHaveLength(20);
  });
});
