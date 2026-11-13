// Match type weight. Design: docs/design/rival-booking.md#match-types
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../../src/core/trace';
import {
  familyPlaceOf,
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

  it("shares a family's weight: the plain type keeps most, the variants split the rest", () => {
    const plain = weigh({ familyPlace: { plain: true, variants: 2 } });
    expect(plain.value).toBeCloseTo(80);
    expect(labels(plain)).toContain('The plain one-on-one match (2 variants share the rest)');
    const variant = weigh({ typeName: 'Sprint', familyPlace: { plain: false, variants: 2 } });
    expect(variant.value).toBeCloseTo(10);
    expect(labels(variant)).toContain('One of 2 one-on-one variants');
    // A family of one type keeps the whole weight.
    expect(weigh({ familyPlace: { plain: true, variants: 0 } }).value).toBeCloseTo(100);
    // Share 0: variants never come up; share 1: the plain type never does.
    const none = createEngineTunables({ 'aip.card.variantShare': 0 });
    expect(weigh({ familyPlace: { plain: false, variants: 2 } }, none).value).toBe(0);
    const all = createEngineTunables({ 'aip.card.variantShare': 1 });
    expect(weigh({ familyPlace: { plain: true, variants: 2 } }, all).value).toBe(0);
  });

  it('reads Singles as the plain one-on-one type of the shipped catalog', () => {
    const types = Object.values(TEST_CATALOGS.matchTypes ?? {})
      .filter((type) => !type.hidden)
      .sort((left, right) => left.order - right.order);
    const placeOf = (key: string) => {
      const type = types.find((entry) => entry.key === key);
      if (type === undefined) {
        throw new Error(`no ${key}`);
      }
      return familyPlaceOf(type, types);
    };
    expect(placeOf('match.singles')).toEqual({ plain: true, variants: 2 });
    expect(placeOf('match.sprint')).toEqual({ plain: false, variants: 2 });
    expect(placeOf('match.tag-team')).toEqual({ plain: true, variants: 0 });
  });

  it('follows the comfort margin', () => {
    const tuned = createEngineTunables({ 'aip.card.poolComfort': 1 });
    expect(weigh({ freeWrestlers: 2 }, tuned).value).toBeCloseTo(100);
  });
});
