// The name generator: weighted tables, legal names, ring names and uniqueness.
// Design: docs/design/names.md
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALL_TUNABLES,
  buildWeightedTable,
  createEngineTunables,
  findTraceNodes,
  InvalidArgumentError,
  loadWorldFromPacks,
  NameGenerator,
  NameRegistry,
  NameSpaceExhaustedError,
  normaliseName,
  packManifestSchema,
  packs,
  parseId,
  parseGameDate,
  pickFromTable,
  pickTableEntry,
  RECORD_KINDS,
  RngRegistry,
  type ContentLibrary,
  type CountryId,
  type Gender,
  type RawPack,
  type RecordKind,
  type RngStream,
  type TraceNode,
} from '@ringside/engine';
import { worldBuilder } from '../../support/world-builder';
import { testId } from '../../support/ids';
import { SLOW_TESTS } from '../../support/slow';
import { expectSerialisable } from '../../support/trace';

// The share tests draw thousands of names; under coverage on a busy CI runner they can pass 5 s.
const SAMPLING_TEST_MS = 15_000;

type NameCultureRecord = packs.NameCultureRecord;
type WeightedName = packs.WeightedName;

function packKey(value: string): packs.PackKey {
  return packs.keySchema.parse(value);
}

function packRef(value: string): packs.PackRef {
  return packs.refSchema.parse(value);
}

/** The ID the loader gave a country of the base pack. */
function countryIdOf(
  world: { meta: { contentKeys: Readonly<Record<string, Readonly<Record<string, string>>>> } },
  key: string,
): CountryId {
  return parseId('country', world.meta.contentKeys['country']?.[key]);
}

