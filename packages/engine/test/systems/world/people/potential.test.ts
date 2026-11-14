// Starting potential: the headroom curve, ceilings, the potential number, late bloomers, re-rolls.
// Design: docs/design/world-generation.md#potential
import { describe, expect, it } from 'vitest';
import { SLOW_TESTS } from '../../../support/slow';
import {
  addDays,
  ceilingKeysFor,
  createEngineTunables,
  estimateTalent,
  expectedHeadroom,
  findTraceNodes,
  headroomCurveOf,
  parseGameDate,
  PersonGenerator,
  POTENTIAL_MAX,
  POTENTIAL_MIN,
  reseedPotential,
  RngRegistry,
  seedPotential,
  type GameDate,
  type Person,
  type PersonId,
  type RngStream,
} from '@ringside/engine';
import { DevelopmentSchema } from '../../../../src/model/entities/person';
import { flatAttributes } from '../../../support/builders/people';
import { testId } from '../../../support/ids';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';
import { BASE_LIBRARY, loadBaseWorld, personAged, regionNamed, WORLD_DATE } from './base-world';

type TunableOverrides = Parameters<typeof createEngineTunables>[0];

const DEFAULT_CURVE = headroomCurveOf(createEngineTunables());

function streamFor(seed: string): RngStream {
  return new RngRegistry(seed).stream('worldgen.people.potential');
}

function seed(
  person: Person,
  talent: number,
  overrides: TunableOverrides = {},
  stream: RngStream = streamFor('potential'),
  worldDate: GameDate = WORLD_DATE,
) {
  return seedPotential(person, talent, worldDate, stream, {
    tunables: createEngineTunables(overrides),
    library: BASE_LIBRARY,
  });
}

function isLateBloomer(result: ReturnType<typeof seed>): boolean {
  return findTraceNodes(result.trace, 'note').some((node) =>
    node.label.startsWith('Late bloomer:'),
  );
}

describe('expectedHeadroom', () => {
  it('is H0 at 18 and younger and 0 at and above the zero age', () => {
    expect(expectedHeadroom(18, DEFAULT_CURVE)).toBe(32);
    expect(expectedHeadroom(15.5, DEFAULT_CURVE)).toBe(32);
    expect(expectedHeadroom(35, DEFAULT_CURVE)).toBe(0);
    expect(expectedHeadroom(35.001, DEFAULT_CURVE)).toBe(0);
    expect(expectedHeadroom(60, DEFAULT_CURVE)).toBe(0);
    expect(expectedHeadroom(34.99, DEFAULT_CURVE)).toBeGreaterThan(0);
  });

  it('has no step: 29.99 and 30.01 differ by under 0.1', () => {
    const difference =
      expectedHeadroom(29.99, DEFAULT_CURVE) - expectedHeadroom(30.01, DEFAULT_CURVE);
    expect(Math.abs(difference)).toBeLessThan(0.1);
  });

  it('never rises with age and never jumps anywhere from 10 to 60', () => {
    let previous = expectedHeadroom(10, DEFAULT_CURVE);
    for (let hundredths = 1001; hundredths <= 6000; hundredths++) {
      const value = expectedHeadroom(hundredths / 100, DEFAULT_CURVE);
      expect(value).toBeLessThanOrEqual(previous);
      expect(previous - value).toBeLessThan(0.1);
      previous = value;
    }
  });

  it('follows the curve tunables', () => {
    const steep = { headroomAt18: 20, zeroAge: 30, exponent: 2 };
    expect(expectedHeadroom(24, steep)).toBeCloseTo(20 * 0.5 ** 2, 10);
    expect(expectedHeadroom(30, steep)).toBe(0);
    expect(expectedHeadroom(24, { ...steep, headroomAt18: 0 })).toBe(0);
  });
});

describe('ceilingKeysFor', () => {
  it('covers performer attributes for wrestlers and role skills for everyone else', () => {
    expect(ceilingKeysFor({ roles: ['wrestler'] }, BASE_LIBRARY)).toEqual([
      'ringwork',
      'psychology',
      'stamina',
      'safety',
      'athleticism',
      'mic',
      'charisma',
      'presence',
    ]);
    expect(ceilingKeysFor({ roles: ['referee'] }, BASE_LIBRARY)).toEqual(['officiating']);
    expect(ceilingKeysFor({ roles: ['producer'] }, BASE_LIBRARY)).toEqual(['producing', 'booking']);
    // Managers have no crew skill of their own, so their character attributes count.
    expect(ceilingKeysFor({ roles: ['manager'] }, BASE_LIBRARY)).toEqual([
      'mic',
      'charisma',
      'presence',
    ]);
    expect(ceilingKeysFor({ roles: ['occasionalWrestler', 'announcer'] }, BASE_LIBRARY)).toContain(
      'broadcasting',
    );
  });
});

