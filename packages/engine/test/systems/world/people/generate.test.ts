// The people generator: spec, profiles, correlated attributes, bodies, dates, streams and seeds.
// Design: docs/design/world-generation.md#generating-people
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  ageInYears,
  ATTRIBUTE_KEYS,
  BODY_PARTS,
  CAREER_STAGES,
  createEngineTunables,
  findTraceNodes,
  GenerationContentError,
  generatePerson,
  geographyOf,
  isAfter,
  loadWorldFromPacks,
  NameGenerator,
  packManifestSchema,
  packs,
  parseGameDate,
  PERSON_ROLES,
  PersonGenerator,
  PersonSchema,
  RECORD_KINDS,
  RING_STYLES,
  RngRegistry,
  type AttributeKey,
  type CareerStage,
  type ContentLibrary,
  type GameDate,
  type GenerateSpec,
  type GeneratedPerson,
  type PersonRole,
  type PersonSeedHooks,
  type RawPack,
  type RecordKind,
  type Traced,
  type TraceNode,
} from '@ringside/engine';
import { birthdayAt, rollDebut } from '../../../../src/systems/world/people/dates';
import { measureBestAgainstReference } from '../../../support/cpu-budget';
import { testId } from '../../../support/ids';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const BASE_PACK_ROOT = fileURLToPath(new URL('../../../../../../content/base/', import.meta.url));

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

const WORLD_DATE = parseGameDate('2026-01-05');

function loadBase() {
  const loaded = loadWorldFromPacks([readBasePack()], ['base'], {
    seed: 'people-test',
    startDate: WORLD_DATE,
  });
  if (!loaded.ok) {
    throw new Error(`The base pack did not load: ${JSON.stringify(loaded.issues)}`);
  }
  return loaded.value;
}

const BASE = loadBase();
const BASE_LIBRARY = BASE.library;
const GEOGRAPHY = geographyOf(BASE.world);

type TunableOverrides = Parameters<typeof createEngineTunables>[0];

interface RunOptions {
  readonly library?: ContentLibrary;
  readonly tunables?: TunableOverrides;
  readonly seed?: string;
  readonly worldDate?: GameDate;
  readonly hooks?: PersonSeedHooks;
}

/** Generates `count` people from one fresh RNG and name registry, so a run is repeatable. */
function generateMany(
  count: number,
  spec: GenerateSpec | ((index: number) => GenerateSpec),
  options: RunOptions = {},
): Traced<GeneratedPerson>[] {
  const library = options.library ?? BASE_LIBRARY;
  const tunables = createEngineTunables(options.tunables ?? {});
  const registry = new RngRegistry(options.seed ?? 'people');
  const generator = new PersonGenerator({
    library,
    geography: GEOGRAPHY,
    names: NameGenerator.forWorld(BASE.world, library, tunables),
    tunables,
    ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
  });
  const results: Traced<GeneratedPerson>[] = [];
  for (let index = 0; index < count; index++) {
    results.push(
      generator.generate(typeof spec === 'function' ? spec(index) : spec, {
        personId: testId('person', index + 1),
        worldDate: options.worldDate ?? WORLD_DATE,
        rng: (name) => registry.stream(name),
      }),
    );
  }
  return results;
}

/** The base library with every style and body modifier switched off, to test the bare formula. */
function neutralLibrary(base: ContentLibrary = BASE_LIBRARY): ContentLibrary {
  return {
    ...base,
    generationStyles: Object.fromEntries(
      Object.entries(base.generationStyles).map(([key, record]) => [
        key,
        { ...record, attributeModifiers: {} },
      ]),
    ),
    bodyModifiers: {},
  };
}

/** A library whose established wrestler profile is replaced by `attributes`. */
function libraryWithEstablishedWrestler(
  base: ContentLibrary,
  attributes: Readonly<Record<AttributeKey, packs.AttributeDistribution>>,
): ContentLibrary {
  const profiles = Object.fromEntries(
    Object.entries(base.generationProfiles).map(([key, profile]) => [
      key,
      profile.role === 'wrestler' && profile.stage === 'established'
        ? { ...profile, attributes }
        : profile,
    ]),
  );
  return { ...base, generationProfiles: profiles };
}