const BASE_PACK_ROOT = fileURLToPath(new URL('../../../../../content/base/', import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readBasePack(): RawPack {
  const manifest = packManifestSchema.parse(readJson(`${BASE_PACK_ROOT}pack.json`));
  const files: Partial<Record<RecordKind, unknown>> = {};
  for (const kind of RECORD_KINDS) {
    const file = manifest.files[kind];
    if (file !== undefined) {
      files[kind] = readJson(`${BASE_PACK_ROOT}${file}`);
    }
  }
  return { manifest, files };
}

function loadBase(seed = 'names-test') {
  const loaded = loadWorldFromPacks([readBasePack()], ['base'], {
    seed,
    startDate: parseGameDate('2026-01-05'),
  });
  if (!loaded.ok) {
    throw new Error(`The base pack did not load: ${JSON.stringify(loaded.issues)}`);
  }
  return loaded.value;
}

function personStream(seed: string): RngStream {
  return new RngRegistry(seed).stream('worldgen.names.person');
}

function ringStream(seed: string): RngStream {
  return new RngRegistry(seed).stream('worldgen.names.ring');
}

/** A stream that returns the given 32-bit draws in order, for exact boundary checks. */
function scriptedStream(draws: readonly number[]): RngStream {
  let index = 0;
  return {
    name: 'worldgen.names.person',
    nextUint32(): number {
      const draw = draws[index % draws.length] ?? 0;
      index += 1;
      return draw;
    },
    nextFloat(): number {
      return this.nextUint32() / 0x1_0000_0000;
    },
  };
}

const TEST_COUNTRY = testId('country', 1);
const OTHER_COUNTRY = testId('country', 2);

function names(prefix: string, count: number): WeightedName[] {
  return Array.from({ length: count }, (_, index) => [`${prefix}${String(index + 1)}`, 1]);
}

function aCulture(
  overrides: Omit<Partial<NameCultureRecord>, 'key'> & { key?: string } = {},
): NameCultureRecord {
  const { key = 'testish', ...fields } = overrides;
  return {
    label: 'Testish',
    given: { male: names('Male', 50), female: names('Female', 50), neutral: names('Neutral', 50) },
    surnames: names('Surname', 500),
    surnameStyle: 'single',
    ...fields,
    key: packKey(key),
  };
}

/** A content library with the given cultures, one country mix per country, and a few ring words. */
function aLibrary(
  cultures: readonly NameCultureRecord[],
  mixes: Readonly<Record<string, readonly { cultureKey: string; weight: number }[]>> = {
    land: [{ cultureKey: cultures[0]?.key ?? 'testish', weight: 1 }],
  },
): ContentLibrary {
  return {
    packs: [],
    nameCultures: Object.fromEntries(cultures.map((culture) => [culture.key, culture])),
    countryNameMixes: Object.fromEntries(
      Object.entries(mixes).map(([key, entries]) => [
        key,
        {
          key: packKey(key),
          countryKey: packRef(key),
          cultures: entries.map((entry) => ({
            cultureKey: packRef(entry.cultureKey),
            weight: entry.weight,
          })),
        },
      ]),
    ),
    ringNameWords: {
      words: {
        key: packKey('words'),
        adjectives: ['Iron', 'Silent', 'Wild'],
        nouns: ['Storm', 'Anchor', 'Comet'],
        nicknames: ['Hurricane', 'Ace'],
        patterns: [
          ['{given} {family}', 3],
          ['{adjective} {noun}', 5],
          ['The {noun}', 2],
          ['{given} "{nickname}" {family}', 2],
        ],
      },
    },
    generationRoles: {},
    generationStyles: {},
    bodyArchetypes: {},
    bodyModifiers: {},
    generationProfiles: {},
    traitIncidence: {},
    matchTypes: {},
    angleTypes: {},
    methods: {},
    finishes: {},
    injuryKinds: {},
  };
}

function generatorFor(
  library: ContentLibrary,
  registry = new NameRegistry(),
  overrides: Parameters<typeof createEngineTunables>[0] = {},
): NameGenerator {
  return new NameGenerator(library, registry, {
    tunables: createEngineTunables(overrides),
    countryKeys: { [TEST_COUNTRY]: 'land', [OTHER_COUNTRY]: 'sea' },
  });
}

function labelsOf(trace: TraceNode): string[] {
  return findTraceNodes(trace, 'note').map((node) => node.label);
}

// ---------------------------------------------------------------------------------------------

describe('weighted tables', () => {
  it('picks exactly in proportion to weight: B at 75% ±0.5% over 400,000 draws', () => {
    const table = buildWeightedTable([
      ['A', 1],
      ['B', 3],
    ]);
    const stream = personStream('weighted-proportion');
    let pickedB = 0;
    const draws = 400_000;
    for (let draw = 0; draw < draws; draw++) {
      if (pickFromTable(stream, table) === 'B') {
        pickedB += 1;
      }
    }
    expect(Math.abs(pickedB / draws - 0.75)).toBeLessThanOrEqual(0.005);
  });

  it('maps each whole number 1..total to the first name whose running total reaches it', () => {
    const table = buildWeightedTable([
      ['A', 1],
      ['B', 3],
      ['C', 2],
    ]);
    expect([...table.prefixSums]).toEqual([1, 4, 6]);
    expect(table.total).toBe(6);
    // intBetween(1, 6) turns draw d into 1 + (d mod 6), so draws 0..5 hit targets 1..6.
    const stream = scriptedStream([0, 1, 2, 3, 4, 5]);
    const picks = Array.from({ length: 6 }, () => pickTableEntry(stream, table));
    expect(picks.map((picked) => picked.name)).toEqual(['A', 'B', 'B', 'B', 'C', 'C']);
    expect(picks.map((picked) => picked.weight)).toEqual([1, 3, 3, 3, 2, 2]);
    expect(picks.every((picked) => picked.total === 6)).toBe(true);
  });

  it('uses one draw per pick, whatever the list length', () => {
    const shortTable = buildWeightedTable([['Only', 5]]);
    const longTable = buildWeightedTable(names('Name', 900));
    const first = personStream('draw-count');
    const second = personStream('draw-count');
    pickFromTable(first, shortTable);
    pickFromTable(second, longTable);
    expect(first.nextUint32()).toBe(second.nextUint32());
  });

  it('rejects an empty list and weights below 1 or not whole', () => {
    expect(() => buildWeightedTable([])).toThrow(InvalidArgumentError);
    expect(() => buildWeightedTable([['A', 0]])).toThrow(InvalidArgumentError);
    expect(() => buildWeightedTable([['A', 1.5]])).toThrow(InvalidArgumentError);
  });
});

describe('the name registry', () => {
  it('normalises case, accents, punctuation and spacing', () => {
    expect(normaliseName("José  O'Neil")).toBe('jose oneil');
    expect(normaliseName('Jean-Luc Ødegård')).toBe('jeanluc odegard');
    expect(NameRegistry.normalise('Łukasz Weiß')).toBe('lukasz weiss');
    const registry = new NameRegistry();
    registry.add('legal', 'José Martínez');
    expect(registry.has('legal', 'jose martinez')).toBe(true);
    expect(registry.has('ring', 'jose martinez')).toBe(false);
  });

  it('lets a holder keep their own name and refuses it to anyone else', () => {
    const registry = new NameRegistry();
    registry.add('ring', 'Iron Storm', 'per_one');
    expect(registry.isFreeFor('ring', 'Iron Storm', 'per_one')).toBe(true);
    expect(registry.isFreeFor('ring', 'Iron Storm', 'per_two')).toBe(false);
    expect(registry.isFreeFor('ring', 'Iron Storm')).toBe(false);
    registry.add('ring', 'Silent Comet');
    expect(registry.isFreeFor('ring', 'Silent Comet', 'per_one')).toBe(false);
    expect(registry.size('ring')).toBe(2);
  });

  it('is built from every legal name, default ring name and contract ring name in a world', () => {
    const { world } = worldBuilder()
      .withGeography('mini')
      .withPromotion({}, (promotion) => promotion.withRoster(3))
      .build();
    const registry = NameRegistry.fromWorld(world);
    const people = [...world.tables.people.values()];
    expect(people.length).toBeGreaterThan(0);
    for (const person of people) {
      expect(registry.has('legal', `${person.givenName} ${person.familyName}`)).toBe(true);
      expect(registry.has('ring', person.defaultRingName)).toBe(true);
    }
    for (const employment of world.tables.employments.values()) {
      expect(registry.has('ring', employment.ringName)).toBe(true);
    }
  });
});

describe('legal names from the base pack', () => {
  it('gives the same 1,000 names for the same seed', () => {
    const run = (): string[] => {
      const { world, library } = loadBase('same-seed');
      const generator = NameGenerator.forWorld(world, library);
      const stream = personStream('same-seed');
      const countries = [...world.tables.countries.values()];
      return Array.from({ length: 1000 }, (_, index) => {
        const country = countries[index % countries.length];
        if (country === undefined) {
          throw new Error('no countries');
        }
        const genders: Gender[] = ['male', 'female', 'nonBinary'];
        return generator.personName(stream, {
          countryId: country.id,
          gender: genders[index % 3] ?? 'male',
        }).value.display;
      });
    };
    const first = run();
    expect(run()).toEqual(first);
    expect(new Set(first.map(normaliseName)).size).toBe(1000);
  });

  it('keeps every given name under 3% of 20,000 names from the largest culture', () => {
    const { library } = loadBase();
    const anglo = library.nameCultures['anglo'];
    if (anglo === undefined) {
      throw new Error('no anglo culture');
    }
    const generator = generatorFor(
      aLibrary([anglo], { land: [{ cultureKey: 'anglo', weight: 1 }] }),
    );
    const stream = personStream('given-share');
    const counts = new Map<string, number>();
    const total = 20_000;
    for (let index = 0; index < total; index++) {
      const name = generator.personName(stream, {
        countryId: TEST_COUNTRY,
        gender: index % 2 === 0 ? 'male' : 'female',
      }).value;
      const given = name.givenName.replace(/ \p{Lu}\.$/u, '');
      counts.set(given, (counts.get(given) ?? 0) + 1);
    }
    const largest = Math.max(...counts.values());
    expect(largest / total).toBeLessThan(0.03);
    expect(counts.size).toBeGreaterThan(200);
  });

  it('can name 2,000 unique people from every country without running out', () => {
    const { world, library } = loadBase('every-country');
    const countries = [...world.tables.countries.values()];
    expect(countries.length).toBeGreaterThanOrEqual(40);
    const genders: Gender[] = ['male', 'female', 'male', 'female', 'nonBinary'];
    for (const country of countries) {
      const generator = NameGenerator.forWorld(world, library);
      const stream = personStream(`country-${country.id}`);
      const seen = new Set<string>();
      for (let index = 0; index < 2000; index++) {
        const name = generator.personName(stream, {
          countryId: country.id,
          gender: genders[index % genders.length] ?? 'male',
        }).value;
        seen.add(normaliseName(name.display));
      }
      expect(seen.size, `country ${country.name}`).toBe(2000);
    }
  });

  it('traces the culture with its weight and the mix total, the list used and every roll', () => {
    const { world, library } = loadBase('trace');
    const generator = NameGenerator.forWorld(world, library);
    const result = generator.personName(personStream('trace'), {
      countryId: countryIdOf(world, 'us'),
      gender: 'female',
    });
    expectSerialisable(result);
    expect(result.trace.kind).toBe('decision');
    expect(result.trace.value).toBe(result.value.display);
    const notes = labelsOf(result.trace);
    expect(
      notes.some((label) => /^Culture .+: weight \d+ of 100 in the country mix$/.test(label)),
    ).toBe(true);
    expect(notes.some((label) => /^List used: .+ (female|neutral) given names$/.test(label))).toBe(
      true,
    );
    const rolls = findTraceNodes(result.trace, 'roll').map((node) => node.roll.label);
    expect(rolls).toContain('Name culture');
    expect(rolls.some((label) => label.startsWith('Given name ('))).toBe(true);
    expect(rolls.some((label) => label.startsWith('Surname ('))).toBe(true);
    const tunables = findTraceNodes(result.trace, 'tunable').map((node) => node.key);
    expect(tunables).toEqual([
      'worldgen.names.neutralGivenShare',
      'worldgen.names.nonbinaryNeutralShare',
      'worldgen.names.mixedHeritageChance',
      'worldgen.names.maxRetries',
    ]);
  });

  it('refuses a country with no key or no name mix', () => {
    const generator = generatorFor(aLibrary([aCulture()]));
    expect(() =>
      generator.personName(personStream('no-mix'), { countryId: OTHER_COUNTRY, gender: 'male' }),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      generator.personName(personStream('no-key'), {
        countryId: testId('country', 9),
        gender: 'male',
      }),
    ).toThrow(InvalidArgumentError);
  });
});

describe('gender handling', () => {
  function listShares(gender: Gender, overrides: Parameters<typeof createEngineTunables>[0] = {}) {
    // A fresh registry per name, so no retries skew which list a name came from.
    const library = aLibrary([aCulture()]);
    const stream = personStream(`gender-${gender}`);
    const shares = { Male: 0, Female: 0, Neutral: 0 };
    const total = 20_000;
    for (let index = 0; index < total; index++) {
      const name = generatorFor(library, new NameRegistry(), overrides).personName(stream, {
        countryId: TEST_COUNTRY,
        gender,
      }).value;
      const list = /^(Male|Female|Neutral)\d+$/.exec(name.givenName)?.[1];
      if (list === 'Male' || list === 'Female' || list === 'Neutral') {
        shares[list] += 1;
      }
    }
    return {
      male: shares.Male / total,
      female: shares.Female / total,
      neutral: shares.Neutral / total,
    };
  }

  // The share sweeps (20,000 names each) run in the slow run only (support/slow.ts).
  it.runIf(SLOW_TESTS)(
    'names non-binary people from the neutral list 50% ±1% of the time, else male or female evenly',
    () => {
      const shares = listShares('nonBinary');
      expect(Math.abs(shares.neutral - 0.5)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(shares.male - 0.25)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(shares.female - 0.25)).toBeLessThanOrEqual(0.01);
    },
  );

  it.runIf(SLOW_TESTS)(
    'names men from the male list and the neutral list at the neutral share',
    () => {
      const shares = listShares('male');
      expect(shares.female).toBe(0);
      expect(Math.abs(shares.neutral - 0.05)).toBeLessThanOrEqual(0.005);
      expect(listShares('female', { 'worldgen.names.neutralGivenShare': 0 })).toEqual({
        male: 0,
        female: 1,
        neutral: 0,
      });
    },
    SAMPLING_TEST_MS,
  );

  it.runIf(SLOW_TESTS)(
    'follows the non-binary neutral share tunable, including 0 and 1',
    () => {
      expect(listShares('nonBinary', { 'worldgen.names.nonbinaryNeutralShare': 1 }).neutral).toBe(
        1,
      );
      expect(listShares('nonBinary', { 'worldgen.names.nonbinaryNeutralShare': 0 }).neutral).toBe(
        0,
      );
    },
    SAMPLING_TEST_MS,
  );

  it('falls back to the gendered lists when a culture has no neutral names', () => {
    const library = aLibrary([
      aCulture({ given: { male: names('Male', 5), female: names('Female', 5), neutral: [] } }),
    ]);
    const generator = generatorFor(library, new NameRegistry(), {
      'worldgen.names.nonbinaryNeutralShare': 1,
    });
    const result = generator.personName(personStream('no-neutral'), {
      countryId: TEST_COUNTRY,
      gender: 'nonBinary',
    });
    expect(result.value.givenName).toMatch(/^(Male|Female)\d+$/);
    expect(labelsOf(result.trace)).toContain('Testish has no neutral given names');
  });
});

describe('cultures and surnames', () => {
  it('takes the surname from a second pick of the mix at the mixed heritage chance', () => {
    const first = aCulture({ key: 'first', surnames: names('FirstSurname', 400) });
    const second = aCulture({ key: 'second', surnames: names('SecondSurname', 400) });
    const library = aLibrary([first, second], { land: [{ cultureKey: 'first', weight: 1 }] });
    // With only one culture in the mix, a second pick still lands on it.
    const sameCulture = generatorFor(library, new NameRegistry(), {
      'worldgen.names.mixedHeritageChance': 1,
    }).personName(personStream('mixed-one'), { countryId: TEST_COUNTRY, gender: 'male' });
    expect(sameCulture.value.familyName).toMatch(/^FirstSurname\d+$/);

    const twoCultures = aLibrary([first, second], {
      land: [
        { cultureKey: 'first', weight: 1 },
        { cultureKey: 'second', weight: 1 },
      ],
    });
    const stream = personStream('mixed-two');
    let mismatched = 0;
    const total = 4000;
    for (let index = 0; index < total; index++) {
      const result = generatorFor(twoCultures, new NameRegistry()).personName(stream, {
        countryId: TEST_COUNTRY,
        gender: 'male',
      });
      const notes = labelsOf(result.trace);
      if (notes.some((label) => label.startsWith('Mixed heritage'))) {
        mismatched += 1;
      }
    }
    // The default chance is 0.08.
    expect(Math.abs(mismatched / total - 0.08)).toBeLessThan(0.015);
  });

  it('gives double-surname cultures two surnames at the chance set in the record', () => {
    const always = aCulture({ surnameStyle: 'double', doubleSurnameChance: 1 });
    const never = aCulture({ surnameStyle: 'double', doubleSurnameChance: 0 });
    const stream = personStream('double');
    let doubled = 0;
    for (let index = 0; index < 200; index++) {
      const name = generatorFor(aLibrary([always])).personName(stream, {
        countryId: TEST_COUNTRY,
        gender: 'female',
      }).value;
      if (name.familyName.split(' ').length === 2) {
        doubled += 1;
      }
    }
    // A second surname equal to the first is dropped, which happens 1 time in 500 here.
    expect(doubled).toBeGreaterThanOrEqual(195);
    const single = generatorFor(aLibrary([never])).personName(stream, {
      countryId: TEST_COUNTRY,
      gender: 'female',
    }).value;
    expect(single.familyName).toMatch(/^Surname\d+$/);
  });

  it.runIf(SLOW_TESTS)(
    'gives the shipped hispanic culture two surnames about 35% of the time',
    () => {
      const { library } = loadBase();
      const hispanic = library.nameCultures['hispanic'];
      if (hispanic === undefined) {
        throw new Error('no hispanic culture');
      }
      expect(hispanic.doubleSurnameChance).toBe(0.35);
      expect(library.nameCultures['lusophone']?.doubleSurnameChance).toBe(0.35);
      // A fresh registry per name, so retries on taken names cannot favour the longer names.
      const hispanicOnly = aLibrary([hispanic], { land: [{ cultureKey: 'hispanic', weight: 1 }] });
      const surnames = new Set(hispanic.surnames.map(([surname]) => surname));
      const stream = personStream('hispanic-double');
      const total = 10_000;
      let doubled = 0;
      for (let index = 0; index < total; index++) {
        const { familyName } = generatorFor(hispanicOnly).personName(stream, {
          countryId: TEST_COUNTRY,
          gender: index % 2 === 0 ? 'male' : 'female',
        }).value;
        if (!surnames.has(familyName)) {
          doubled += 1;
        }
      }
      // A second surname equal to the first is dropped, so the rate sits just under 0.35.
      expect(Math.abs(doubled / total - 0.35)).toBeLessThanOrEqual(0.02);
    },
  );
});

describe('uniqueness', () => {
  const twoByTwo = aCulture({
    given: {
      male: [
        ['Al', 1],
        ['Bo', 1],
      ],
      female: [['Cy', 1]],
      neutral: [],
    },
    surnames: [
      ['Dee', 1],
      ['Eck', 1],
    ],
  });

  it('falls back to a middle initial when every combination of a 2×2 list is taken', () => {
    const registry = new NameRegistry();
    for (const given of ['Al', 'Bo']) {
      for (const family of ['Dee', 'Eck']) {
        registry.add('legal', `${given} ${family}`);
      }
    }
    const generator = generatorFor(aLibrary([twoByTwo]), registry);
    const result = generator.personName(personStream('two-by-two'), {
      countryId: TEST_COUNTRY,
      gender: 'male',
    });
    expect(result.value.display).toMatch(/^(Al|Bo) [A-Z]\. (Dee|Eck)$/);
    expect(result.value.givenName).toMatch(/^(Al|Bo) [A-Z]\.$/);
    const notes = labelsOf(result.trace);
    expect(
      notes.filter((label) => label.includes('is already taken, so the name is rolled again')),
    ).toHaveLength(21);
    expect(
      notes.some((label) => label.startsWith('Every roll was taken, so a middle initial')),
    ).toBe(true);
    expect(registry.has('legal', result.value.display)).toBe(true);
  });

  it('retries as many times as the tunable says before adding an initial', () => {
    const registry = new NameRegistry();
    registry.add('legal', 'Al Dee');
    registry.add('legal', 'Al Eck');
    registry.add('legal', 'Bo Dee');
    registry.add('legal', 'Bo Eck');
    const generator = generatorFor(aLibrary([twoByTwo]), registry, {
      'worldgen.names.maxRetries': 0,
    });
    const result = generator.personName(personStream('no-retries'), {
      countryId: TEST_COUNTRY,
      gender: 'male',
    });
    expect(
      labelsOf(result.trace).filter((label) => label.includes('so the name is rolled again')),
    ).toHaveLength(1);
    expect(result.value.display).toMatch(/ [A-Z]\. /);
  });

  it('throws name-space-exhausted for a 1×1 list once the name and every initial are taken', () => {
    const oneByOne = aCulture({
      given: { male: [['Al', 1]], female: [['Al', 1]], neutral: [] },
      surnames: [['Dee', 1]],
    });
    const registry = new NameRegistry();
    registry.add('legal', 'Al Dee');
    // With only the plain name taken, the generator still finds a middle initial.
    const withInitial = generatorFor(aLibrary([oneByOne]), registry).personName(
      personStream('one-by-one'),
      { countryId: TEST_COUNTRY, gender: 'male' },
    );
    expect(withInitial.value.display).toMatch(/^Al [A-Z]\. Dee$/);
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      registry.add('legal', `Al ${letter}. Dee`);
    }
    const generator = generatorFor(aLibrary([oneByOne]), registry);
    let thrown: unknown = null;
    try {
      generator.personName(personStream('one-by-one'), { countryId: TEST_COUNTRY, gender: 'male' });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NameSpaceExhaustedError);
    if (thrown instanceof NameSpaceExhaustedError) {
      expect(thrown.code).toBe('NAME_SPACE_EXHAUSTED');
      expect(thrown.details).toMatchObject({ kind: 'legal', scope: 'land' });
      expect(thrown.message).toContain('country land');
    }
  });

  it('never hands out the same legal name twice in one world', () => {
    const generator = generatorFor(aLibrary([aCulture({ surnames: names('Surname', 40) })]));
    const stream = personStream('no-repeats');
    const seen = new Set<string>();
    for (let index = 0; index < 1500; index++) {
      seen.add(
        normaliseName(
          generator.personName(stream, { countryId: TEST_COUNTRY, gender: 'female' }).value.display,
        ),
      );
    }
    expect(seen.size).toBe(1500);
  });
});

describe('ring names', () => {
  it('never repeats a ring name or takes another person’s legal name, across 2,000 names', () => {
    const { world, library } = loadBase('ring');
    const generator = NameGenerator.forWorld(world, library);
    const countries = [...world.tables.countries.values()];
    const people = Array.from({ length: 2000 }, (_, index) => {
      const country = countries[index % countries.length];
      if (country === undefined) {
        throw new Error('no countries');
      }
      return generator.personName(personStream(`ring-people-${String(index % 7)}`), {
        countryId: country.id,
        gender: index % 2 === 0 ? 'male' : 'female',
      }).value;
    });
    const legalNames = new Map(people.map((person) => [normaliseName(person.display), person]));
    const stream = ringStream('ring');
    const ringNames = new Set<string>();
    for (const person of people) {
      const result = generator.ringName(stream, { person, style: 'brawler' });
      const key = normaliseName(result.value);
      expect(ringNames.has(key)).toBe(false);
      ringNames.add(key);
      const holder = legalNames.get(key);
      expect(holder === undefined || holder === person).toBe(true);
      expect(result.value.length).toBeLessThanOrEqual(60);
    }
    expect(ringNames.size).toBe(2000);
  });

  it('traces the pattern and its words', () => {
    const generator = generatorFor(aLibrary([aCulture()]));
    const person = { givenName: 'Male1', familyName: 'Surname1' };
    const result = generator.ringName(ringStream('ring-trace'), { person, style: 'highFlyer' });
    expectSerialisable(result);
    const rolls = findTraceNodes(result.trace, 'roll').map((node) => node.roll.label);
    expect(rolls[0]).toBe('Ring name pattern');
    expect(labelsOf(result.trace).some((label) => /^Pattern .+ gives .+$/.test(label))).toBe(true);
  });

  it('gives non-wrestlers name-based ring names only', () => {
    const generator = generatorFor(aLibrary([aCulture()]));
    const stream = ringStream('non-wrestler');
    for (let index = 1; index <= 30; index++) {
      const person = { givenName: `Male${String(index)}`, familyName: `Surname${String(index)}` };
      const result = generator.ringName(stream, { person, style: 'nonWrestler' });
      expect(result.value).toMatch(/^Male\d+ Surname\d+$/);
    }
  });

  it('allows a person their own legal name but never another person’s', () => {
    const registry = new NameRegistry();
    registry.add('legal', 'Male1 Surname1', testId('person', 1));
    registry.add('legal', 'Male2 Surname2', testId('person', 2));
    registry.add('legal', 'Male3 Surname3', testId('person', 3));
    const library = aLibrary([aCulture()]);
    const withPatterns = (patterns: [string, number][]): ContentLibrary => ({
      ...library,
      ringNameWords: {
        words: {
          key: packKey('words'),
          adjectives: ['Male2'],
          nouns: ['Surname2'],
          nicknames: [],
          patterns,
        },
      },
    });
    const own = generatorFor(withPatterns([['{given} {family}', 1]]), registry).ringName(
      ringStream('own'),
      {
        person: { id: testId('person', 1), givenName: 'Male1', familyName: 'Surname1' },
        style: 'technician',
      },
    );
    expect(own.value).toBe('Male1 Surname1');
    // The only pattern spells person two's legal name, so person three falls back to their own.
    const clash = generatorFor(withPatterns([['{adjective} {noun}', 1]]), registry).ringName(
      ringStream('clash'),
      {
        person: { id: testId('person', 3), givenName: 'Male3', familyName: 'Surname3' },
        style: 'technician',
      },
    );
    expect(clash.value).toBe('Male3 Surname3');
    expect(
      labelsOf(clash.trace).filter(
        (label) => label.includes('Male2 Surname2') && label.includes('taken'),
      ),
    ).toHaveLength(21);
  });

  it('does not change the legal name sequence when ring names are generated in between', () => {
    const { world, library } = loadBase('independence');
    const countryId = countryIdOf(world, 'gb');
    const legalOnly = (): string[] => {
      const generator = NameGenerator.forWorld(world, library);
      const people = new RngRegistry('independence');
      const stream = people.stream('worldgen.names.person');
      return Array.from(
        { length: 50 },
        () => generator.personName(stream, { countryId, gender: 'male' }).value.display,
      );
    };
    const withRingNames = (): string[] => {
      const generator = NameGenerator.forWorld(world, library);
      const rng = new RngRegistry('independence');
      const people = rng.stream('worldgen.names.person');
      const rings = rng.stream('worldgen.names.ring');
      const result: string[] = [];
      for (let index = 0; index < 50; index++) {
        const name = generator.personName(people, { countryId, gender: 'male' }).value;
        result.push(name.display);
        if (index < 20) {
          for (let ring = 0; ring < 5; ring++) {
            generator.ringName(rings, { person: name, style: 'striker' });
          }
        }
      }
      return result;
    };
    expect(withRingNames()).toEqual(legalOnly());
  });
});

describe('name tunables', () => {
  it('are registered with their ranges, units and defaults', () => {
    expect(ALL_TUNABLES['worldgen.names.neutralGivenShare']).toMatchObject({
      kind: 'number',
      default: 0.05,
      min: 0,
      max: 1,
      unit: 'probability',
    });
    expect(ALL_TUNABLES['worldgen.names.nonbinaryNeutralShare']).toMatchObject({
      default: 0.5,
      min: 0,
      max: 1,
      unit: 'probability',
    });
    expect(ALL_TUNABLES['worldgen.names.mixedHeritageChance']).toMatchObject({
      default: 0.08,
      min: 0,
      max: 1,
      unit: 'probability',
    });
    expect(ALL_TUNABLES['worldgen.names.maxRetries']).toMatchObject({
      kind: 'integer',
      default: 20,
      min: 0,
      max: 200,
      unit: 'count',
    });
  });
});
