import { describe, expect, expectTypeOf, it } from 'vitest';
import { parseContentKey } from '../../../src/core/content-key';
import { parseGameDate } from '../../../src/core/date';
import { parseId, type PersonId, type RegionId } from '../../../src/core/ids';
import {
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_KEYS,
  EXCLUSIVE_TRAIT_PAIRS,
  PersonSchema,
  peopleTable,
  TRAIT_GROUPS,
  TRAIT_KEYS,
  type AttributeKey,
  type BodyPart,
  type Person,
  type TraitKey,
} from '../../../src/model/entities/person';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import { createWorld } from '../../../src/model/world';
import { stubTable } from '../../support/stub-tables';
import { toyMeta } from '../../support/toy-registry';

function body(serial: number): string {
  return String(serial).padStart(10, '0');
}

function personId(serial: number): PersonId {
  return parseId('person', `per_${body(serial)}`);
}

function regionId(serial: number): RegionId {
  return parseId('region', `reg_${body(serial)}`);
}

const date = parseGameDate;

/** A complete, valid wrestler. */
function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: personId(1),
    givenName: 'Test',
    familyName: 'Person One',
    defaultRingName: 'Test Person One',
    gender: 'female',
    birthDate: date('1995-06-15'),
    debutDate: date('2015-03-01'),
    birthRegionId: regionId(1),
    basedInRegionId: regionId(2),
    imageRef: 'placeholder:person',
    masked: false,
    tags: ['generated'],
    roles: ['wrestler'],
    status: 'active',
    career: { canOwn: false, canBook: true },
    motivation: 'legacy',
    heightCm: 170,
    weightKg: 65,
    build: 'athletic',
    style: 'technician',
    attributes: {
      ringwork: 72.5,
      psychology: 65,
      stamina: 70,
      safety: 80,
      athleticism: 68,
      mic: 40,
      charisma: 55,
      presence: 50,
      officiating: 5,
      broadcasting: 10,
      producing: 20,
      booking: 15,
    },
    condition: { head: 100, neck: 95, back: 90, arms: 100, torso: 100, legs: 85.5 },
    fatigue: 12,
    injury: null,
    restrictions: [],
    development: { potential: 250, ceilings: { ringwork: 90, mic: 60 } },
    regionalPop: { [regionId(1)]: 35, [regionId(2)]: 12.5 },
    traits: ['fastLearner', 'workhorse', 'professional'],
    vices: { alcohol: 'none', substances: 'hidden' },
    ...overrides,
  };
}

/** Parses a person built from overrides plus raw field values the type system would refuse. */
function parsePerson(overrides: Partial<Person> = {}, raw: Readonly<Record<string, unknown>> = {}) {
  return PersonSchema.safeParse({ ...makePerson(overrides), ...raw });
}

