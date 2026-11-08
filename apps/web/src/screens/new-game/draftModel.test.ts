import { describe, expect, it } from 'vitest';
import { packManifestSchema, parseGameDate } from '@ringside/engine';
import type { WorldPreview } from '@ringside/engine';
import {
  buildStartInput,
  defaultSaveName,
  seasonLengthDays,
  seasonOneWindow,
  shortNameProblem,
  validateAllSteps,
  validateStep,
} from './draftModel';
import type { DraftSnapshot } from './draftModel';
import { emptyFoundForm } from './useNewGameDraft';

const PREVIEW: WorldPreview = {
  manifest: packManifestSchema.parse({
    formatVersion: 1,
    id: 'test-world',
    name: 'W',
    version: '1.0.0',
    kind: 'world',
    description: '',
    author: 'Tests',
    dependsOn: [],
    startDate: '2027-01-04',
    files: {},
  }),
  startDate: parseGameDate('2027-01-04'),
  promotions: [
    {
      key: 'p1',
      name: 'Promotion One',
      shortName: 'ONE',
      color: '#123456',
      homeRegion: { key: 'r1', name: 'Region One' },
      homeCountry: { key: 'c1', name: 'Country One' },
      style: 'mainstream',
      cash: 100,
      prestige: 10,
      rosterSize: 1,
      titleCount: 0,
      homeCountryPopularity: 1,
      regionsKnownIn: 1,
      brands: [],
    },
  ],
  topWorkers: [],
  peopleCount: 1,
  regions: [
    {
      key: 'k1',
      name: 'Continent',
      countries: [
        {
          key: 'c1',
          name: 'Country One',
          regions: [{ key: 'r1', name: 'Region One', population: 1 }],
        },
      ],
    },
  ],
  settings: [
    {
      key: 'sandbox',
      kind: 'boolean',
      default: false,
      label: 'Sandbox',
      description: 'Edit freely.',
      group: 'world',
    },
    {
      key: 'generationLevel',
      kind: 'enum',
      options: ['off', 'low'],
      default: 'low',
      label: 'New content',
      description: 'How much.',
      group: 'world',
    },
  ],
  seasonLength: {
    presets: [
      { key: '3m', label: '3 months', lengthDays: 91 },
      { key: '12m', label: '12 months', lengthDays: 364 },
    ],
    defaultPreset: '12m',
    customWeeks: { min: 4, max: 104 },
  },
  foundingSizes: {
    small: { cash: 1, homePopularity: 1, countryPopularity: 1, prestige: 1 },
    medium: { cash: 2, homePopularity: 2, countryPopularity: 2, prestige: 2 },
    large: { cash: 3, homePopularity: 3, countryPopularity: 3, prestige: 3 },
  },
  takenShortNames: ['ONE'],
  takenNames: ['Promotion One'],
};

function draft(overrides: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    rootPackId: 'test-world',
    player: { mode: 'existing', promotionKey: 'p1', found: emptyFoundForm() },
    seasonLength: null,
    settings: {},
    seed: 'seed',
    startDate: null,
    playerName: 'Alex',
    saveName: null,
    ...overrides,
  };
}

describe('season length', () => {
  it('uses the preview’s default preset until the player picks one', () => {
    expect(seasonLengthDays(draft(), PREVIEW)).toBe(364);
    expect(seasonLengthDays(draft({ seasonLength: { preset: '3m' } }), PREVIEW)).toBe(91);
  });

  it('turns custom weeks inside the range into days, and nothing outside it', () => {
    expect(seasonLengthDays(draft({ seasonLength: { customWeeks: '13' } }), PREVIEW)).toBe(91);
    expect(seasonLengthDays(draft({ seasonLength: { customWeeks: '3' } }), PREVIEW)).toBeNull();
    expect(seasonLengthDays(draft({ seasonLength: { customWeeks: '105' } }), PREVIEW)).toBeNull();
    expect(seasonLengthDays(draft({ seasonLength: { customWeeks: '4.5' } }), PREVIEW)).toBeNull();
  });

  it('works out season 1 from the start date: a 3-month season is 91 days', () => {
    expect(seasonOneWindow(draft({ seasonLength: { preset: '3m' } }), PREVIEW)).toEqual({
      start: '2027-01-04',
      end: '2027-04-04',
      lengthDays: 91,
    });
    expect(
      seasonOneWindow(draft({ seasonLength: { preset: '3m' }, startDate: '2027-02-01' }), PREVIEW)
        ?.end,
    ).toBe('2027-05-02');
  });
});

describe('step checks', () => {
  it('needs a world before anything else', () => {
    expect(validateStep('promotion', draft({ rootPackId: null }), PREVIEW)).toEqual([
      { step: 'world', field: 'rootPackId', message: 'Choose a world to start in.' },
    ]);
    expect(validateStep('world', draft(), null)).toHaveLength(1);
  });

  it('checks a founded promotion’s names, region, style and colour', () => {
    const founding = draft({
      player: {
        mode: 'found',
        promotionKey: null,
        found: { ...emptyFoundForm(), name: 'promotion one', shortName: 'one', color: 'red' },
      },
    });
    const fields = validateStep('promotion', founding, PREVIEW).map((issue) => issue.field);
    expect(fields).toEqual(['name', 'shortName', 'homeRegionKey', 'style', 'color']);
    expect(shortNameProblem(' new1 ', PREVIEW)).toBeNull();
    expect(shortNameProblem('a', PREVIEW)).toBe('Use 2 to 8 letters or digits, no spaces.');
  });

  it('refuses a start date before the world’s and an empty seed', () => {
    const issues = validateStep('options', draft({ startDate: '2026-12-31', seed: ' ' }), PREVIEW);
    expect(issues.map((issue) => issue.field)).toEqual(['seed', 'startDate']);
  });

  it('collects every step’s problems once', () => {
    const issues = validateAllSteps(draft({ rootPackId: null }), PREVIEW);
    expect(issues).toHaveLength(1);
  });
});

describe('buildStartInput', () => {
  it('sends the defaults it shows: preset, save name, and only registered settings', () => {
    const input = buildStartInput(
      draft({ settings: { sandbox: true, generationLevel: 'bogus', retired: true } }),
      PREVIEW,
    );
    expect(input).toEqual({
      rootPackId: 'test-world',
      seed: 'seed',
      playerName: 'Alex',
      saveName: 'ONE 2027',
      seasonLength: { preset: '12m' },
      player: { mode: 'existing', promotionKey: 'p1' },
      settings: { sandbox: true, generationLevel: 'low' },
    });
    expect(
      defaultSaveName(draft({ player: { ...draft().player, promotionKey: null } }), PREVIEW),
    ).toBe('New game 2027');
  });

  it('sends a founded promotion with its short name upper-cased', () => {
    const input = buildStartInput(
      draft({
        seasonLength: { customWeeks: ' 10 ' },
        startDate: '2027-03-01',
        player: {
          mode: 'found',
          promotionKey: null,
          found: {
            ...emptyFoundForm(),
            name: ' New Wave ',
            shortName: 'nw',
            homeRegionKey: 'r1',
            style: 'technical',
          },
        },
      }),
      PREVIEW,
    );
    expect(input.seasonLength).toEqual({ customWeeks: 10 });
    expect(input.startDate).toBe('2027-03-01');
    expect(input.saveName).toBe('NW 2027');
    expect(input.player).toMatchObject({ mode: 'found', name: 'New Wave', shortName: 'NW' });
  });
});