describe('seedPotential', () => {
  it('keeps ceilings between today and 100 and potential inside its range', () => {
    const stream = streamFor('ranges');
    const tunables = createEngineTunables();
    // 1,170 is every age (45) with every talent (13) twice; values of 0 to 100 come round as well.
    for (let index = 0; index < 1_170; index++) {
      const age = 16 + (index % 45);
      const attributeValue = (index * 37) % 101;
      const talent = ((index % 13) - 6) / 2;
      const person = personAged(age, {
        attributes: flatAttributes(attributeValue),
        roles: index % 5 === 0 ? ['referee'] : ['wrestler'],
        style: index % 5 === 0 ? 'nonWrestler' : 'allRounder',
      });
      const result = seedPotential(person, talent, WORLD_DATE, stream, {
        tunables,
        library: BASE_LIBRARY,
      });
      expect(DevelopmentSchema.safeParse(result.value).success).toBe(true);
      expect(Number.isInteger(result.value.potential)).toBe(true);
      expect(result.value.potential).toBeGreaterThanOrEqual(POTENTIAL_MIN);
      expect(result.value.potential).toBeLessThanOrEqual(POTENTIAL_MAX);
      const keys = ceilingKeysFor(person, BASE_LIBRARY);
      expect(Object.keys(result.value.ceilings).sort()).toEqual([...keys].sort());
      for (const key of keys) {
        const ceiling = result.value.ceilings[key];
        expect(ceiling).toBeGreaterThanOrEqual(person.attributes[key]);
        expect(ceiling).toBeLessThanOrEqual(100);
      }
    }
  });

  it('gives young people clearly more room than veterans, and nobody past the zero age any', () => {
    const stream = streamFor('young-and-old');
    const roomAt = (age: number): number => {
      let total = 0;
      for (let index = 0; index < 200; index++) {
        const result = seed(
          personAged(age),
          0,
          { 'worldgen.potential.lateBloomerChance': 0 },
          stream,
        );
        total += (result.value.ceilings.ringwork ?? 0) - 50;
      }
      return total / 200;
    };
    expect(roomAt(20)).toBeGreaterThan(20);
    expect(roomAt(30)).toBeLessThan(roomAt(20) / 2);
    expect(roomAt(36)).toBe(0);
  });

  // Slow suite only (owner, 2026-11-14: no long-running tests outside the end-of-sprint run).
  it.runIf(SLOW_TESTS)('moves the potential number smoothly with age, day by day', () => {
    const noBloomers = { 'worldgen.potential.lateBloomerChance': 0 };
    const stream = streamFor('smooth');
    let previous: number | undefined;
    // Born the same day, seen every third day for 25 years from age 16.
    const birthDate = parseGameDate('1990-03-15');
    for (let day = 0; day < 25 * 365; day += 3) {
      const worldDate = addDays(parseGameDate('2006-03-15'), day);
      const person = personAged(16, { birthDate });
      const result = seed(person, 0.5, noBloomers, stream, worldDate);
      if (previous !== undefined) {
        expect(Math.abs(result.value.potential - previous)).toBeLessThanOrEqual(3);
      }
      previous = result.value.potential;
    }
  });

  it('measures age at the world date it is given', () => {
    // Born 2000-06-01: 30 on 2030-06-01, 29 the day before. Late bloomers are 25-33, so the same
    // person counts as one on 2034-05-31 (33) and not on 2034-06-01 (34).
    const person = personAged(30, { birthDate: parseGameDate('2000-06-01') });
    const ageOn = (date: string): number => {
      const result = seed(person, 0, {}, streamFor('age'), parseGameDate(date));
      const ageNode = result.trace.children?.find((node) => node.label === 'Age');
      return Number(ageNode?.value);
    };
    expect(ageOn('2030-06-01')).toBe(30);
    expect(Math.floor(ageOn('2030-05-31'))).toBe(29);
    expect(ageOn('2030-05-31')).toBeGreaterThan(29.99);

    const always = { 'worldgen.potential.lateBloomerChance': 1 };
    const at33 = seed(person, 0, always, streamFor('bloom'), parseGameDate('2034-05-31'));
    const at34 = seed(person, 0, always, streamFor('bloom'), parseGameDate('2034-06-01'));
    expect(isLateBloomer(at33)).toBe(true);
    expect(isLateBloomer(at34)).toBe(false);
  });

  it.runIf(SLOW_TESTS)(
    'has no late bloomers when the chance is 0, and every 25-33-year-old is one at 1',
    () => {
      const stream = streamFor('bloomers');
      for (let index = 0; index < 1_000; index++) {
        const age = 20 + (index % 20);
        const person = personAged(age);
        expect(
          isLateBloomer(seed(person, 0, { 'worldgen.potential.lateBloomerChance': 0 }, stream)),
        ).toBe(false);
        const certain = seed(person, 0, { 'worldgen.potential.lateBloomerChance': 1 }, stream);
        expect(isLateBloomer(certain)).toBe(age >= 25 && age <= 33);
      }
    },
  );

  it('counts a late bloomer as younger, so they get more room', () => {
    const person = personAged(29);
    const normal = seed(person, 0, {
      'worldgen.potential.lateBloomerChance': 0,
      'worldgen.potential.headroomNoiseSd': 0,
    });
    const bloomer = seed(person, 0, {
      'worldgen.potential.lateBloomerChance': 1,
      'worldgen.potential.headroomNoiseSd': 0,
    });
    expect(bloomer.value.potential).toBeGreaterThan(normal.value.potential);
    expect(bloomer.value.ceilings.ringwork).toBeGreaterThan(normal.value.ceilings.ringwork ?? 0);
  });

  it('with no room at 18 every ceiling equals today and nothing divides by zero', () => {
    const stream = streamFor('zero-room');
    for (let index = 0; index < 500; index++) {
      const person = personAged(16 + (index % 30), { attributes: flatAttributes(index % 101) });
      const talent = ((index % 9) - 4) / 2;
      const result = seed(person, talent, { 'worldgen.potential.headroomAt18': 0 }, stream);
      for (const key of ceilingKeysFor(person, BASE_LIBRARY)) {
        expect(result.value.ceilings[key]).toBe(person.attributes[key]);
      }
      expect(Number.isFinite(result.value.potential)).toBe(true);
      expect(result.value.potential).toBe(
        Math.round(Math.min(1000, Math.max(-1000, 200 * talent))),
      );
    }
  });

  it('ignores talent in the potential number when its scale is 0', () => {
    const person = personAged(22);
    const low = seed(person, -2, { 'worldgen.potential.talentScale': 0 });
    const high = seed(person, 2, { 'worldgen.potential.talentScale': 0 });
    expect(low.value.potential).toBe(high.value.potential);
  });

  it('is deterministic for a stream and draws a fixed amount', () => {
    const person = personAged(23);
    const first = seed(person, 0.7, {}, streamFor('same'));
    const second = seed(person, 0.7, {}, streamFor('same'));
    expect(second).toEqual(first);
    // 1 late-bloomer roll + 2 draws per ceiling attribute, whatever comes up.
    const stream = streamFor('count');
    seed(person, 0.7, {}, stream);
    const reference = streamFor('count');
    for (let draw = 0; draw < 1 + 2 * 8; draw++) {
      reference.nextFloat();
    }
    expect(stream.nextFloat()).toBe(reference.nextFloat());
  });

  it('explains itself with replayable steps', () => {
    const result = seed(personAged(24), 1.2);
    for (const node of findTraceNodes(result.trace, 'formula')) {
      expectTraceReplays({ value: Number(node.value), trace: node });
    }
    const labels = findTraceNodes(result.trace, 'formula').map((node) => node.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Expected room to grow',
        'Ring work room to grow',
        'Ring work ceiling',
        'Potential',
      ]),
    );
    expect(findTraceNodes(result.trace, 'roll').map((node) => node.label)).toEqual(
      expect.arrayContaining(['Late bloomer', 'Ring work room-to-grow variation']),
    );
    expectSerialisable(result);
  });
});

