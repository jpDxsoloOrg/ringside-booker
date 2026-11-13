// The hidden gate never leaks (MTCH4-03): no learning trace shows a potential number or a ceiling.
// Design: docs/design/physical-toll.md#ring-learning
import { describe, expect, it } from 'vitest';
import { walkTrace, type Traced } from '../../../../src/core/trace';
import type { Person } from '../../../../src/model/entities/person';
import {
  IN_MATCH_LEARNING,
  LIMITED_BY_POTENTIAL_LABEL,
  collectRingLearning,
  type PhysicalSegmentSpec,
} from '../../../../src/systems/match';
import {
  learningRoom,
  type LearningRoom,
} from '../../../../src/systems/match/physical/learningRoom';
import { createEngineTunables } from '../../../../src/systems/tunables';
import type { DeepPartial } from '../../../support/builders/build-row';
import { aRelationship } from '../../../support/builders/promotions';
import { worldBuilder } from '../../../support/world-builder';

const TUNABLES = createEngineTunables();
const POTENTIAL = 777;
const CEILING = 63.5;
const CEILINGS = { ringwork: CEILING, psychology: CEILING, safety: CEILING, stamina: CEILING };

/**
 * Six workers who between them hit every room: open (well under the ceiling), slowing (near it),
 * closed (over it), then the same three with negative potential (closed) and low potential
 * (slowing). Worker 6 is a teaching producer and mentors worker 0.
 */
const PEOPLE: readonly DeepPartial<Person>[] = [
  { attributes: { ringwork: 40, psychology: 41, safety: 42, stamina: 43 } },
  { attributes: { ringwork: 60, psychology: 61, safety: 62, stamina: 59 } },
  { attributes: { ringwork: 70, psychology: 64, safety: 80, stamina: 63.5 } },
  { attributes: { ringwork: 30, psychology: 31, safety: 32, stamina: 33 }, traits: ['teacher'] },
  {
    attributes: { ringwork: 50, psychology: 51, safety: 52, stamina: 53 },
    traits: ['fastLearner'],
  },
  {
    attributes: { ringwork: 45, psychology: 46, safety: 47, stamina: 48 },
    traits: ['slowLearner'],
  },
];
const POTENTIALS = [POTENTIAL, POTENTIAL, POTENTIAL, -POTENTIAL, 177, POTENTIAL];

function built() {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({}, (promotion) =>
      promotion.withRoster(7, {
        person: (index) =>
          index < PEOPLE.length
            ? {
                ...PEOPLE[index],
                development: { potential: POTENTIALS[index] ?? POTENTIAL, ceilings: CEILINGS },
              }
            : {
                attributes: { producing: 90 },
                traits: ['teacher'],
                development: { potential: POTENTIAL, ceilings: CEILINGS },
              },
      }),
    )
    .with('mentorship', (context) => {
      const [mentee, , , , , , mentor] = context.ids.people;
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
  const promotionId = ids.promotions.A;
  if (promotionId === undefined) throw new Error('no promotion');
  return { world, people: ids.people, promotionId };
}

function walkLabels(trace: Traced<number>['trace']): string[] {
  const labels: string[] = [];
  walkTrace(trace, (node) => {
    labels.push(node.label);
  });
  return labels;
}

describe('ring learning never shows the hidden development numbers', () => {
  it('leaves potential and ceilings out of every trace, in every room', () => {
    const { world, people, promotionId } = built();
    const producerId = people[6] ?? null;
    const competitors = people.slice(0, 6);
    const rooms = new Set<LearningRoom>();
    for (const durationClass of ['short', 'standard', 'long'] as const) {
      const spec: PhysicalSegmentSpec = {
        promotionId,
        importance: 'regular',
        kind: 'match',
        durationClass,
        sides: [
          competitors.slice(0, 3).map((personId) => ({ personId, role: 'competitor' as const })),
          competitors.slice(3).map((personId) => ({ personId, role: 'competitor' as const })),
        ],
        crew: { producerId },
        keepItSafe: false,
      };
      const learning = collectRingLearning(world, spec, { tunables: TUNABLES });
      expect(learning).toHaveLength(6);
      for (const worker of learning) {
        const person = world.tables.people.require(worker.personId);
        for (const { attribute } of IN_MATCH_LEARNING) {
          const traced = worker.perAttribute[attribute];
          const room = learningRoom(person, attribute, TUNABLES);
          rooms.add(room);
          expect(walkLabels(traced.trace).includes(LIMITED_BY_POTENTIAL_LABEL)).toBe(
            room !== 'open',
          );
          if (room === 'closed') expect(traced.value).toBe(0);
        }
        for (const label of walkLabels(worker.total.trace)) {
          if (label !== LIMITED_BY_POTENTIAL_LABEL) {
            expect(label).not.toMatch(/potential|ceiling/i);
          }
        }
        const json = JSON.stringify(worker);
        expect(json).not.toContain(String(POTENTIAL));
        expect(json).not.toContain(String(CEILING));
        expect(json).not.toContain('177');
        expect(json).not.toMatch(/lowPotential|slowingBand/);
      }
    }
    expect([...rooms].sort()).toEqual(['closed', 'open', 'slowing']);
  });
});
