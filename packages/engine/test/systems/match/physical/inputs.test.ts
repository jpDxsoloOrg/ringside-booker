// The physical toll's inputs (MTCH4-01). Design: docs/design/physical-toll.md#who-carries-load
import { describe, expect, it } from 'vitest';
import type { PersonId, PromotionId } from '../../../../src/core/ids';
import {
  collectPhysicalInputs,
  type PhysicalParticipant,
  type PhysicalSegmentSpec,
} from '../../../../src/systems/match';
import { expectSerialisable } from '../../../support/trace';
import { worldBuilder } from '../../../support/world-builder';

function built() {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({}, (promotion) =>
      promotion.withRoster(6, {
        person: (index) => ({ fatigue: 10 * index, attributes: { safety: 40 + index } }),
      }),
    )
    .withEventInstance({ format: { slots: 6, preShowSlots: 1 } })
    .withCompletedMatch({ show: 0, slot: 0, preShow: true, sides: [[0], [1]], result: 0 })
    .withCompletedMatch({ show: 0, slot: 0, sides: [[0], [2]], result: 1, run: false })
    .withCompletedMatch({ show: 0, slot: 3, sides: [[0], [3]], result: null, run: false })
    .build();
  const person = (index: number): PersonId => {
    const id = ids.people[index];
    if (id === undefined) throw new Error(`no person ${String(index)}`);
    return id;
  };
  const promotionId = ids.promotions.A!;
  const showId = ids.eventInstances[0];
  if (showId === undefined) throw new Error('no show');
  return { world, person, promotionId, showId };
}

function competitor(personId: PersonId): PhysicalParticipant {
  return { personId, role: 'competitor' };
}

function spec(
  promotionId: PromotionId,
  sides: PhysicalParticipant[][],
  extra: Partial<PhysicalSegmentSpec> = {},
): PhysicalSegmentSpec {
  return {
    promotionId,
    importance: 'regular',
    kind: 'match',
    durationClass: 'standard',
    sides,
    crew: { producerId: null },
    keepItSafe: false,
    ...extra,
  };
}

describe('collectPhysicalInputs', () => {
  it('gives no load to ringside, interferers, speakers or subjects', () => {
    const { world, person, promotionId } = built();
    const workers = collectPhysicalInputs(
      world,
      spec(promotionId, [
        [competitor(person(0)), { personId: person(4), role: 'ringside' }],
        [competitor(person(1)), { personId: person(5), role: 'interferer' }],
      ]),
    );
    expect(workers.map((worker) => worker.personId)).toEqual([person(0), person(1)]);
    expect(workers.map((worker) => worker.workersInMatch)).toEqual([2, 2]);
    expectSerialisable(workers);
  });

  it('gives an angle no load at all', () => {
    const { world, person, promotionId } = built();
    const workers = collectPhysicalInputs(
      world,
      spec(promotionId, [[competitor(person(0))], [{ personId: person(1), role: 'speaker' }]], {
        kind: 'angle',
      }),
    );
    expect(workers).toEqual([]);
  });

  it('lists every competitor on another side as an opponent in a triple threat', () => {
    const { world, person, promotionId } = built();
    const workers = collectPhysicalInputs(
      world,
      spec(promotionId, [
        [competitor(person(2))],
        [competitor(person(1))],
        [competitor(person(0))],
      ]),
    );
    expect(workers.map((worker) => [worker.side, worker.workersInMatch])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
    const [first] = workers;
    expect(first?.opponents.map((opponent) => opponent.personId)).toEqual([person(1), person(0)]);
    expect(first?.opponents.map((opponent) => opponent.safety)).toEqual([41, 40]);
    expect(first?.opponents[0]?.name).toBe(workers[1]?.name);
  });

  it('reads each side in id order', () => {
    const { world, person, promotionId } = built();
    const ids = [person(3), person(1)];
    const workers = collectPhysicalInputs(
      world,
      spec(promotionId, [ids.map(competitor), [competitor(person(0))]]),
    );
    expect(workers.map((worker) => worker.personId)).toEqual([...ids].sort().concat(person(0)));
  });

  it('replaces fatigue with a lab override in the inputs only', () => {
    const { world, person, promotionId } = built();
    const workers = collectPhysicalInputs(
      world,
      spec(promotionId, [[competitor(person(1))], [competitor(person(2))]], {
        fatigueOverrides: { [person(1)]: 77 },
      }),
    );
    expect(workers.map((worker) => worker.fatigue)).toEqual([77, 20]);
    expect(world.tables.people.require(person(1)).fatigue).toBe(10);
  });

  it('counts the matches each worker works earlier on the same card', () => {
    const { world, person, promotionId, showId } = built();
    const at = (preShow: boolean, slot: number) =>
      collectPhysicalInputs(
        world,
        spec(promotionId, [[competitor(person(0))], [competitor(person(4))]], {
          card: { eventInstanceId: showId, preShow, slot },
        }),
      ).map((worker) => worker.matchesEarlierTonight);
    expect(at(true, 0)).toEqual([0, 0]);
    expect(at(false, 0)).toEqual([1, 0]);
    expect(at(false, 2)).toEqual([2, 0]);
    expect(at(false, 5)).toEqual([3, 0]);
    expect(
      collectPhysicalInputs(
        world,
        spec(promotionId, [[competitor(person(0))], [competitor(person(4))]]),
      ).map((worker) => worker.matchesEarlierTonight),
    ).toEqual([0, 0]);
  });
});