describe('the generator runs the seeds by default', () => {
  it('gives generated people ceilings, potential, traits and popularity', () => {
    const registry = new RngRegistry('default-seeds');
    const generator = PersonGenerator.forWorld(loadBaseWorld().world, BASE_LIBRARY);
    let withTraits = 0;
    let knownAtHome = 0;
    for (let index = 0; index < 200; index++) {
      const result = generator.generate(
        { role: 'wrestler' },
        {
          personId: testId('person', index + 1),
          worldDate: WORLD_DATE,
          rng: (name) => registry.stream(name),
        },
      );
      const { person } = result.value;
      expect(Object.keys(person.development.ceilings)).toHaveLength(8);
      withTraits += person.traits.length > 0 ? 1 : 0;
      // A rookie can start unknown even at home; everyone else is known there.
      knownAtHome += person.regionalPop[person.basedInRegionId] === undefined ? 0 : 1;
    }
    expect(withTraits).toBeGreaterThan(100);
    expect(knownAtHome).toBeGreaterThan(150);
  });
});

describe('estimateTalent', () => {
  it('reads talent back from attributes, roughly', () => {
    const registry = new RngRegistry('estimate');
    const generator = PersonGenerator.forWorld(loadBaseWorld().world, BASE_LIBRARY, { hooks: {} });
    let squaredError = 0;
    const count = 400;
    for (let index = 0; index < count; index++) {
      const result = generator.generate(
        { role: 'wrestler' },
        {
          personId: testId('person', index + 1),
          worldDate: WORLD_DATE,
          rng: (name) => registry.stream(name),
        },
      );
      const estimate = estimateTalent(result.value.person, WORLD_DATE, BASE_LIBRARY);
      squaredError += (estimate.value - result.value.talent) ** 2;
      expectTraceReplays(estimate);
    }
    // The talent spread is 1; an estimate that knew nothing would have an error of about 1.
    expect(Math.sqrt(squaredError / count)).toBeLessThan(0.75);
  });

  it('counts someone with no generation role as average', () => {
    const library = { ...BASE_LIBRARY, generationRoles: {} };
    expect(estimateTalent(personAged(30), WORLD_DATE, library).value).toBe(0);
  });
});

