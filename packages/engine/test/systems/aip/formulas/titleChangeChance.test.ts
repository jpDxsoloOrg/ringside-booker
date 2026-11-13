// How likely a rival booker is to move a title. Design: docs/design/rival-booking.md#title-changes
import { describe, expect, it } from 'vitest';
import { makeGameDate } from '../../../../src/core/date';
import { findTraceNodes, inputOf } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import { EVENT_IMPORTANCES } from '../../../../src/model/entities/event-definition';
import {
  titleChangeChance,
  type PopularityPoint,
  type TitleChangeChanceInputs,
} from '../../../../src/systems/aip';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { WORKED_TITLE_TUNABLES } from './workedTunables';
import { expectTraceReplays } from '../../../support/trace';

/** Only the reign band counts. */
const BAND_ONLY: TunableOverrides = {
  'aip.titles.changePrestigeWeight': 0,
  'aip.titles.tempoWeight': 0,
  'aip.titles.importance.regular': 0,
};

function inputs(overrides: Partial<TitleChangeChanceInputs> = {}): TitleChangeChanceInputs {
  return {
    titleName: 'World Title',
    reignDays: 100,
    prestige: 60,
    titleTaste: inputOf("Booker's title taste", 50),
    titleTasteSource: 'booker',
    importance: 'regular',
    popularityHistory: null,
    ...overrides,
  };
}

function run(
  chanceInputs: TitleChangeChanceInputs,
  tuned: TunableOverrides = {},
): ReturnType<typeof titleChangeChance> {
  const result = titleChangeChance(chanceInputs, {
    tunables: createEngineTunables({ ...WORKED_TITLE_TUNABLES, ...tuned }),
  });
  expectTraceReplays(result);
  return result;
}

function labels(result: ReturnType<typeof titleChangeChance>): string[] {
  return result.trace.children?.map((node) => node.label) ?? [];
}

function notes(result: ReturnType<typeof titleChangeChance>): string[] {
  return findTraceNodes(result.trace, 'note').map((node) => node.label);
}

function weekly(values: readonly number[]): PopularityPoint[] {
  return values.map((value, index) => ({
    date: makeGameDate(2026, 1, index + 1),
    value,
  }));
}