function issueMessages(result: ReturnType<typeof parsePerson>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('PersonSchema', () => {
  it('parses a complete valid person', () => {
    const person = makePerson();
    const result = PersonSchema.safeParse(person);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(person);
  });

  it('parses a non-wrestler crew member who has not debuted', () => {
    const result = parsePerson({
      roles: ['referee', 'producer'],
      style: 'nonWrestler',
      debutDate: null,
      traits: [],
      regionalPop: {},
      development: { potential: 0, ceilings: {} },
    });
    expect(result.success).toBe(true);
  });

  describe('attributes', () => {
    it.each(ATTRIBUTE_KEYS)('%s accepts 0 and 100 and rejects -0.01 and 100.01', (key) => {
      const base = makePerson().attributes;
      for (const value of [0, 100]) {
        expect(parsePerson({ attributes: { ...base, [key]: value } }).success).toBe(true);
      }
      for (const value of [-0.01, 100.01]) {
        const result = parsePerson({ attributes: { ...base, [key]: value } });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(['attributes', key]);
      }
    });

    it('rejects a missing attribute key', () => {
      const withoutBooking: Partial<Record<AttributeKey, number>> = { ...makePerson().attributes };
      delete withoutBooking.booking;
      const result = parsePerson({}, { attributes: withoutBooking });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['attributes', 'booking']);
    });

    it('rejects an unknown attribute key', () => {
      const result = parsePerson({}, { attributes: { ...makePerson().attributes, looks: 50 } });
      expect(result.success).toBe(false);
    });
  });

  describe('traits', () => {
    it('rejects fastLearner with slowLearner, naming both', () => {
      const result = parsePerson({ traits: ['fastLearner', 'slowLearner'] });
      expect(result.success).toBe(false);
      const messages = issueMessages(result).join(' ');
      expect(messages).toContain('fastLearner');
      expect(messages).toContain('slowLearner');
    });

    it.each(EXCLUSIVE_TRAIT_PAIRS)('rejects %s together with %s', (first, second) => {
      expect(parsePerson({ traits: [first, second] }).success).toBe(false);
    });

    it('accepts 8 traits and rejects 9', () => {
      const nine: TraitKey[] = [
        'fastLearner',
        'agesWell',
        'durable',
        'workhorse',
        'bigMatchPerformer',
        'generousSeller',
        'tagSpecialist',
        'leader',
        'loyal',
      ];
      expect(parsePerson({ traits: nine.slice(0, 8) }).success).toBe(true);
      expect(parsePerson({ traits: nine }).success).toBe(false);
    });

    it('rejects a duplicate trait', () => {
      const result = parsePerson({ traits: ['teacher', 'teacher'] });
      expect(result.success).toBe(false);
    });

    it('rejects a trait outside the closed list', () => {
      expect(parsePerson({}, { traits: ['hotHead'] }).success).toBe(false);
    });
  });

  describe('debut age', () => {
    it('rejects a debut at age 13', () => {
      const result = parsePerson({ birthDate: date('2000-05-10'), debutDate: date('2014-05-09') });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['debutDate']);
    });

    it('accepts a debut on the 14th birthday', () => {
      const result = parsePerson({ birthDate: date('2000-05-10'), debutDate: date('2014-05-10') });
      expect(result.success).toBe(true);
    });

    it('rejects a debut before birth', () => {
      const result = parsePerson({ birthDate: date('2000-05-10'), debutDate: date('1999-01-01') });
      expect(result.success).toBe(false);
    });
  });

  describe('roles and style', () => {
    it('rejects style nonWrestler with the wrestler role', () => {
      const result = parsePerson({ style: 'nonWrestler', roles: ['wrestler'] });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['style']);
    });

    it('rejects a ring style without a wrestling role', () => {
      const result = parsePerson({ style: 'brawler', roles: ['manager'] });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['roles']);
    });

    it('accepts an occasional wrestler who also manages', () => {
      expect(
        parsePerson({ style: 'showman', roles: ['manager', 'occasionalWrestler'] }).success,
      ).toBe(true);
    });

    it('rejects empty and duplicate roles', () => {
      expect(parsePerson({ roles: [] }).success).toBe(false);
      expect(parsePerson({ roles: ['wrestler', 'wrestler'] }).success).toBe(false);
    });
  });

  describe('regionalPop', () => {
    it('rejects an explicit 0', () => {
      const result = parsePerson({ regionalPop: { [regionId(1)]: 0 } });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['regionalPop', regionId(1)]);
    });

    it('rejects a key that is not a region ID', () => {
      const result = parsePerson({}, { regionalPop: { per_0000000001: 10 } });
      expect(result.success).toBe(false);
    });

    it('rejects values outside 0..100', () => {
      expect(parsePerson({ regionalPop: { [regionId(1)]: 100.01 } }).success).toBe(false);
    });
  });

  describe('injury and restrictions', () => {
    const injury = {
      kindKey: parseContentKey('injury.sprained-ankle'),
      bodyPart: 'legs' as BodyPart,
      since: date('2026-02-01'),
      expectedReturn: date('2026-03-01'),
      canWorkAngles: true,
    };

    it('accepts an injury that ends on or after it starts', () => {
      expect(parsePerson({ injury }).success).toBe(true);
      expect(parsePerson({ injury: { ...injury, expectedReturn: injury.since } }).success).toBe(
        true,
      );
    });

    it('rejects injury.expectedReturn before since', () => {
      const result = parsePerson({ injury: { ...injury, expectedReturn: date('2026-01-31') } });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['injury', 'expectedReturn']);
    });

    it('accepts 4 restrictions and rejects 5', () => {
      const restriction = { kind: 'rehab' as const, until: date('2026-04-01') };
      expect(
        parsePerson({ restrictions: Array.from({ length: 4 }, () => restriction) }).success,
      ).toBe(true);
      expect(
        parsePerson({ restrictions: Array.from({ length: 5 }, () => restriction) }).success,
      ).toBe(false);
    });

    it('rejects a deceased person with an injury or restrictions', () => {
      expect(parsePerson({ status: 'deceased' }).success).toBe(true);
      expect(parsePerson({ status: 'deceased', injury }).success).toBe(false);
      expect(
        parsePerson({
          status: 'deceased',
          restrictions: [{ kind: 'personalLeave', until: date('2026-04-01') }],
        }).success,
      ).toBe(false);
    });
  });

  describe('development', () => {
    it('accepts potential -1000 and rejects 1001', () => {
      expect(parsePerson({ development: { potential: -1000, ceilings: {} } }).success).toBe(true);
      expect(parsePerson({ development: { potential: 1001, ceilings: {} } }).success).toBe(false);
    });

    it('rejects a fractional potential and an out-of-range ceiling', () => {
      expect(parsePerson({ development: { potential: 10.5, ceilings: {} } }).success).toBe(false);
      expect(
        parsePerson({ development: { potential: 0, ceilings: { stamina: 101 } } }).success,
      ).toBe(false);
    });
  });

  describe('identity and physical ranges', () => {
    it('rejects an emp_ id in basedInRegionId', () => {
      const result = parsePerson({}, { basedInRegionId: 'emp_0000000001' });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['basedInRegionId']);
    });

    it('accepts an empty family name and rejects an empty given name', () => {
      expect(parsePerson({ familyName: '' }).success).toBe(true);
      expect(parsePerson({ givenName: '' }).success).toBe(false);
    });

    it('enforces whole-number height and weight ranges', () => {
      expect(parsePerson({ heightCm: 140, weightKg: 250 }).success).toBe(true);
      expect(parsePerson({ heightCm: 139 }).success).toBe(false);
      expect(parsePerson({ weightKg: 251 }).success).toBe(false);
      expect(parsePerson({ heightCm: 180.5 }).success).toBe(false);
    });

    it('limits tags to 10 of 1-24 characters', () => {
      expect(parsePerson({ tags: Array.from({ length: 10 }, () => 'tag') }).success).toBe(true);
      expect(parsePerson({ tags: Array.from({ length: 11 }, () => 'tag') }).success).toBe(false);
      expect(parsePerson({ tags: [''] }).success).toBe(false);
      expect(parsePerson({ tags: ['x'.repeat(25)] }).success).toBe(false);
    });

    it('rejects unknown fields', () => {
      expect(parsePerson({}, { push: 50 }).success).toBe(false);
    });
  });
});

