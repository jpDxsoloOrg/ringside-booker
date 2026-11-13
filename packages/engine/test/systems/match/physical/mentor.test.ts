// Mentor on the card (MTCH4-03). Design: docs/design/physical-toll.md#ring-learning
import { describe, expect, it } from 'vitest';
import type { PersonId } from '../../../../src/core/ids';
import type { RelationshipBond } from '../../../../src/model/entities/relationship';
import { mentorOnCard } from '../../../../src/systems/match';
import { aRelationship } from '../../../support/builders/promotions';
import { worldBuilder } from '../../../support/world-builder';

interface Bond {
  /** Roster indexes: the stored pair order follows the ids, whatever order is given here. */
  readonly pair: readonly [number, number];
  readonly bonds: RelationshipBond[];
  /** Roster index of the mentor, for a mentorship. */
  readonly mentor?: number;
}

function built(bonds: readonly Bond[]) {
  let builder = worldBuilder()
    .withGeography('mini')
    .withPromotion({}, (promotion) =>
      promotion.withRoster(5, {
        person: (index) => ({ defaultRingName: `Worker ${String(index)}` }),
      }),
    );
  builder = builder.with('relationships', (context) => {
    const at = (index: number): PersonId => {
      const id = context.ids.people[index];
      if (id === undefined) throw new Error(`no person ${String(index)}`);
      return id;
    };
    for (const bond of bonds) {
      context.insert(
        'relationships',
        aRelationship(
          {
            personAId: at(bond.pair[0]),
            personBId: at(bond.pair[1]),
            bonds: bond.bonds,
            mentorId: bond.mentor === undefined ? null : at(bond.mentor),
          },
          context.sequence,
        ),
      );
    }
  });
  const { world, ids } = builder.build();
  const person = (index: number): PersonId => {
    const id = ids.people[index];
    if (id === undefined) throw new Error(`no person ${String(index)}`);
    return id;
  };
  return { world, person };
}

describe('mentorOnCard', () => {
  it('finds the mentor when they are on the card', () => {
    const { world, person } = built([{ pair: [0, 1], bonds: ['mentorship'], mentor: 0 }]);
    expect(mentorOnCard(world, person(1), [person(0), person(1)])).toEqual({
      mentorId: person(0),
      name: 'Worker 0',
    });
  });

  it('finds the row whichever way round the pair is stored', () => {
    const { world, person } = built([{ pair: [3, 1], bonds: ['mentorship'], mentor: 3 }]);
    expect(mentorOnCard(world, person(1), [person(3)])?.mentorId).toBe(person(3));
    const reversed = built([{ pair: [1, 3], bonds: ['mentorship'], mentor: 1 }]);
    expect(mentorOnCard(reversed.world, reversed.person(3), [reversed.person(1)])?.mentorId).toBe(
      reversed.person(1),
    );
  });

  it('ignores a mentor who is not on the card', () => {
    const { world, person } = built([{ pair: [0, 1], bonds: ['mentorship'], mentor: 0 }]);
    expect(mentorOnCard(world, person(1), [person(1), person(2)])).toBeNull();
  });

  it('gives the mentor no mentor: only the mentee gets the line', () => {
    const { world, person } = built([{ pair: [0, 1], bonds: ['mentorship'], mentor: 0 }]);
    expect(mentorOnCard(world, person(0), [person(0), person(1)])).toBeNull();
  });

  it('ignores a bond that is not a mentorship', () => {
    const { world, person } = built([{ pair: [0, 1], bonds: ['friends'] }]);
    expect(mentorOnCard(world, person(1), [person(0)])).toBeNull();
  });

  it('is null without any relationship rows', () => {
    const { world, person } = built([]);
    expect(mentorOnCard(world, person(1), [person(0), person(2)])).toBeNull();
  });

  it('picks the lowest mentor id when two mentors are on the card, and uses nameOf', () => {
    const { world, person } = built([
      { pair: [2, 4], bonds: ['mentorship'], mentor: 4 },
      { pair: [0, 2], bonds: ['friends', 'mentorship'], mentor: 0 },
    ]);
    const lowest = [person(0), person(4)].sort()[0];
    const found = mentorOnCard(world, person(2), [person(4), person(0)], (id) => `Ring ${id}`);
    expect(found?.mentorId).toBe(lowest);
    expect(found?.name).toBe(`Ring ${String(lowest)}`);
  });
});
