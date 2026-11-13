// Starting traits and vices: incidence, exclusive pairs, the cap, minimum ages and 0 meaning 0.
// Design: docs/design/world-generation.md#traits and #vices
import { describe, expect, it } from 'vitest';
import {
  addYears,
  createEngineTunables,
  packs,
  EXCLUSIVE_TRAIT_PAIRS,
  RngRegistry,
  seedTraits,
  seedVices,
  TRAIT_KEYS,
  traitChance,
  traitRecordsOf,
  type ContentLibrary,
  type Person,
  type PersonRole,
  type RngStream,
  type TraitKey,
} from '@ringside/engine';
import { TraitsSchema } from '../../../../src/model/entities/person';
import { SLOW_TESTS } from '../../../support/slow';
import { expectSerialisable } from '../../../support/trace';
import { BASE_LIBRARY, personAged, WORLD_DATE } from './base-world';

type TunableOverrides = Parameters<typeof createEngineTunables>[0];

const PEOPLE = 20_000;

const IN_A_PAIR = new Set<TraitKey>(EXCLUSIVE_TRAIT_PAIRS.flat());

function traitsStream(seed: string): RngStream {
  return new RngRegistry(seed).stream('worldgen.people.traits');
}

function vicesStream(seed: string): RngStream {
  return new RngRegistry(seed).stream('worldgen.people.vices');
}

/** Rolls traits for `count` copies of `person` from one stream; returns how often each came up. */
function rollTraits(
  person: Person,
  count: number,
  options: { library?: ContentLibrary; tunables?: TunableOverrides; seed?: string } = {},
): { counts: Map<TraitKey, number>; results: TraitKey[][] } {
  const stream = traitsStream(options.seed ?? 'traits');
  const tunables = createEngineTunables(options.tunables ?? {});
  const counts = new Map<TraitKey, number>();
  const results: TraitKey[][] = [];
  for (let index = 0; index < count; index++) {
    const result = seedTraits(person, stream, options.library ?? BASE_LIBRARY, {
      worldDate: WORLD_DATE,
      tunables,
    });
    results.push(result.value);
    for (const trait of result.value) {
      counts.set(trait, (counts.get(trait) ?? 0) + 1);
    }
  }
  return { counts, results };
}

