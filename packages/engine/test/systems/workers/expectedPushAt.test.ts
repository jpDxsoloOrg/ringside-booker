// The world-reading helpers on the shipped default world.
// Design: docs/design/workers.md#expected-push
import { describe, expect, it } from 'vitest';
import { EntityNotFoundError } from '../../../src/core/errors';
import { PUSH_LEVELS } from '../../../src/model/entities/employment';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  activeEmploymentsOf,
  CREW_ROLES,
  expectedPushAt,
  footprintPopularityAt,
  footprintPopularityValue,
  isFreeAgent,
  mainRoleOf,
  overallByRole,
  RATING_ROLES,
} from '../../../src/systems/workers';
import { geographyOf } from '../../../src/systems/world/geography';
import { testId } from '../../support/ids';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';
import { loadDefaultWorld } from './default-world';

const world = loadDefaultWorld();
const today = world.meta.currentDate;
const tunables = createEngineTunables();
const people = world.tables.people.values();
const promotions = world.tables.promotions.values();

function isCrew(role: string): boolean {
  return CREW_ROLES.some((crewRole) => crewRole === role);
}

describe('expectedPushAt', () => {
  it('uses the job the person has at that promotion', () => {
    let crewChecked = 0;
    let pushedChecked = 0;
    for (const person of people) {
      for (const employment of activeEmploymentsOf(world, person.id, today)) {
        const result = expectedPushAt(world, person.id, employment.promotionId, tunables);
        expectSerialisable(result);
        expect(PUSH_LEVELS).toContain(result.value);
        if (isCrew(employment.role)) {
          expect(result.value).toBe('none');
          crewChecked += 1;
        } else {
          expect(result.value).not.toBe('none');
          pushedChecked += 1;
        }
      }
    }
    expect(crewChecked).toBeGreaterThan(0);
    expect(pushedChecked).toBeGreaterThan(0);
  });

  it('uses the main role for someone who does not work there', () => {
    const freeAgents = people.filter((person) => isFreeAgent(world, person.id, today));
    expect(freeAgents.length).toBeGreaterThan(0);
    const [promotion] = promotions;
    if (promotion === undefined) {
      throw new Error('The default world has no promotions');
    }
    for (const person of freeAgents) {
      const result = expectedPushAt(world, person.id, promotion.id, tunables);
      const crew = isCrew(mainRoleOf(person, null));
      expect(result.value === 'none').toBe(crew);
    }
  });

  it('throws for an unknown person or promotion', () => {
    const [person] = people;
    const [promotion] = promotions;
    if (person === undefined || promotion === undefined) {
      throw new Error('The default world is empty');
    }
    expect(() => expectedPushAt(world, testId('person', 999_999), promotion.id, tunables)).toThrow(
      EntityNotFoundError,
    );
    expect(() => expectedPushAt(world, person.id, testId('promotion', 999_999), tunables)).toThrow(
      EntityNotFoundError,
    );
    expect(() =>
      footprintPopularityAt(world, person.id, testId('promotion', 999_999), tunables),
    ).toThrow(EntityNotFoundError);
  });
});

describe('footprintPopularityAt', () => {
  it('matches the plain value for every person at every promotion', () => {
    const regions = geographyOf(world).regions;
    for (const promotion of promotions) {
      for (const person of people) {
        const traced = footprintPopularityAt(world, person.id, promotion.id, tunables);
        const plain = footprintPopularityValue(
          {
            subjectPop: person.regionalPop,
            promotionPop: promotion.regionalPop,
            promotionName: promotion.name,
            regions,
          },
          { tunables },
        );
        expect(traced.value).toBe(plain);
        expect(traced.value).toBeGreaterThanOrEqual(0);
        expect(traced.value).toBeLessThanOrEqual(100.000001);
      }
    }
    const [person] = people;
    const [promotion] = promotions;
    if (person !== undefined && promotion !== undefined) {
      expectTraceReplays(footprintPopularityAt(world, person.id, promotion.id, tunables));
    }
  });
});

describe('role ratings on the default world', () => {
  it('rates every person in every role, between 0 and 100, with a trace that replays', () => {
    for (const person of people) {
      const ratings = overallByRole(person, { tunables });
      for (const role of RATING_ROLES) {
        expect(ratings[role].value).toBeGreaterThanOrEqual(0);
        expect(ratings[role].value).toBeLessThanOrEqual(100);
        expectTraceReplays(ratings[role]);
      }
    }
  });
});