describe('titleChangeChance', () => {
  it.each([
    [14, 0, 'up to 14 days band'],
    [15, 4, 'up to 45 days band'],
    [365, 48, 'up to 365 days band'],
    [366, 60, 'past every band (over 365 days)'],
  ])('a reign of %i days lands in its band: %i%%', (reignDays, chance, bandText) => {
    const result = run(inputs({ reignDays }), BAND_ONLY);
    expect(result.value).toBe(chance);
    expect(labels(result)).toContain(`Reign of ${String(reignDays)} days: ${bandText}`);
  });

  it('with every weight 0 the chance is the band alone', () => {
    const result = run(inputs({ reignDays: 312, prestige: 90, importance: 'regular' }), BAND_ONLY);
    expect(result.value).toBe(48);
  });

  it('adds nothing for prestige at the pivot, and more below it', () => {
    const atPivot = run(inputs({ prestige: 60 }), { 'aip.titles.importance.regular': 0 });
    expect(atPivot.value).toBe(22);
    const low = run(inputs({ prestige: 40 }), { 'aip.titles.importance.regular': 0 });
    expect(low.value).toBe(22 + 0.25 * 20);
    expect(labels(low)).toContain('Prestige 40 vs pivot 60');
  });

  it('adds nothing for a neutral title taste, with the constant line', () => {
    const result = run(inputs(), { 'aip.titles.importance.regular': 0 });
    expect(result.value).toBe(22);
    const constants = findTraceNodes(result.trace, 'constant');
    expect(constants.map((node) => node.label)).toContain('Neutral title taste');
    expect(constants[0]?.value).toBe(50);
  });

  it('labels the taste by where it came from and scales it by the tempo weight', () => {
    const booker = run(inputs({ titleTaste: inputOf('Taste', 65) }), {
      'aip.titles.importance.regular': 0,
    });
    expect(booker.value).toBeCloseTo(22 + 0.3 * 15, 10);
    expect(labels(booker)).toContain("Booker's title taste 65");
    const style = run(inputs({ titleTasteSource: 'styleDefault' }));
    expect(labels(style)).toContain('Title taste (style default) 50');
  });

  it.each(EVENT_IMPORTANCES.map((importance) => [importance]))(
    'adds the %s importance term',
    (importance) => {
      const tunables = createEngineTunables(WORKED_TITLE_TUNABLES);
      const result = run(inputs({ importance }));
      expect(result.value).toBe(22 + tunables.get(`aip.titles.importance.${importance}`));
    },
  );

  describe('hot-shot', () => {
    it('notes a missing history and adds 0', () => {
      const result = run(inputs(), BAND_ONLY);
      expect(result.value).toBe(22);
      expect(notes(result)).toContain('No popularity history yet');
    });

    it('notes too few readings and adds 0', () => {
      const result = run(inputs({ popularityHistory: weekly([50, 48, 46]) }), BAND_ONLY);
      expect(result.value).toBe(22);
      expect(notes(result)).toContain('Only 3 weekly readings so far, needs 4');
    });

    it('adds the bonus when the last 3 readings each fell, whatever order they come in', () => {
      const history = weekly([70, 50, 48, 46, 41]).reverse();
      const result = run(inputs({ popularityHistory: history }), BAND_ONLY);
      expect(result.value).toBe(32);
      expect(labels(result)).toContain('Popularity fell 3 weeks running (hot-shot)');
    });

    it('adds nothing when a reading in the middle is flat, and lists the readings', () => {
      const result = run(inputs({ popularityHistory: weekly([50, 48, 48, 45]) }), BAND_ONLY);
      expect(result.value).toBe(22);
      const branches = findTraceNodes(result.trace, 'branch');
      expect(branches).toContainEqual(
        expect.objectContaining({
          label: 'Popularity fell 3 weeks running (hot-shot)',
          taken: false,
        }),
      );
      expect(notes(result)).toContain('Weekly readings: 50, 48, 48, 45');
    });
  });

  it('clamps at 0 for a negative sum and at the maximum', () => {
    const low = run(inputs({ reignDays: 5, importance: 'house' }));
    expect(low.value).toBe(0);
    const high = run(inputs({ reignDays: 1000, importance: 'flagship', prestige: 0 }), {
      'aip.titles.maxChance': 70,
    });
    expect(high.value).toBe(70);
  });

  it('is always 0 with a maximum of 0', () => {
    const result = run(inputs({ reignDays: 1000, importance: 'flagship', prestige: 0 }), {
      'aip.titles.maxChance': 0,
    });
    expect(result.value).toBe(0);
  });

  it('follows an overridden band on the next call', () => {
    expect(run(inputs(), { ...BAND_ONLY, 'aip.titles.band4.chance': 30 }).value).toBe(30);
    expect(run(inputs(), { ...BAND_ONLY, 'aip.titles.band3.maxDays': 120 }).value).toBe(12);
  });

  it('falls back to the default bands when the days do not increase, with a note', () => {
    const result = run(inputs(), {
      ...BAND_ONLY,
      'aip.titles.band3.maxDays': 20,
      'aip.titles.band4.chance': 99,
    });
    // The shipped default band, not the worked numbers above.
    expect(result.value).toBe(12);
    expect(notes(result).some((note) => note.includes('the default bands are used'))).toBe(true);
  });

  it('names a tunable on each line', () => {
    const result = run(inputs({ popularityHistory: weekly([60, 55, 50, 45]) }));
    const keys = findTraceNodes(result.trace, 'tunable').map((node) => node.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'aip.titles.band4.maxDays',
        'aip.titles.band4.chance',
        'aip.titles.prestigePivot',
        'aip.titles.changePrestigeWeight',
        'aip.titles.tempoWeight',
        'aip.titles.importance.regular',
        'aip.titles.hotShot.weeks',
        'aip.titles.hotShot.bonus',
        'aip.titles.maxChance',
      ]),
    );
  });
});