describe('exported data', () => {
  it('lists 12 attributes, each in exactly one group', () => {
    expect(ATTRIBUTE_KEYS).toHaveLength(12);
    expect(Object.values(ATTRIBUTE_GROUPS).flat()).toEqual([...ATTRIBUTE_KEYS]);
  });

  it('lists every trait once, and every exclusive pair uses listed traits', () => {
    expect(new Set(TRAIT_KEYS).size).toBe(TRAIT_KEYS.length);
    expect(TRAIT_KEYS).toEqual(Object.values(TRAIT_GROUPS).flat());
    const paired = EXCLUSIVE_TRAIT_PAIRS.flat();
    expect(new Set(paired).size).toBe(paired.length);
    for (const trait of paired) {
      expect(TRAIT_KEYS).toContain(trait);
    }
  });

  it('infers precise field types', () => {
    expectTypeOf<Person['attributes']>().toEqualTypeOf<Record<AttributeKey, number>>();
    expectTypeOf<Person['condition']>().toEqualTypeOf<Record<BodyPart, number>>();
    expectTypeOf<Person['regionalPop']>().toEqualTypeOf<Record<RegionId, number>>();
    expectTypeOf<Person['traits']>().toEqualTypeOf<TraitKey[]>();
    expectTypeOf<Person['development']['ceilings']>().toEqualTypeOf<
      Partial<Record<AttributeKey, number>>
    >();
  });
});

describe('people table', () => {
  const registry = { people: peopleTable, regions: stubTable('region', 'regions') } as const;

  function worldWith(people: readonly Person[], regionSerials: readonly number[]) {
    const world = createWorld(registry, toyMeta());
    for (const serial of regionSerials) {
      world.tables.regions._put({ id: regionId(serial) });
    }
    for (const person of people) {
      world.tables.people._put(person);
    }
    return world;
  }

  it('is registered in TABLES under its name', () => {
    expect(TABLES.people).toBe(peopleTable);
    expect(peopleTable.name).toBe('people');
  });

  it('passes checkWorld when every region exists', () => {
    const report = checkWorld(worldWith([makePerson()], [1, 2]), registry, { validateRows: true });
    expect(report).toEqual({ ok: true, issues: [], truncated: 0 });
  });

  it('reports a regionalPop key that names a missing region', () => {
    const missing = regionId(99);
    const person = makePerson({ regionalPop: { [regionId(1)]: 20, [missing]: 5 } });
    const report = checkWorld(worldWith([person], [1, 2]), registry);
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'ref.dangling',
        table: 'people',
        id: personId(1),
        path: `regionalPop{${missing}}`,
        target: 'region',
        missingId: missing,
      }),
    ]);
  });

  it('reports missing birth and based-in regions', () => {
    const report = checkWorld(worldWith([makePerson({ regionalPop: {} })], []), registry);
    expect(report.issues.map((issue) => issue.path)).toEqual(['birthRegionId', 'basedInRegionId']);
  });

  it('indexes people by status, by each role and by based-in region', () => {
    const wrestler = makePerson();
    const referee = makePerson({
      id: personId(2),
      roles: ['referee', 'occasionalWrestler'],
      style: 'brawler',
      status: 'semiRetired',
      basedInRegionId: regionId(1),
    });
    const world = worldWith([wrestler, referee], [1, 2]);
    const people = world.tables.people;
    expect(people.lookup('byStatus', 'active').map((row) => row.id)).toEqual([personId(1)]);
    expect(people.lookup('byRole', 'referee').map((row) => row.id)).toEqual([personId(2)]);
    expect(people.lookup('byRole', 'occasionalWrestler').map((row) => row.id)).toEqual([
      personId(2),
    ]);
    expect(people.lookup('byBasedInRegion', regionId(2)).map((row) => row.id)).toEqual([
      personId(1),
    ]);
  });
});