describe('the base trait table', () => {
  const records = traitRecordsOf(BASE_LIBRARY);

  it('has exactly one record for every trait, each with a description', () => {
    expect(records.map((record) => record.traitKey).sort()).toEqual([...TRAIT_KEYS].sort());
    for (const record of records) {
      expect(record.description?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it('keeps disruptive traits rare and professional strengths common', () => {
    const chanceOf = (trait: TraitKey): number =>
      records.find((record) => record.traitKey === trait)?.baseChance ?? -1;
    for (const trait of ['troublemaker', 'partier', 'egotist'] as const) {
      expect(chanceOf(trait)).toBeGreaterThanOrEqual(0.02);
      expect(chanceOf(trait)).toBeLessThanOrEqual(0.08);
    }
    for (const trait of [
      'professional',
      'workhorse',
      'leader',
      'teacher',
      'fastLearner',
    ] as const) {
      expect(chanceOf(trait)).toBeGreaterThanOrEqual(0.05);
      expect(chanceOf(trait)).toBeLessThanOrEqual(0.25);
    }
  });
});

describe('seedTraits', () => {
  for (const role of ['wrestler', 'referee'] as const satisfies readonly PersonRole[]) {
    // The incidence sweeps (20,000 rolls each) run in the slow run only (support/slow.ts).
    it.runIf(SLOW_TESTS)(
      `matches each unpaired trait's chance within 1 point over 20,000 ${role}s`,
      () => {
        const person = personAged(40, {
          roles: [role],
          style: role === 'wrestler' ? 'allRounder' : 'nonWrestler',
        });
        const { counts } = rollTraits(person, PEOPLE, { seed: `incidence-${role}` });
        for (const record of traitRecordsOf(BASE_LIBRARY)) {
          if (IN_A_PAIR.has(record.traitKey)) {
            continue;
          }
          const incidence = (counts.get(record.traitKey) ?? 0) / PEOPLE;
          expect(
            Math.abs(incidence - traitChance(record, role)),
            `${record.traitKey}: ${String(incidence)}`,
          ).toBeLessThanOrEqual(0.01);
        }
      },
    );
  }

  it('never gives both sides of an exclusive pair, even when every trait is certain', () => {
    const certain: ContentLibrary = {
      ...BASE_LIBRARY,
      traitIncidence: Object.fromEntries(
        Object.entries(BASE_LIBRARY.traitIncidence).map(([key, record]) => [
          key,
          { ...record, baseChance: 1, roleMultipliers: {} },
        ]),
      ),
    };
    const person = personAged(40);
    for (const library of [BASE_LIBRARY, certain]) {
      const { results } = rollTraits(person, 2_000, {
        library,
        tunables: { 'worldgen.traits.maxPerPerson': 8 },
      });
      for (const traits of results) {
        for (const [first, second] of EXCLUSIVE_TRAIT_PAIRS) {
          expect(traits.includes(first) && traits.includes(second)).toBe(false);
        }
        expect(TraitsSchema.safeParse(traits).success).toBe(true);
      }
    }
  });

  it('picks between a pair by their chances', () => {
    const pairLibrary = (fast: number, slow: number): ContentLibrary => ({
      ...BASE_LIBRARY,
      traitIncidence: {
        fast: {
          key: packs.keySchema.parse('fast'),
          traitKey: 'fastLearner',
          baseChance: fast,
          roleMultipliers: {},
        },
        slow: {
          key: packs.keySchema.parse('slow'),
          traitKey: 'slowLearner',
          baseChance: slow,
          roleMultipliers: {},
        },
      },
    });
    // Both always come up and weigh the same, so the pick is 50/50.
    const certain = rollTraits(personAged(30), 10_000, { library: pairLibrary(1, 1) });
    const fastCertain = certain.counts.get('fastLearner') ?? 0;
    expect(fastCertain + (certain.counts.get('slowLearner') ?? 0)).toBe(10_000);
    expect(fastCertain / 10_000).toBeCloseTo(0.5, 1);

    // P(fast) = 0.9 × 0.7 + 0.9 × 0.3 × 0.9 / (0.9 + 0.3) = 0.8325.
    const weighted = rollTraits(personAged(30), 20_000, {
      library: pairLibrary(0.9, 0.3),
      seed: 'weighted',
    });
    expect((weighted.counts.get('fastLearner') ?? 0) / 20_000).toBeCloseTo(0.8325, 1);
  });

  it('never goes over the cap, dropping the least likely extras', () => {
    const certain: ContentLibrary = {
      ...BASE_LIBRARY,
      traitIncidence: Object.fromEntries(
        Object.entries(BASE_LIBRARY.traitIncidence).map(([key, record]) => [
          key,
          { ...record, baseChance: Math.min(1, record.baseChance * 8), roleMultipliers: {} },
        ]),
      ),
    };
    for (const cap of [0, 2, 6, 8]) {
      const { results } = rollTraits(personAged(40), 1_000, {
        library: certain,
        tunables: { 'worldgen.traits.maxPerPerson': cap },
        seed: `cap-${String(cap)}`,
      });
      for (const traits of results) {
        expect(traits.length).toBeLessThanOrEqual(cap);
      }
    }
    const { results } = rollTraits(personAged(40), 1, {
      library: certain,
      tunables: { 'worldgen.traits.maxPerPerson': 1 },
    });
    // The one survivor is a trait with the highest chance (professional, at 1).
    expect(results[0]).toEqual(['professional']);
  });

  it('respects minimum ages', () => {
    const young = personAged(20);
    const { counts } = rollTraits(young, 5_000, { seed: 'young' });
    for (const record of traitRecordsOf(BASE_LIBRARY)) {
      if (record.minAge !== undefined && record.minAge > 20) {
        expect(counts.get(record.traitKey) ?? 0, record.traitKey).toBe(0);
      }
    }
    const old = rollTraits(personAged(45), 5_000, { seed: 'old' });
    expect(old.counts.get('teacher') ?? 0).toBeGreaterThan(0);
  });

  it('is deterministic and explains every roll', () => {
    const person = personAged(33);
    const first = seedTraits(person, traitsStream('same'), BASE_LIBRARY, { worldDate: WORLD_DATE });
    const second = seedTraits(person, traitsStream('same'), BASE_LIBRARY, {
      worldDate: WORLD_DATE,
    });
    expect(second).toEqual(first);
    expect(first.trace.children?.find((node) => node.label === 'Rolls')?.children).toHaveLength(
      TRAIT_KEYS.length,
    );
    expectSerialisable(first);
  });
});

describe('seedVices', () => {
  function rollVices(
    person: Person,
    count: number,
    tunables: TunableOverrides,
    seed: string,
  ): { alcohol: number; substances: number } {
    const stream = vicesStream(seed);
    const reader = createEngineTunables(tunables);
    const totals = { alcohol: 0, substances: 0 };
    for (let index = 0; index < count; index++) {
      const result = seedVices(person, stream, { worldDate: WORLD_DATE, tunables: reader });
      for (const vice of ['alcohol', 'substances'] as const) {
        const state = result.value[vice];
        expect(['none', 'hidden']).toContain(state);
        totals[vice] += state === 'hidden' ? 1 : 0;
      }
    }
    return totals;
  }

  it.runIf(SLOW_TESTS)('matches the configured chances within half a point', () => {
    const totals = rollVices(
      personAged(30),
      PEOPLE,
      { 'worldgen.vices.perExperienceYear': 0 },
      'vices',
    );
    expect(Math.abs(totals.alcohol / PEOPLE - 0.03)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(totals.substances / PEOPLE - 0.02)).toBeLessThanOrEqual(0.005);
  });

  it.runIf(SLOW_TESTS)('scales with experience: 20 years in doubles the chance by default', () => {
    const veteran = personAged(40, { debutDate: addYears(WORLD_DATE, -20) });
    const totals = rollVices(veteran, PEOPLE, {}, 'veteran-vices');
    expect(Math.abs(totals.alcohol / PEOPLE - 0.06)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(totals.substances / PEOPLE - 0.04)).toBeLessThanOrEqual(0.005);
  });

  it('gives nobody a vice whose chance is 0, whatever their experience', () => {
    const veteran = personAged(50, { debutDate: addYears(WORLD_DATE, -30) });
    const totals = rollVices(
      veteran,
      5_000,
      {
        'worldgen.vices.alcoholChance': 0,
        'worldgen.vices.substancesChance': 0,
        'worldgen.vices.perExperienceYear': 1,
      },
      'no-vices',
    );
    expect(totals).toEqual({ alcohol: 0, substances: 0 });
  });
});
