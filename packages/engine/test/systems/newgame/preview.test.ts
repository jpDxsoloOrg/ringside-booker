// New game (WLD-10): previewWorld with the WLD-02 fixture packs.
// Design: docs/design/new-game.md#world-preview
import { afterEach, describe, expect, it } from 'vitest';
import { assertSerialisable } from '../../../src/core/api';
import {
  previewWorld,
  registerNewGameSetting,
  SEASON_PRESETS,
  type WorldPreview,
} from '../../../src/systems/newgame';
import { miniWorldPacks, recordsOf, withFiles } from '../../support/fixture-packs';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function preview(packs = miniWorldPacks()): WorldPreview {
  const result = previewWorld(packs, 'mini-world');
  if (!result.ok) {
    throw new Error(`Preview failed: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

describe('previewWorld', () => {
  it('lists every active promotion with its roster count', () => {
    const { promotions, startDate, manifest } = preview();
    expect(manifest.id).toBe('mini-world');
    expect(startDate).toBe('2026-01-05');
    expect(promotions.map((row) => row.key)).toEqual([
      'harbour-city-wrestling',
      'river-city-wrestling',
    ]);
    expect(promotions[0]).toMatchObject({
      name: 'Harbour City Wrestling',
      shortName: 'HCW',
      color: '#1f6f8b',
      homeRegion: { key: 'harbour-coast', name: 'Harbour Coast' },
      homeCountry: { key: 'cormere', name: 'Cormere' },
      style: 'traditional',
      cash: 25_000_000,
      prestige: 38,
      rosterSize: 2,
      titleCount: 1,
      regionsKnownIn: 2,
      brands: [{ key: 'hcw-friday', name: 'Friday Night Harbour' }],
    });
    expect(promotions[1]).toMatchObject({ shortName: 'RCW', rosterSize: 2, titleCount: 0 });
  });

  it('leaves out promotions that are not active', () => {
    const [base, world] = miniWorldPacks();
    if (base === undefined || world === undefined) {
      throw new Error('fixture packs missing');
    }
    const promotions = recordsOf(world, 'promotion').map((row) =>
      row['key'] === 'river-city-wrestling' ? { ...row, status: 'dormant' } : row,
    );
    const changed = withFiles(world, { promotion: promotions });
    const dormantPreview = preview([
      base,
      { ...changed, manifest: { ...changed.manifest, version: '1.0.1' } },
    ]);
    expect(dormantPreview.promotions.map((row) => row.shortName)).toEqual(['HCW']);
    // A dormant promotion still holds its short name.
    expect(dormantPreview.takenShortNames).toEqual(['HCW', 'RCW']);
  });

  it('lists every short name and name already taken', () => {
    const { takenShortNames, takenNames } = preview();
    expect(takenShortNames).toEqual(['HCW', 'RCW']);
    expect(takenNames).toEqual(['Harbour City Wrestling', 'River City Wrestling']);
  });

  it('lists the best-known wrestlers', () => {
    const { topWorkers } = preview();
    expect(topWorkers).toHaveLength(4);
    const popularity = topWorkers.map((row) => row.popularitySummary.bestCountryPopularity);
    expect([...popularity].sort((left, right) => right - left)).toEqual(popularity);
    for (const worker of topWorkers) {
      expect(worker.promotionShortName === 'HCW' || worker.promotionShortName === 'RCW').toBe(true);
      expect(worker.age).toBeGreaterThan(17);
    }
  });

  it('groups the map by continent, country and region', () => {
    const { regions } = preview();
    expect(regions).toEqual([
      {
        key: 'arden',
        name: 'Arden',
        countries: [
          {
            key: 'cormere',
            name: 'Cormere',
            regions: [
              { key: 'harbour-coast', name: 'Harbour Coast', population: 1_900_000 },
              { key: 'north-ridge', name: 'North Ridge', population: 900_000 },
            ],
          },
          {
            key: 'vellmark',
            name: 'Vellmark',
            regions: [{ key: 'vell-lowlands', name: 'Vell Lowlands', population: 2_300_000 }],
          },
        ],
      },
    ]);
  });

  it('includes the built-in settings and a setting registered later', () => {
    cleanups.push(
      registerNewGameSetting({
        key: 'testOwnerGoals',
        kind: 'boolean',
        default: false,
        label: 'Owner goals',
        description: 'A test setting.',
        group: 'difficulty',
      }),
    );
    const keys = preview().settings.map((setting) => setting.key);
    expect(keys).toEqual([
      'agingEnabled',
      'sandbox',
      'generationLevel',
      'levelPlayingField',
      'equalStart',
      'randomiseContractLengths',
      'rerollPotential',
      'testOwnerGoals',
    ]);
    expect(preview().settings.find((setting) => setting.key === 'levelPlayingField')).toEqual({
      key: 'levelPlayingField',
      kind: 'boolean',
      default: false,
      label: 'Level playing field',
      description:
        'Rival promotions follow exactly the same rules as yours: no simulation shortcuts.',
      group: 'difficulty',
    });
  });

  it('lists the four season presets and the custom range', () => {
    const { seasonLength } = preview();
    expect(seasonLength).toEqual({
      presets: SEASON_PRESETS.map((preset) => ({ ...preset })),
      defaultPreset: '12m',
      customWeeks: { min: 4, max: 104 },
    });
    expect(seasonLength.presets.map((preset) => preset.lengthDays)).toEqual([28, 91, 182, 364]);
  });

  it('lists the founding numbers per size', () => {
    expect(preview().foundingSizes).toEqual({
      small: { cash: 7_500_000, homePopularity: 8, countryPopularity: 2, prestige: 20 },
      medium: { cash: 30_000_000, homePopularity: 20, countryPopularity: 8, prestige: 35 },
      large: { cash: 120_000_000, homePopularity: 35, countryPopularity: 18, prestige: 50 },
    });
  });

  it('survives structuredClone and is plain JSON', () => {
    const value = preview();
    expect(structuredClone(value)).toEqual(value);
    expect(() => {
      assertSerialisable(value, 'preview');
    }).not.toThrow();
  });

  it('gives the same content for the same pack set', () => {
    const first = preview();
    const second = preview();
    expect(second.promotions).toBe(first.promotions);
    expect(second).toEqual(first);
  });

  it('returns the pack issues for packs that do not load', () => {
    const result = previewWorld([], 'mini-world');
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
