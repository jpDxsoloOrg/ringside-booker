// Headline popularity. Design: docs/design/office.md#headline-popularity
import { describe, expect, it } from 'vitest';
import { findTraceNodes, inputOf, type Traced } from '../../../../src/core/trace';
import type { RegionId } from '../../../../src/core/ids';
import type { TunableOverrides } from '../../../../src/core/tunables';
import {
  headlinePopularity,
  HEADLINE_SCOPES,
  type HeadlinePopularityInputs,
  type HeadlineScope,
} from '../../../../src/systems/office';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { popularityRollup } from '../../../../src/systems/world/formulas/popularityRollup';
import { geographyOf } from '../../../../src/systems/world/geography';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';
import { worldBuilder } from '../../../support/world-builder';

function level(label: string, value: number): Traced<number> {
  return inputOf(label, value, undefined, 'points');
}

/** Four distinct levels, so each scope's pick is visible. */
const LEVELS = {
  promotionName: 'Test Wrestling',
  homeRegion: { id: 'reg_1', name: 'Harbor', value: 75 },
  homeCountry: { id: 'cty_1', name: 'Testland', rollup: level('Popularity in Testland', 70) },
  homeContinent: { id: 'con_1', name: 'Testia', rollup: level('Popularity in Testia', 40) },
  world: level('Popularity worldwide', 24.14),
} satisfies HeadlinePopularityInputs;

const EXPECTED: Readonly<Record<HeadlineScope, number>> = {
  homeRegion: 75,
  homeCountry: 70,
  homeContinent: 40,
  world: 24.14,
};

function headline(inputs: HeadlinePopularityInputs, overrides: TunableOverrides = {}) {
  const result = headlinePopularity(inputs, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

/** The mini map's home country (North: two regions of 1.8M and 1.2M) rolled up for real. */
function miniInputs(regional: Readonly<Record<number, number>>): {
  inputs: HeadlinePopularityInputs;
  regionNames: string[];
} {
  const { world, ids } = worldBuilder().withGeography('mini').build();
  const geography = geographyOf(world);
  const regionIds = ids.regions;
  const regionalPop: Partial<Record<RegionId, number>> = {};
  for (const [index, value] of Object.entries(regional)) {
    const regionId = regionIds[Number(index)];
    if (regionId !== undefined) {
      regionalPop[regionId] = value;
    }
  }
  const rollup = popularityRollup(regionalPop, geography);
  const homeRegionId = regionIds[0];
  if (homeRegionId === undefined) throw new Error('The mini map has regions');
  const region = geography.region(homeRegionId);
  const country = geography.countryOf(homeRegionId);
  const continent = geography.continentOf(homeRegionId);
  const countryRollup = rollup.countries.get(country.id);
  const continentRollup = rollup.continents.get(continent.id);
  if (countryRollup === undefined || continentRollup === undefined) {
    throw new Error('The roll-up covers the whole map');
  }
  return {
    inputs: {
      promotionName: 'Mini Wrestling',
      homeRegion: { id: region.id, name: region.name, value: rollup.regions.get(region.id) ?? 0 },
      homeCountry: { id: country.id, name: country.name, rollup: countryRollup },
      homeContinent: { id: continent.id, name: continent.name, rollup: continentRollup },
      world: rollup.world,
    },
    regionNames: geography.regionsOf(country.id).map((candidate) => candidate.name),
  };
}

describe('headlinePopularity', () => {
  it.each(HEADLINE_SCOPES)('leads with the %s level when the scope says so', (scope) => {
    const result = headline(LEVELS, { 'office.popularity.headlineScope': scope });
    expect(result.value).toBe(EXPECTED[scope]);
  });

  it('defaults to the home country, labels the root after the promotion and nests that roll-up', () => {
    const result = headline(LEVELS);
    expect(result.value).toBe(70);
    expect(result.trace.label).toBe('Test Wrestling popularity');
    expect(result.trace.docRef).toBe('office.md#headline-popularity');
    expect(result.trace.children?.[0]?.label).toBe('Popularity in Testland');
  });

  it('notes the worldwide and home-region figures as context, to one decimal', () => {
    const result = headline(LEVELS);
    const notes = findTraceNodes(result.trace, 'note').map((node) => node.label);
    expect(notes).toEqual(['Worldwide 24.1', 'Home region Harbor 75']);
  });

  it('leaves out the context note that would repeat the main line', () => {
    const atWorld = headline(LEVELS, { 'office.popularity.headlineScope': 'world' });
    expect(findTraceNodes(atWorld.trace, 'note').map((node) => node.label)).toEqual([
      'Home region Harbor 75',
    ]);
    const atRegion = headline(LEVELS, { 'office.popularity.headlineScope': 'homeRegion' });
    expect(findTraceNodes(atRegion.trace, 'note').map((node) => node.label)).toEqual([
      'Worldwide 24.1',
    ]);
  });

  it('names the scope tunable in the Why?, overridden or not', () => {
    const result = headline(LEVELS, { 'office.popularity.headlineScope': 'homeContinent' });
    const read = expectTraceContains(result, { kind: 'tunable' });
    expect(read).toMatchObject({ key: 'office.popularity.headlineScope', overridden: true });
    expectTraceContains(result, {
      kind: 'branch',
      label: 'Shows popularity in the home continent',
    });
  });

  it('appends the section lines as notes after the context', () => {
    const result = headline({
      ...LEVELS,
      sectionLines: ['Recent shows: Monday Mayhem on 5 January, worldwide +0.8'],
    });
    expect(findTraceNodes(result.trace, 'note').map((node) => node.label)).toEqual([
      'Worldwide 24.1',
      'Home region Harbor 75',
      'Recent shows: Monday Mayhem on 5 January, worldwide +0.8',
    ]);
  });

  it('keeps the figure within 0..100', () => {
    const over = headline({
      ...LEVELS,
      homeCountry: { ...LEVELS.homeCountry, rollup: level('x', 100.0000001) },
    });
    expect(over.value).toBe(100);
    expectTraceContains(over, { kind: 'clamp' });
  });

  it('is 0 for an all-zero map', () => {
    const { inputs } = miniInputs({});
    for (const scope of HEADLINE_SCOPES) {
      expect(headline(inputs, { 'office.popularity.headlineScope': scope }).value).toBe(0);
    }
  });

  it('works for a promotion known in one region only', () => {
    const { inputs } = miniInputs({ 0: 60 });
    expect(headline(inputs, { 'office.popularity.headlineScope': 'homeRegion' }).value).toBe(60);
    // North is 1.8M + 1.2M: the home region is 60% of the country.
    expect(headline(inputs).value).toBeCloseTo(60 * 0.6, 9);
  });

  it('is the hand-computed population-weighted mean of the home country, every region listed', () => {
    const { inputs, regionNames } = miniInputs({ 0: 50, 1: 20, 2: 90 });
    const result = headline(inputs);
    expect(result.value).toBeCloseTo((50 * 1_800_000 + 20 * 1_200_000) / 3_000_000, 9);
    // The main line adds one line per region of the country, each its value × population share.
    const mainLine = result.trace.children?.[0];
    if (mainLine === undefined) throw new Error('The headline has a main line');
    const regionLines = findTraceNodes(mainLine, 'add').map((node) => node.label);
    expect(regionLines).toEqual(regionNames);
    const shares = findTraceNodes(mainLine, 'multiply').map((node) => node.operand);
    expect(shares).toEqual([0.6, 0.4]);
  });
});
