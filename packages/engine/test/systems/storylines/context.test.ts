// The engine-side storyline reader (CRTV3-01): storylineContextFor, storylinesOfPerson and
// activeStorylinesOf. Design: docs/design/storylines.md#context
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import { parseId } from '../../../src/core/ids';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import {
  activeStorylinesOf,
  storylineContextFor,
  storylinesOfPerson,
} from '../../../src/systems/storylines';
import { TEST_START_DATE } from '../../support';
import { storylineWorld } from './storyline-world';

describe('storylineContextFor', () => {
  it('gives the linked segments, the finale and days since the start with no progress', () => {
    const { world, ids } = storylineWorld();
    const hot = ids.storylines[1]!;
    const context = storylineContextFor(world, hot, addDays(TEST_START_DATE, 10));
    expect(context).toEqual({
      storylineId: hot,
      promotionId: ids.promotions.A,
      brandId: null,
      name: 'Test Hot Feud',
      status: 'active',
      heat: 85,
      startedOn: TEST_START_DATE,
      lastProgressOn: null,
      daysSinceProgress: 10,
      members: [
        { personId: ids.people[0], side: 'face' },
        { personId: ids.people[1], side: 'heel' },
        { personId: ids.people[3], side: 'heel' },
      ],
      linkedSegmentIds: [...ids.segments].sort(),
      finaleSegmentId: ids.segments[0],
    });
  });

  it('counts days since the last progress once there is one', () => {
    const { world, ids } = storylineWorld();
    const hot = ids.storylines[1]!;
    const result = world.transact('progress', (tx) => {
      tx.update('storylines', hot, { lastProgressOn: addDays(TEST_START_DATE, 7) });
    });
    if (!result.ok) throw result.error;
    expect(storylineContextFor(world, hot, addDays(TEST_START_DATE, 10))?.daysSinceProgress).toBe(
      3,
    );
  });

  it('returns null for an unknown storyline', () => {
    const { world } = storylineWorld();
    expect(
      storylineContextFor(world, parseId('storyline', 'sty_0000000099'), TEST_START_DATE),
    ).toBeNull();
  });
});

describe('storylinesOfPerson and activeStorylinesOf', () => {
  it("finds a person's storylines in id order, with or without ended ones", () => {
    const { world, ids } = storylineWorld();
    const person = ids.people[2]!;
    expect(storylinesOfPerson(world, person).map((row) => row.name)).toEqual([
      'Test Cold Feud',
      'Test Old Feud',
    ]);
    expect(storylinesOfPerson(world, person, { status: 'active' }).map((row) => row.name)).toEqual([
      'Test Cold Feud',
    ]);
    // Across promotions: person 0 is in two of A's and the rival's.
    expect(storylinesOfPerson(world, ids.people[0]!).map((row) => row.id)).toEqual([
      ids.storylines[0],
      ids.storylines[1],
      ids.storylines[3],
    ]);
  });

  it("lists a promotion's active storylines in id order", () => {
    const { world, ids } = storylineWorld();
    expect(activeStorylinesOf(world, ids.promotions.A!).map((row) => row.id)).toEqual([
      ids.storylines[0],
      ids.storylines[1],
    ]);
    expect(activeStorylinesOf(world, ids.promotions.B!).map((row) => row.id)).toEqual([
      ids.storylines[3],
    ]);
  });
});

describe('finaleIsLinkedMatch', () => {
  it('holds in the test world and fails for a finale that does not link the storyline', () => {
    const { world, ids } = storylineWorld();
    const storylineIssues = (): string[] =>
      checkWorld(world, TABLES, { validateRows: true })
        .issues.filter((issue) => issue.table === 'storylines')
        .map((issue) => issue.code);
    expect(storylineIssues()).toEqual([]);
    const result = world.transact('unlink', (tx) => {
      tx.update('segments', ids.segments[0]!, { storylineIds: [] });
    });
    if (!result.ok) throw result.error;
    expect(storylineIssues()).toEqual(['storylines.finaleIsLinkedMatch']);
  });
});
