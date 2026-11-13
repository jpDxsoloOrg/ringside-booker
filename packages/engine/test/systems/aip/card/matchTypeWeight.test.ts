// Match type weight. Design: docs/design/rival-booking.md#match-types
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../../src/core/trace';
import {
  matchFamilyOf,
  matchTypeWeight,
  type MatchTypeWeightInputs,
} from '../../../../src/systems/aip';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { TEST_CATALOGS } from '../../../support/catalogs';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const tunables = createEngineTunables();

function weigh(overrides: Partial<MatchTypeWeightInputs> = {}, tuned = tunables) {
  const result = matchTypeWeight(
    {
      typeName: 'Singles',
      family: 'oneOnOne',
      peopleNeeded: 2,
      freeWrestlers: 20,
      freeTeams: 0,
      riskAppetite: 50,
      ...overrides,
    },
    { tunables: tuned },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

function labels(result: ReturnType<typeof weigh>): string[] {
  return findTraceNodes(result.trace, 'multiply').map((node) => node.label);
}

describe('matchFamilyOf', () => {
  it('reads the family from the shipped match types', () => {
    const families = Object.fromEntries(
      Object.values(TEST_CATALOGS.matchTypes ?? {}).map((type) => [type.key, matchFamilyOf(type)]),
    );
    expect(families).toMatchObject({
      'match.singles': 'oneOnOne',
      'match.sprint': 'oneOnOne',
      'match.tag-team': 'tag',
      'match.trios': 'trios',
      'match.triple-threat': 'multiWay',
      'match.four-way': 'multiWay',
      'match.handicap': 'other',
      'match.battle-royal': 'other',
    });
  });
});

describe('matchTypeWeight', () => {
  it('gives each family its base weight with a comfortable roster', () => {
    expect(weigh().value).toBeCloseTo(100);
    expect(weigh({ family: 'tag', peopleNeeded: 4, freeTeams: 2 }).value).toBeCloseTo(35);
    expect(weigh({ family: 'trios', peopleNeeded: 6, freeTeams: 3 }).value).toBeCloseTo(6);
    expect(weigh({ family: 'multiWay', peopleNeeded: 3 }).value).toBeCloseTo(10);
    expect(weigh({ family: 'other', peopleNeeded: 6 }).value).toBeCloseTo(2);
  });

  it('halves the weight with exactly enough wrestlers and drops it when short', () => {
    expect(weigh({ freeWrestlers: 2 }).value).toBeCloseTo(50);
    expect(weigh({ freeWrestlers: 3 }).value).toBeCloseTo(75);
    expect(weigh({ freeWrestlers: 4 }).value).toBeCloseTo(100);
    const short = weigh({ family: 'trios', peopleNeeded: 6, freeWrestlers: 4, freeTeams: 2 });
    expect(short.value).toBe(0);
    expect(labels(short)).toContain('Only 4 free wrestlers, needs 6');
  });

  it("scales unusual types by the booker's taste, never one-on-one", () => {
    const multi = { family: 'multiWay', peopleNeeded: 3 } as const;
    expect(weigh({ ...multi, riskAppetite: 0 }).value).toBeCloseTo(5);
    expect(weigh({ ...multi, riskAppetite: 100 }).value).toBeCloseTo(15);
    expect(labels(weigh({ ...multi, riskAppetite: 100 }))).toContain(
      "Booker's taste for unusual matches (100)",
    );
    expect(weigh({ riskAppetite: 0 }).value).toBeCloseTo(100);
    expect(weigh({ riskAppetite: 100 }).value).toBeCloseTo(100);
  });

  it('cuts tag and trios types when fewer than two teams are free', () => {
    const tag = weigh({ family: 'tag', peopleNeeded: 4, freeTeams: 1 });
    expect(tag.value).toBeCloseTo(35 * 0.25);
    expect(labels(tag)).toContain('Fewer than two free teams (1)');
    expect(weigh({ family: 'trios', peopleNeeded: 6, freeTeams: 0 }).value).toBeCloseTo(1.5);
    // Other families never look at teams.
    expect(weigh({ family: 'multiWay', peopleNeeded: 3, freeTeams: 0 }).value).toBeCloseTo(10);
  });

  it('is 0 when the family weight is 0', () => {
    const tuned = createEngineTunables({ 'aip.card.typeWeight.oneOnOne': 0 });
    expect(weigh({}, tuned).value).toBe(0);
  });

  it('follows the comfort margin', () => {
    const tuned = createEngineTunables({ 'aip.card.poolComfort': 1 });
    expect(weigh({ freeWrestlers: 2 }, tuned).value).toBeCloseTo(100);
  });
});
