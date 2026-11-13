// Ring learning for one segment, read from the world (MTCH4-03).
// Design: docs/design/physical-toll.md#ring-learning
import { describe, expect, it } from 'vitest';
import type { PersonId } from '../../../../src/core/ids';
import {
  collectRingLearning,
  type PhysicalParticipant,
  type PhysicalSegmentSpec,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import type { Person } from '../../../../src/model/entities/person';
import type { DeepPartial } from '../../../support/builders/build-row';
import { aRelationship } from '../../../support/builders/promotions';
import { expectTraceReplays } from '../../../support/trace';
import { worldBuilder } from '../../../support/world-builder';

const TUNABLES = createEngineTunables();
const OPEN = { potential: 900, ceilings: {} };

const ROSTER: readonly DeepPartial<Person>[] = [
  { attributes: { ringwork: 40 }, development: OPEN },
  { attributes: { ringwork: 40 }, development: OPEN },
  { attributes: { ringwork: 85 }, traits: ['teacher'], development: OPEN },
  { attributes: { producing: 75 }, development: OPEN },
  { defaultRingName: 'The Mentor', development: OPEN },
];

/**
 * 0: a young wrestler; 1: an equal opponent; 2: a veteran teacher (much better, `teacher`);
 * 3: a skilled producer; 4: the young wrestler's mentor, on the card but not in the match.
 */
function built(options: { mentorship?: boolean } = {}) {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({}, (promotion) =>
      promotion.withRoster(5, {
        person: (index) => ROSTER[index] ?? {},
        employment: (index) => (index === 2 ? { ringName: 'Iron Grady' } : {}),
      }),
    )
    .with('mentorship', (context) => {
      if (options.mentorship !== true) return;
      const [mentee, , , , mentor] = context.ids.people;
      if (mentee === undefined || mentor === undefined) throw new Error('no people');
      context.insert(
        'relationships',
        aRelationship(
          { personAId: mentee, personBId: mentor, bonds: ['mentorship'], mentorId: mentor },
          context.sequence,
        ),
      );
    })
    .build();
  const person = (index: number): PersonId => {
    const id = ids.people[index];
    if (id === undefined) throw new Error(`no person ${String(index)}`);
    return id;
  };
  const promotionId = ids.promotions.A;
  if (promotionId === undefined) throw new Error('no promotion');
  const spec = (
    sides: number[][],
    extra: Partial<PhysicalSegmentSpec> = {},
  ): PhysicalSegmentSpec => ({
    promotionId,
    importance: 'regular',
    kind: 'match',
    durationClass: 'standard',
    sides: sides.map((side) =>
      side.map((index): PhysicalParticipant => ({ personId: person(index), role: 'competitor' })),
    ),
    crew: { producerId: null },
    keepItSafe: false,
    ...extra,
  });
  return { world, person, spec };
}

function ringworkLabels(learning: ReturnType<typeof collectRingLearning>[number]): string[] {
  return (learning.perAttribute.ringwork.trace.children ?? []).map((node) => node.label);
}

describe('collectRingLearning', () => {
  it('teaches a young wrestler more next to a veteran teacher, naming them', () => {
    const { world, person, spec } = built();
    const [plain] = collectRingLearning(world, spec([[0], [1]]), { tunables: TUNABLES });
    const [taught] = collectRingLearning(world, spec([[0], [2]]), { tunables: TUNABLES });
    if (plain === undefined || taught === undefined) throw new Error('no learning');
    expect(taught.personId).toBe(person(0));
    expect(taught.total.value).toBeGreaterThan(plain.total.value);
    expect(ringworkLabels(taught)).toContain('Worked with a teacher: Iron Grady');
    expect(ringworkLabels(taught)).toContain('Learned from a better worker: Iron Grady');
    expectTraceReplays(taught.total);
  });

  it('gives the teacher no teacher line of their own', () => {
    const { world, spec } = built();
    const learning = collectRingLearning(world, spec([[0], [2]]), { tunables: TUNABLES });
    const teacher = learning[1];
    if (teacher === undefined) throw new Error('no teacher');
    expect(ringworkLabels(teacher).join('|')).not.toContain('teacher');
  });

  it('adds the producer line for a skilled producer', () => {
    const { world, person, spec } = built();
    const [learning] = collectRingLearning(
      world,
      spec([[0], [1]], { crew: { producerId: person(3) } }),
      { tunables: TUNABLES },
    );
    expect(
      learning && ringworkLabels(learning).some((label) => label.startsWith('Produced by')),
    ).toBe(true);
  });

  it('adds the mentor line when the mentor is on the card, and never without a relationship', () => {
    const withMentor = built({ mentorship: true });
    const onCard = [withMentor.person(0), withMentor.person(1), withMentor.person(4)];
    const [mentee] = collectRingLearning(withMentor.world, withMentor.spec([[0], [1]]), {
      tunables: TUNABLES,
      cardPersonIds: onCard,
    });
    expect(mentee && ringworkLabels(mentee)).toContain('Mentor on the card: The Mentor');
    // In the lab, the card is the segment: the mentor is not in it.
    const [labMentee] = collectRingLearning(withMentor.world, withMentor.spec([[0], [1]]), {
      tunables: TUNABLES,
    });
    expect(labMentee && ringworkLabels(labMentee).join('|')).not.toContain('Mentor');

    const none = built();
    const [noRows] = collectRingLearning(none.world, none.spec([[0], [1]]), {
      tunables: TUNABLES,
      cardPersonIds: [none.person(0), none.person(1), none.person(4)],
    });
    expect(noRows && ringworkLabels(noRows).join('|')).not.toContain('Mentor');
  });

  it('teaches nothing in an angle', () => {
    const { world, spec } = built();
    expect(
      collectRingLearning(world, spec([[0], [1]], { kind: 'angle' }), { tunables: TUNABLES }),
    ).toEqual([]);
  });

  it('adds every attribute into one total', () => {
    const { world, spec } = built();
    const [learning] = collectRingLearning(world, spec([[0], [2]]), { tunables: TUNABLES });
    if (learning === undefined) throw new Error('no learning');
    expect(
      (learning.total.trace.children ?? [])
        .filter((node) => node.kind === 'add')
        .map((node) => node.label),
    ).toEqual([
      expect.stringMatching(/^Ring work \+/),
      expect.stringMatching(/^Psychology \+/),
      expect.stringMatching(/^Stamina \+/),
      expect.stringMatching(/^Safety \+/),
    ]);
  });
});