describe('reseedPotential', () => {
  function worldWithPeople(count: number) {
    const loaded = loadBaseWorld();
    const registry = new RngRegistry('reseed-people');
    const generator = PersonGenerator.forWorld(loaded.world, BASE_LIBRARY);
    const ids: PersonId[] = [];
    const committed = loaded.world.transact('add people', (tx) => {
      for (let index = 0; index < count; index++) {
        const personId = testId('person', index + 1);
        const result = generator.generate(
          { role: index % 4 === 0 ? 'referee' : 'wrestler' },
          { personId, worldDate: WORLD_DATE, rng: (name) => registry.stream(name) },
        );
        tx.insert('people', result.value.person);
        ids.push(personId);
      }
    });
    expect(committed.ok).toBe(true);
    return { world: loaded.world, ids };
  }

  function reseed(personIds: readonly PersonId[] | undefined, seedText: string) {
    const { world, ids } = worldWithPeople(12);
    const before = new Map(world.tables.people.values().map((person) => [person.id, person]));
    const stream = new RngRegistry(seedText).stream('worldgen.people.reseed');
    const committed = world.transact('re-roll potential', (tx) =>
      reseedPotential(tx, personIds === undefined ? {} : { personIds }, stream, {
        library: BASE_LIBRARY,
      }),
    );
    if (!committed.ok) {
      throw new Error('the re-roll failed');
    }
    return { world, ids, before, results: committed.value };
  }

  it('is deterministic for a seed', () => {
    const first = reseed(undefined, 'same seed');
    const second = reseed(undefined, 'same seed');
    expect(second.world.tables.people.values()).toEqual(first.world.tables.people.values());
    expect(second.results).toEqual(first.results);
    const other = reseed(undefined, 'other seed');
    expect(other.world.tables.people.values()).not.toEqual(first.world.tables.people.values());
  });

  it('only touches the requested people, and only their development', () => {
    const { world, ids, before, results } = reseed(undefined, 'warm-up');
    expect(results.map((result) => result.personId)).toEqual(ids);
    expect(world.tables.people.size).toBe(ids.length);
    const chosen = [ids[5], ids[2]].filter((id): id is PersonId => id !== undefined);
    const partial = reseed(chosen, 'partial');
    expect(partial.results.map((result) => result.personId)).toEqual([ids[2], ids[5]]);
    // The requested people really were re-rolled: what was written is the new development.
    for (const result of partial.results) {
      expect(partial.world.tables.people.require(result.personId).development).toEqual(
        result.development.value,
      );
    }
    const changed = chosen.filter(
      (id) =>
        JSON.stringify(partial.world.tables.people.require(id).development) !==
        JSON.stringify(partial.before.get(id)?.development),
    );
    expect(changed.length).toBeGreaterThan(0);
    for (const person of partial.world.tables.people.values()) {
      const original = partial.before.get(person.id);
      if (chosen.includes(person.id)) {
        expect({ ...person, development: original?.development }).toEqual(original);
      } else {
        expect(person).toEqual(original);
      }
    }
    expect(before.size).toBe(ids.length);
  });

  it('re-rolls hand-made people too, on the current date', () => {
    const loaded = loadBaseWorld(parseGameDate('2040-01-01'));
    const person = personAged(
      21,
      { id: testId('person', 1), development: { potential: 0, ceilings: {} } },
      {
        worldDate: parseGameDate('2040-01-01'),
        region: regionNamed('Texas'),
      },
    );
    loaded.world.transact('add', (tx) => {
      tx.insert('people', person);
    });
    const stream = new RngRegistry('hand-made').stream('worldgen.people.reseed');
    loaded.world.transact('re-roll', (tx) => {
      reseedPotential(tx, {}, stream, { library: BASE_LIBRARY });
    });
    const after = loaded.world.tables.people.require(person.id);
    expect(Object.keys(after.development.ceilings)).toHaveLength(8);
    expect(after.development.potential).toBeGreaterThan(0);
  });
});