function profileFor(role: PersonRole, stage: CareerStage): packs.GenerationProfileRecord {
  const found = Object.values(BASE_LIBRARY.generationProfiles).find(
    (profile) => profile.role === role && profile.stage === stage,
  );
  if (found === undefined) {
    throw new Error(`No ${role} ${stage} profile in the base pack`);
  }
  return found;
}

function roleRecord(role: PersonRole): packs.GenerationRoleRecord {
  const found = Object.values(BASE_LIBRARY.generationRoles).find((record) => record.role === role);
  if (found === undefined) {
    throw new Error(`No ${role} role in the base pack`);
  }
  return found;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function correlation(left: readonly number[], right: readonly number[]): number {
  const leftMean = mean(left);
  const rightMean = mean(right);
  let covariance = 0;
  left.forEach((value, index) => {
    covariance += (value - leftMean) * ((right[index] ?? 0) - rightMean);
  });
  return covariance / left.length / (standardDeviation(left) * standardDeviation(right));
}

/** The standard normal CDF (Abramowitz and Stegun 7.1.26, error below 1.5e-7). */
function normalCdf(value: number): number {
  const scaled = Math.abs(value) / Math.SQRT2;
  const step = 1 / (1 + 0.3275911 * scaled);
  const poly =
    step *
    (0.254829592 +
      step * (-0.284496736 + step * (1.421413741 + step * (-1.453152027 + step * 1.061405429))));
  const erf = 1 - poly * Math.exp(-scaled * scaled);
  return value >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Mean and SD of `round(clamp(N(mean, sd), 0, 100))`, worked out exactly from the CDF. */
function clampedMoments(average: number, spread: number): { mean: number; sd: number } {
  const cdf = (value: number): number => normalCdf((value - average) / spread);
  let first = 0;
  let second = 0;
  for (let value = 0; value <= 100; value++) {
    const lower = value === 0 ? 0 : cdf(value - 0.5);
    const upper = value === 100 ? 1 : cdf(value + 0.5);
    const probability = upper - lower;
    first += value * probability;
    second += value * value * probability;
  }
  return { mean: first, sd: Math.sqrt(second - first * first) };
}

function decisionChosen(result: Traced<GeneratedPerson>, label: string): string | boolean {
  const node = findTraceNodes(result.trace, 'decision').find((found) => found.label === label);
  if (node === undefined) {
    throw new Error(`No ${label} decision in the trace`);
  }
  return node.chosen;
}

function archetypeOf(result: Traced<GeneratedPerson>): packs.BodyArchetypeRecord {
  const label = decisionChosen(result, 'Body type');
  const found = Object.values(BASE_LIBRARY.bodyArchetypes).find(
    (archetype) => archetype.label === label,
  );
  if (found === undefined) {
    throw new Error(`No archetype labelled ${String(label)}`);
  }
  return found;
}

function variationRolls(result: Traced<GeneratedPerson>): (string | number | boolean)[] {
  return findTraceNodes(result.trace, 'roll')
    .filter((node) => node.roll.stream === 'worldgen.people.attributes')
    .map((node) => node.roll.result);
}

const ESTABLISHED_WRESTLER: GenerateSpec = { role: 'wrestler', careerStage: 'established' };
const NO_STANDOUTS: TunableOverrides = { 'worldgen.people.standoutChance': 0 };

/** Sampling tests generate thousands of people; give them room on a busy machine. */
vi.setConfig({ testTimeout: 60_000 });

/** 5,000 wrestlers of every stage from the shipped data, shared by the sampling tests. */
const WRESTLERS = generateMany(5_000, { role: 'wrestler' }, { seed: 'wrestlers' });

// ---------------------------------------------------------------------------------------------

describe('the base pack generation records', () => {
  it('has a role and a profile for every role at every career stage', () => {
    for (const role of PERSON_ROLES) {
      expect(roleRecord(role).role).toBe(role);
      for (const stage of CAREER_STAGES) {
        expect(profileFor(role, stage).attributes).toBeDefined();
      }
    }
  });

  it('has a style record for every ring style and an archetype that suits each one', () => {
    const styles = Object.values(BASE_LIBRARY.generationStyles).map((record) => record.style);
    expect([...styles].sort()).toEqual([...RING_STYLES].sort());
    const archetypes = Object.values(BASE_LIBRARY.bodyArchetypes);
    expect(archetypes.length).toBeGreaterThanOrEqual(14);
    for (const style of RING_STYLES) {
      expect(
        archetypes.some((archetype) => archetype.styleWeights[style] > 0),
        style,
      ).toBe(true);
    }
  });

  it('uses the default stage ages and gender shares for wrestlers', () => {
    const wrestler = roleRecord('wrestler');
    expect(wrestler.stageAges).toEqual({
      rookie: { min: 18, max: 24 },
      prospect: { min: 21, max: 28 },
      established: { min: 26, max: 36 },
      veteran: { min: 33, max: 45 },
      legend: { min: 40, max: 58 },
    });
    expect(wrestler.genderShares).toEqual({ male: 0.68, female: 0.3, nonBinary: 0.02 });
  });

  it('rejects a profile with an unknown attribute when the pack loads', () => {
    const profile = profileFor('wrestler', 'rookie');
    const result = packs.recordSchemas.generationProfile.safeParse({
      ...profile,
      attributes: { ...profile.attributes, strength: { mean: 50, sd: 10, talentWeight: 0.5 } },
    });
    expect(result.success).toBe(false);
  });
});

describe('generatePerson', () => {
  it('gives the same people for the same seed and spec', () => {
    const first = generateMany(25, (index) => ({ role: PERSON_ROLES[index % 7] ?? 'wrestler' }));
    const second = generateMany(25, (index) => ({ role: PERSON_ROLES[index % 7] ?? 'wrestler' }));
    expect(second).toEqual(first);
    const other = generateMany(25, { role: 'wrestler' }, { seed: 'another seed' });
    expect(other.map((result) => result.value.person.attributes)).not.toEqual(
      first.map((result) => result.value.person.attributes),
    );
  });

  it('builds people of every role that parse, with the role rules applied', () => {
    for (const role of PERSON_ROLES) {
      // No seeds, so the seeded fields keep their neutral values.
      for (const result of generateMany(60, { role }, { seed: `roles-${role}`, hooks: {} })) {
        const { person } = result.value;
        expect(PersonSchema.safeParse(person).success).toBe(true);
        expect(person.roles).toEqual([role]);
        const record = roleRecord(role);
        if (record.performer) {
          expect(person.style).not.toBe('nonWrestler');
        } else {
          expect(person.style).toBe('nonWrestler');
        }
        expect(person.debutDate === null).toBe(record.debut === null);
        expect(person).toMatchObject({
          status: 'active',
          fatigue: 0,
          injury: null,
          restrictions: [],
          imageRef: null,
          tags: ['generated'],
          vices: { alcohol: 'none', substances: 'none' },
          development: { potential: 0, ceilings: {} },
          regionalPop: {},
          traits: [],
        });
        expect(person.career.canOwn).toBe(false);
        expect(person.career.canBook).toBe(person.attributes.booking >= 60);
        expect(person.defaultRingName).toBe(
          person.familyName === '' ? person.givenName : `${person.givenName} ${person.familyName}`,
        );
        expect(person.birthRegionId).toBe(person.basedInRegionId);
      }
    }
  });

  it('keeps every attribute and body part a whole number from 0 to 100', () => {
    for (const result of generateMany(1_000, (index) => ({
      role: PERSON_ROLES[index % 7] ?? 'wrestler',
    }))) {
      const { person } = result.value;
      for (const key of ATTRIBUTE_KEYS) {
        const value = person.attributes[key];
        expect(Number.isInteger(value) && value >= 0 && value <= 100, key).toBe(true);
      }
      for (const part of BODY_PARTS) {
        const value = person.condition[part];
        expect(Number.isInteger(value) && value >= 55 && value <= 100, part).toBe(true);
      }
      expect(Number.isInteger(person.heightCm) && Number.isInteger(person.weightKg)).toBe(true);
    }
  });

  it('honours the spec: stage, gender, region, country, continent, style, archetype, overrides', () => {
    const region = GEOGRAPHY.regions[3];
    const country = GEOGRAPHY.countries[5];
    const continent = GEOGRAPHY.continents[1];
    if (region === undefined || country === undefined || continent === undefined) {
      throw new Error('The base map is too small');
    }
    const [inRegion] = generateMany(1, { role: 'wrestler', regionId: region.id, gender: 'female' });
    expect(inRegion?.value.person).toMatchObject({
      birthRegionId: region.id,
      basedInRegionId: region.id,
      gender: 'female',
    });
    for (const result of generateMany(30, { role: 'referee', countryId: country.id })) {
      expect(GEOGRAPHY.countryOf(result.value.person.birthRegionId).id).toBe(country.id);
    }
    for (const result of generateMany(30, { role: 'announcer', continentId: continent.id })) {
      expect(GEOGRAPHY.continentOf(result.value.person.birthRegionId).id).toBe(continent.id);
    }
    const [styled] = generateMany(1, {
      role: 'wrestler',
      careerStage: 'veteran',
      style: 'grappler',
      archetype: 'super-heavy-giant',
      attributeOverrides: { charisma: 99.6, mic: -4 },
    });
    expect(styled?.value.person).toMatchObject({ style: 'grappler', build: 'superHeavy' });
    expect(styled?.value.person.attributes.charisma).toBe(100);
    expect(styled?.value.person.attributes.mic).toBe(0);
    expect(styled === undefined ? null : decisionChosen(styled, 'Career stage')).toBe('veteran');
  });

  it('refuses specs the role or the library cannot satisfy', () => {
    expect(() => generateMany(1, { role: 'referee', style: 'brawler' })).toThrow(
      GenerationContentError,
    );
    expect(() => generateMany(1, { role: 'wrestler', style: 'nonWrestler' })).toThrow(
      GenerationContentError,
    );
    expect(() => generateMany(1, { role: 'wrestler', archetype: 'no-such-body' })).toThrow(
      GenerationContentError,
    );
    const noRoles: ContentLibrary = { ...BASE_LIBRARY, generationRoles: {} };
    expect(() => generateMany(1, { role: 'wrestler' }, { library: noRoles })).toThrow(
      /no generation role for wrestler/,
    );
  });

  it('measures ages at the world date and keeps them inside the stage range', () => {
    const worldDate = parseGameDate('2031-02-28');
    for (const stage of CAREER_STAGES) {
      const range = roleRecord('wrestler').stageAges[stage];
      for (const result of generateMany(
        300,
        { role: 'wrestler', careerStage: stage },
        { worldDate, seed: `ages-${stage}` },
      )) {
        const { person } = result.value;
        const age = ageInYears(person.birthDate, worldDate);
        expect(age).toBeGreaterThanOrEqual(range.min);
        expect(age).toBeLessThanOrEqual(range.max);
        const ageNode = findTraceNodes(result.trace, 'formula').find(
          (node) => node.label === 'Age',
        );
        expect(ageNode?.value).toBe(age);
      }
    }
  });

  it('never debuts before 17 or after the world date', () => {
    const worldDate = parseGameDate('2028-02-29');
    for (const result of generateMany(1_000, { role: 'wrestler' }, { worldDate })) {
      const { person } = result.value;
      const debutDate = person.debutDate;
      expect(debutDate).not.toBeNull();
      if (debutDate === null) {
        continue;
      }
      expect(ageInYears(person.birthDate, debutDate)).toBeGreaterThanOrEqual(17);
      expect(isAfter(debutDate, worldDate)).toBe(false);
    }
  });

  it('never debuts a leap-day baby before the drawn debut age', () => {
    const birthDate = parseGameDate('2000-02-29');
    expect(birthdayAt(birthDate, 17)).toBe('2017-03-01');
    expect(birthdayAt(birthDate, 20)).toBe('2020-02-29');
    expect(birthdayAt(parseGameDate('2001-06-15'), 17)).toBe('2018-06-15');
    const registry = new RngRegistry('leap-day');
    const debut = rollDebut(
      registry.stream('worldgen.people.identity'),
      { ageSd: 0, minAge: 17, maxAge: 17 },
      createEngineTunables(),
      26,
      birthDate,
      parseGameDate('2026-06-01'),
    );
    expect(debut.value.debutDate).toBe('2017-03-01');
    expect(ageInYears(birthDate, debut.value.debutDate)).toBe(17);
  });

  it('matches the role gender shares within 1.5 percentage points', () => {
    const results = WRESTLERS;
    const shares = roleRecord('wrestler').genderShares;
    for (const gender of ['male', 'female', 'nonBinary'] as const) {
      const count = results.filter((result) => result.value.person.gender === gender).length;
      expect(Math.abs(count / results.length - shares[gender]), gender).toBeLessThanOrEqual(0.015);
    }
  });
});

describe('attribute distributions', () => {
  const established = generateMany(5_000, ESTABLISHED_WRESTLER, {
    library: neutralLibrary(),
    seed: 'established',
  });
  const profile = profileFor('wrestler', 'established');

  it('hits each profile mean within 2 and its clamped spread within 2', () => {
    for (const key of ATTRIBUTE_KEYS) {
      const values = established.map((result) => result.value.person.attributes[key]);
      const { mean: profileMean, sd: profileSd } = profile.attributes[key];
      const expected = clampedMoments(profileMean, profileSd);
      expect(Math.abs(mean(values) - profileMean), `${key} mean`).toBeLessThanOrEqual(2);
      expect(Math.abs(standardDeviation(values) - expected.sd), `${key} sd`).toBeLessThanOrEqual(2);
    }
  });

  it('makes rookies at least 15 points worse at psychology than veterans', () => {
    const psychologyOf = (stage: CareerStage): number =>
      mean(
        generateMany(
          1_000,
          { role: 'wrestler', careerStage: stage },
          { seed: `psych-${stage}` },
        ).map((result) => result.value.person.attributes.psychology),
      );
    expect(psychologyOf('veteran') - psychologyOf('rookie')).toBeGreaterThanOrEqual(15);
  });

  it('correlates attributes through talent: 0.6 × 0.6 gives 0.36, 0 gives 0', () => {
    const attributesWith = (
      talentWeight: number,
    ): Record<AttributeKey, packs.AttributeDistribution> => {
      const attributes = { ...profile.attributes };
      for (const key of ATTRIBUTE_KEYS) {
        attributes[key] = { mean: 50, sd: 10, talentWeight };
      }
      return attributes;
    };
    const run = (talentWeight: number): number => {
      const library = libraryWithEstablishedWrestler(
        neutralLibrary(),
        attributesWith(talentWeight),
      );
      const people = generateMany(5_000, ESTABLISHED_WRESTLER, {
        library,
        tunables: NO_STANDOUTS,
        seed: `correlation-${String(talentWeight)}`,
      });
      return correlation(
        people.map((result) => result.value.person.attributes.ringwork),
        people.map((result) => result.value.person.attributes.psychology),
      );
    };
    expect(Math.abs(run(0.6) - 0.36)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(run(0))).toBeLessThanOrEqual(0.05);
  });

  it('puts a hand-picked star of talent 2.5 at least 1.5 sd above the profile mean', () => {
    const stars = generateMany(
      5_000,
      { ...ESTABLISHED_WRESTLER, talent: 2.5 },
      {
        library: neutralLibrary(),
        seed: 'stars',
      },
    );
    const strongKeys = ATTRIBUTE_KEYS.filter((key) => profile.attributes[key].talentWeight >= 0.6);
    expect(strongKeys.length).toBeGreaterThanOrEqual(2);
    for (const key of strongKeys) {
      const { mean: profileMean, sd } = profile.attributes[key];
      const values = stars.map((result) => result.value.person.attributes[key]);
      expect(mean(values), key).toBeGreaterThanOrEqual(profileMean + 1.5 * sd);
    }
    expect(stars.every((result) => result.value.talent === 2.5)).toBe(true);
  });

  it('gives natural standouts at about the tunable rate, and none to non-wrestlers', () => {
    const standouts = (role: PersonRole, count: number, chance: number): number =>
      generateMany(
        count,
        { role },
        {
          tunables: { 'worldgen.people.standoutChance': chance },
          seed: `standouts-${role}`,
        },
      ).filter((result) =>
        findTraceNodes(result.trace, 'add').some((node) => node.label === 'Natural standout'),
      ).length;
    const wrestlerStandouts = standouts('wrestler', 2_000, 0.2);
    expect(wrestlerStandouts).toBeGreaterThan(330);
    expect(wrestlerStandouts).toBeLessThan(470);
    expect(standouts('referee', 300, 1)).toBe(0);
  });
});

describe('bodies', () => {
  const wrestlers = WRESTLERS;

  it('never pairs a style with an archetype whose weight for it is 0', () => {
    for (const result of wrestlers) {
      const archetype = archetypeOf(result);
      expect(archetype.styleWeights[result.value.person.style], archetype.key).toBeGreaterThan(0);
      expect(result.value.person.build).toBe(archetype.build);
    }
  });

  it('keeps height and weight inside the archetype ranges, scaled for women', () => {
    for (const result of wrestlers) {
      const { person } = result.value;
      const archetype = archetypeOf(result);
      const scale =
        person.gender === 'male' ? { heightCm: 1, weightKg: 1 } : archetype.scale[person.gender];
      expect(person.heightCm).toBeGreaterThanOrEqual(
        Math.max(140, Math.round(archetype.heightCm.min * scale.heightCm)),
      );
      expect(person.heightCm).toBeLessThanOrEqual(
        Math.min(230, Math.round(archetype.heightCm.max * scale.heightCm)),
      );
      expect(person.weightKg).toBeGreaterThanOrEqual(
        Math.max(40, Math.round(archetype.weightKg.min * scale.weightKg)),
      );
      expect(person.weightKg).toBeLessThanOrEqual(
        Math.min(250, Math.round(archetype.weightKg.max * scale.weightKg)),
      );
    }
  });

  it('gives wrestlers over 130 kg less stamina than wrestlers under 90 kg', () => {
    const staminaOf = (keep: (weightKg: number) => boolean): number[] =>
      wrestlers
        .filter((result) => keep(result.value.person.weightKg))
        .map((result) => result.value.person.attributes.stamina);
    const heavy = staminaOf((weightKg) => weightKg > 130);
    const light = staminaOf((weightKg) => weightKg < 90);
    expect(heavy.length).toBeGreaterThan(50);
    expect(light.length).toBeGreaterThan(50);
    expect(mean(heavy)).toBeLessThan(mean(light) - 3);
  });

  it('wears down experienced bodies more than fresh ones', () => {
    const conditionOf = (stage: CareerStage): number =>
      mean(
        generateMany(
          500,
          { role: 'wrestler', careerStage: stage },
          { seed: `wear-${stage}` },
        ).flatMap((result) => BODY_PARTS.map((part) => result.value.person.condition[part])),
      );
    expect(conditionOf('rookie')).toBeGreaterThan(conditionOf('legend') + 15);
  });

  it('boosts the styles that suit the home region', () => {
    const highFlyingRegion = GEOGRAPHY.regions.find(
      (region) => region.preferredStyle === 'highFlying',
    );
    if (highFlyingRegion === undefined) {
      throw new Error('The base map has no high-flying region');
    }
    const shareOfFlyers = (boost: number): number =>
      generateMany(
        1_500,
        { role: 'wrestler', regionId: highFlyingRegion.id },
        {
          tunables: { 'worldgen.people.homeStyleBoost': boost },
          seed: 'home-style',
        },
      ).filter((result) => result.value.person.style === 'highFlyer').length / 1_500;
    expect(shareOfFlyers(3)).toBeGreaterThan(shareOfFlyers(1) * 1.8);
  });
});

/** Every non-zero weight turned around (10 becomes 1, 1 becomes 10); zeros stay zero. */
function reversedWeights(
  weights: packs.BodyArchetypeRecord['styleWeights'],
): packs.BodyArchetypeRecord['styleWeights'] {
  const reversed = { ...weights };
  for (const style of RING_STYLES) {
    const weight = weights[style];
    reversed[style] = weight === 0 ? 0 : 11 - Math.min(10, weight);
  }
  return reversed;
}

describe('streams', () => {
  it('keeps attributes unchanged when the archetype weights change', () => {
    const library = neutralLibrary();
    const reweighted: ContentLibrary = {
      ...library,
      bodyArchetypes: Object.fromEntries(
        Object.entries(library.bodyArchetypes).map(([key, archetype]) => [
          key,
          {
            ...archetype,
            styleWeights: reversedWeights(archetype.styleWeights),
          },
        ]),
      ),
    };
    const before = generateMany(300, { role: 'wrestler' }, { library, seed: 'streams' });
    const after = generateMany(300, { role: 'wrestler' }, { library: reweighted, seed: 'streams' });
    expect(after.map((result) => result.value.person.attributes)).toEqual(
      before.map((result) => result.value.person.attributes),
    );
    expect(after.map((result) => result.value.talent)).toEqual(
      before.map((result) => result.value.talent),
    );
    expect(after.map((result) => result.value.person.birthDate)).toEqual(
      before.map((result) => result.value.person.birthDate),
    );
    const bodiesChanged = after.filter(
      (result, index) => archetypeOf(result).key !== archetypeOf(before[index] ?? result).key,
    );
    expect(bodiesChanged.length).toBeGreaterThan(30);
  });

  it('draws the same attribute rolls with the shipped body modifiers on', () => {
    const before = generateMany(100, { role: 'wrestler' }, { seed: 'streams-shipped' });
    const reweighted: ContentLibrary = {
      ...BASE_LIBRARY,
      bodyArchetypes: Object.fromEntries(
        Object.entries(BASE_LIBRARY.bodyArchetypes).filter(
          ([key]) => key !== 'athletic-all-rounder',
        ),
      ),
    };
    const after = generateMany(
      100,
      { role: 'wrestler' },
      {
        library: reweighted,
        seed: 'streams-shipped',
      },
    );
    expect(after.map(variationRolls)).toEqual(before.map(variationRolls));
  });
});

describe('traces and seeds', () => {
  const [sample] = generateMany(1, { role: 'wrestler', careerStage: 'veteran' }, { seed: 'trace' });
  if (sample === undefined) {
    throw new Error('No sample person');
  }

  it('explains location, gender, age, style, archetype, every attribute and the wear', () => {
    const decisions = findTraceNodes(sample.trace, 'decision').map((node) => node.label);
    expect(decisions).toEqual(
      expect.arrayContaining(['Home region', 'Gender', 'Career stage', 'Ring style', 'Body type']),
    );
    const formulas = findTraceNodes(sample.trace, 'formula').map((node) => node.label);
    expect(formulas).toEqual(
      expect.arrayContaining([
        'Age',
        'Debut age',
        'Height (cm)',
        'Weight (kg)',
        'Ring work',
        'Psychology',
        'Booking',
        'Wear on neck',
        'Legs condition',
      ]),
    );
    const ringwork = findTraceNodes(sample.trace, 'formula').find(
      (node) => node.label === 'Ring work',
    );
    const steps = (ringwork?.children ?? []).map((node: TraceNode) => `${node.kind}:${node.label}`);
    expect(steps).toEqual(
      expect.arrayContaining([
        'add:Talent',
        'roll:Ring work variation',
        'add:Personal variation',
        'clamp:Kept between 0 and 100',
        'round:Rounded',
      ]),
    );
    expectSerialisable(sample);
  });

  it('replays every attribute calculation to its value', () => {
    for (const node of findTraceNodes(sample.trace, 'formula')) {
      if (ATTRIBUTE_KEYS.some((key) => node.label.toLowerCase().startsWith(key.slice(0, 4)))) {
        expect(typeof node.value).toBe('number');
        expectTraceReplays({ value: Number(node.value), trace: node });
      }
    }
  });

  it('runs registered seeds in order with the talent, and leaves defaults without them', () => {
    const calls: string[] = [];
    const hooks: PersonSeedHooks = {
      seedTraits: (input) => {
        calls.push(`traits:${String(input.person.development.potential)}`);
        return {
          value: { ...input.person, traits: ['workhorse'] },
          trace: { kind: 'note', label: 'Traits seeded', value: null },
        };
      },
      seedPotential: (input) => {
        calls.push('potential');
        return {
          value: {
            ...input.person,
            development: { potential: Math.round(input.talent * 100), ceilings: {} },
          },
          trace: { kind: 'note', label: 'Potential seeded', value: null },
        };
      },
    };
    const [seeded] = generateMany(1, { role: 'wrestler', talent: 1.5 }, { hooks });
    expect(calls).toEqual(['potential', 'traits:150']);
    expect(seeded?.value.person.development.potential).toBe(150);
    expect(seeded?.value.person.traits).toEqual(['workhorse']);
    const notes = findTraceNodes(seeded?.trace ?? sample.trace, 'note').map((node) => node.label);
    expect(notes).toEqual(
      expect.arrayContaining(['Potential seeded', 'Traits seeded', 'No vices seeding registered']),
    );
  });

  it('works as a plain function with a context', () => {
    const registry = new RngRegistry('plain');
    const result = generatePerson(
      { role: 'producer' },
      {
        personId: testId('person', 1),
        worldDate: WORLD_DATE,
        library: BASE_LIBRARY,
        geography: GEOGRAPHY,
        names: NameGenerator.forWorld(BASE.world, BASE_LIBRARY),
        rng: (name) => registry.stream(name),
      },
    );
    expect(result.value.person.roles).toEqual(['producer']);
    expect(result.value.person.style).toBe('nonWrestler');
  });
});

/**
 * The most reference workloads (see support/cpu-budget.ts) 1,000 people may cost: the old 2 s bound
 * over the reference's 50 ms on a laptop. They cost 10 to 20, alone or under load, so a generator
 * twice as slow fails, and accidental quadratic work (which costs seconds) fails by far.
 */
const GENERATE_REFERENCE_BUDGET = 40;

describe('speed', () => {
  // A wall-clock bound failed on a busy machine, so the CPU time is compared with a reference
  // workload measured in the same process. The cheapest of three runs is kept: about one run in
  // eight pays for a major garbage collection that costs three times the work.
  it('generates 1,000 people well inside the budget', { timeout: 30_000 }, () => {
    const roles = (index: number): GenerateSpec => ({
      role: PERSON_ROLES[index % 7] ?? 'wrestler',
    });
    generateMany(200, roles, { seed: 'speed-warm-up' });
    let generated = 0;
    const timing = measureBestAgainstReference(() => {
      generated = generateMany(1_000, roles, { seed: 'speed' }).length;
    }, 3);
    expect(generated).toBe(1_000);
    expect(
      timing.ratio,
      `${timing.workMs.toFixed(0)} ms of CPU time against ${timing.referenceMs.toFixed(1)} ms for the reference`,
    ).toBeLessThan(GENERATE_REFERENCE_BUDGET);
  });
});
