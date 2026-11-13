/**
 * The rival results' balance numbers (AIP5): who a rival booker has win its matches and when it
 * moves a title. Category `Rival booking` like the card planner's, each with a docRef into
 * docs/design/rival-booking.md (`#winners` or `#title-changes`).
 *
 * AIP5-01 defines every key the pack uses so the later tickets only add code. Nothing here sets a
 * match's length (D-10): a squash is a push-gap rule, not a short match.
 */

import { defineTunables } from '../../../core/tunables/define';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { EngineTunables } from '../../tunables';
import { RIVAL_BOOKING_CATEGORY } from '../card/tunables';

export const WINNERS_DOC_REF = 'rival-booking.md#winners';
export const TITLE_CHANGES_DOC_REF = 'rival-booking.md#title-changes';

/** The reign bands, shortest first: `aip.titles.band<n>.maxDays` and `.chance`, n = 1..6. */
export const REIGN_BAND_NUMBERS = [1, 2, 3, 4, 5, 6] as const;
export type ReignBandNumber = (typeof REIGN_BAND_NUMBERS)[number];
export type ReignBandDaysKey = `aip.titles.band${ReignBandNumber}.maxDays`;
export type ReignBandChanceKey = `aip.titles.band${ReignBandNumber}.chance`;

const BAND_KEYS: Readonly<
  Record<ReignBandNumber, { days: ReignBandDaysKey; chance: ReignBandChanceKey }>
> = {
  1: { days: 'aip.titles.band1.maxDays', chance: 'aip.titles.band1.chance' },
  2: { days: 'aip.titles.band2.maxDays', chance: 'aip.titles.band2.chance' },
  3: { days: 'aip.titles.band3.maxDays', chance: 'aip.titles.band3.chance' },
  4: { days: 'aip.titles.band4.maxDays', chance: 'aip.titles.band4.chance' },
  5: { days: 'aip.titles.band5.maxDays', chance: 'aip.titles.band5.chance' },
  6: { days: 'aip.titles.band6.maxDays', chance: 'aip.titles.band6.chance' },
};

export function reignBandDaysKey(band: ReignBandNumber): ReignBandDaysKey {
  return BAND_KEYS[band].days;
}

export function reignBandChanceKey(band: ReignBandNumber): ReignBandChanceKey {
  return BAND_KEYS[band].chance;
}

/** `aip.titles.importance.<importance>`: what a show of that importance adds to the change chance. */
export type TitleImportanceKey = `aip.titles.importance.${EventImportance}`;

export function titleImportanceKey(importance: EventImportance): TitleImportanceKey {
  return `aip.titles.importance.${importance}`;
}

const PROBABILITY = {
  kind: 'number',
  min: 0,
  max: 1,
  step: 0.01,
  unit: 'probability',
  category: RIVAL_BOOKING_CATEGORY,
  docRef: WINNERS_DOC_REF,
} as const;

const BAND_DAYS = {
  kind: 'integer',
  min: 1,
  max: 3650,
  unit: 'days',
  category: RIVAL_BOOKING_CATEGORY,
  docRef: TITLE_CHANGES_DOC_REF,
} as const;

const BAND_CHANCE = {
  kind: 'number',
  min: 0,
  max: 100,
  step: 1,
  unit: 'percent',
  category: RIVAL_BOOKING_CATEGORY,
  docRef: TITLE_CHANGES_DOC_REF,
} as const;

const IMPORTANCE = {
  kind: 'number',
  min: -100,
  max: 100,
  step: 1,
  unit: 'percent',
  category: RIVAL_BOOKING_CATEGORY,
  docRef: TITLE_CHANGES_DOC_REF,
} as const;

const POPULARITY_LINE = {
  kind: 'number',
  min: 0,
  max: 100,
  unit: 'points',
  category: RIVAL_BOOKING_CATEGORY,
  docRef: TITLE_CHANGES_DOC_REF,
} as const;

export const aipResultsTunables = defineTunables({
  // Winners.
  'aip.winner.jitter': {
    kind: 'number',
    default: 0.1,
    min: 0,
    max: 0.5,
    step: 0.01,
    unit: 'ratio',
    category: RIVAL_BOOKING_CATEGORY,
    description: "Largest random swing on each side's value, either way (0 = none)",
    docRef: WINNERS_DOC_REF,
  },
  'aip.winner.drawChance': {
    ...PROBABILITY,
    default: 0,
    description: 'Chance a two-sided non-squash match is booked as a draw (0 = never)',
  },
  'aip.winner.squash.pushGap': {
    kind: 'integer',
    default: 3,
    min: 1,
    max: 5,
    unit: 'count',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'Push bands between the sides before a match counts as a squash',
    docRef: WINNERS_DOC_REF,
  },
  'aip.winner.squash.chance': {
    ...PROBABILITY,
    default: 0.92,
    description: 'Chance the higher-pushed side wins a squash',
  },
  'aip.winner.protect.ace': {
    ...PROBABILITY,
    default: 0.6,
    description: "Chance the booker protects its ace: the ace's side wins outright",
  },
  'aip.winner.protect.prospect': {
    ...PROBABILITY,
    default: 0.75,
    description: "Chance the booker protects a prospect: the prospect's side wins outright",
  },
  'aip.winner.finale.faceChance': {
    ...PROBABILITY,
    default: 0.7,
    description: "Chance the faces win a storyline's finale",
  },
  'aip.winner.finale.minAgeDays': {
    kind: 'integer',
    default: 56,
    min: 7,
    max: 365,
    unit: 'days',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'Without a finale flag, a storyline this old counts as reaching its finale',
    docRef: WINNERS_DOC_REF,
  },
  'aip.winner.method.nonTitleWeight': {
    kind: 'number',
    default: 0.15,
    min: 0,
    max: 5,
    step: 0.05,
    unit: 'multiplier',
    category: RIVAL_BOOKING_CATEGORY,
    description:
      "Weight of methods that can't change titles (count-out, disqualification) when picking a method",
    docRef: WINNERS_DOC_REF,
  },

  // Title changes: the reign bands.
  'aip.titles.band1.maxDays': {
    ...BAND_DAYS,
    default: 14,
    description: 'Longest reign in the first band; each band runs past the one before',
  },
  'aip.titles.band1.chance': {
    ...BAND_CHANCE,
    default: 0,
    description: 'Base chance a title changes hands while the reign is in the first band',
  },
  'aip.titles.band2.maxDays': { ...BAND_DAYS, default: 45, description: 'Longest reign in band 2' },
  'aip.titles.band2.chance': { ...BAND_CHANCE, default: 2, description: 'Base chance in band 2' },
  'aip.titles.band3.maxDays': { ...BAND_DAYS, default: 90, description: 'Longest reign in band 3' },
  'aip.titles.band3.chance': { ...BAND_CHANCE, default: 6, description: 'Base chance in band 3' },
  'aip.titles.band4.maxDays': {
    ...BAND_DAYS,
    default: 150,
    description: 'Longest reign in band 4',
  },
  'aip.titles.band4.chance': { ...BAND_CHANCE, default: 12, description: 'Base chance in band 4' },
  'aip.titles.band5.maxDays': {
    ...BAND_DAYS,
    default: 240,
    description: 'Longest reign in band 5',
  },
  'aip.titles.band5.chance': { ...BAND_CHANCE, default: 18, description: 'Base chance in band 5' },
  'aip.titles.band6.maxDays': {
    ...BAND_DAYS,
    default: 365,
    description: 'Longest reign in band 6',
  },
  'aip.titles.band6.chance': { ...BAND_CHANCE, default: 26, description: 'Base chance in band 6' },
  'aip.titles.bandBeyond.chance': {
    ...BAND_CHANCE,
    default: 34,
    description: 'Base chance a title changes hands once the reign is longer than the last band',
  },

  // Title changes: the terms on top of the band.
  'aip.titles.prestigePivot': {
    ...POPULARITY_LINE,
    default: 60,
    description: 'Prestige at which a title neither gains nor loses change chance',
  },
  'aip.titles.changePrestigeWeight': {
    kind: 'number',
    default: 0.25,
    min: 0,
    max: 2,
    step: 0.05,
    unit: 'multiplier',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'Titles below the pivot change more often, above it less',
    docRef: TITLE_CHANGES_DOC_REF,
  },
  'aip.titles.tempoWeight': {
    kind: 'number',
    default: 0.3,
    min: 0,
    max: 2,
    step: 0.05,
    unit: 'multiplier',
    category: RIVAL_BOOKING_CATEGORY,
    description: "How much the booker's title taste moves the chance",
    docRef: TITLE_CHANGES_DOC_REF,
  },
  'aip.titles.houseShowsRetain': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'Titles never change on house shows',
    docRef: TITLE_CHANGES_DOC_REF,
  },
  'aip.titles.importance.house': {
    ...IMPORTANCE,
    default: -20,
    description: 'What a house show adds to the change chance',
  },
  'aip.titles.importance.minor': {
    ...IMPORTANCE,
    default: -12,
    description: 'Same, on a minor show',
  },
  'aip.titles.importance.regular': {
    ...IMPORTANCE,
    default: -8,
    description: 'Same, on a regular weekly show',
  },
  'aip.titles.importance.major': {
    ...IMPORTANCE,
    default: 6,
    description: 'Same, on a major show',
  },
  'aip.titles.importance.flagship': {
    ...IMPORTANCE,
    default: 15,
    description: 'Same, on the flagship show of the year',
  },
  'aip.titles.hotShot.weeks': {
    kind: 'integer',
    default: 3,
    min: 2,
    max: 12,
    unit: 'count',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'Weekly popularity readings that must each fall',
    docRef: TITLE_CHANGES_DOC_REF,
  },
  'aip.titles.hotShot.bonus': {
    ...BAND_CHANCE,
    default: 10,
    description: "Change chance added while the promotion's popularity keeps falling",
  },
  'aip.titles.overdueDays': {
    kind: 'integer',
    default: 400,
    min: 30,
    max: 3650,
    unit: 'days',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'A reign this long is overdue to end',
    docRef: TITLE_CHANGES_DOC_REF,
  },
  'aip.titles.expiringDays': {
    kind: 'integer',
    default: 28,
    min: 0,
    max: 365,
    unit: 'days',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'A champion whose contract ends within this many days drops the title',
    docRef: TITLE_CHANGES_DOC_REF,
  },
  'aip.titles.challengerMinContractDays': {
    kind: 'integer',
    default: 60,
    min: 0,
    max: 365,
    unit: 'days',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'A challenger needs at least this many contract days left to win a title',
    docRef: TITLE_CHANGES_DOC_REF,
  },
  'aip.titles.maxChance': {
    ...BAND_CHANCE,
    default: 90,
    description: 'The highest change chance any title match can reach',
  },

  // Title changes: who may take a title, by the side's market popularity.
  'aip.titles.valid.gap': {
    ...POPULARITY_LINE,
    default: 50,
    description: "How far below the title's prestige a valid challenger's market popularity may be",
  },
  'aip.titles.valid.floor': {
    ...POPULARITY_LINE,
    default: 12,
    description: 'Least market popularity a valid challenger needs, however low the prestige',
  },
  'aip.titles.strong.gap': {
    ...POPULARITY_LINE,
    default: 35,
    description:
      "How far below the title's prestige a strong challenger's market popularity may be",
  },
  'aip.titles.strong.floor': {
    ...POPULARITY_LINE,
    default: 25,
    description: 'Least market popularity a strong challenger needs, however low the prestige',
  },
});

/** One reign band: reigns up to `maxDays` long change hands with `chance` percent. */
export interface ReignBand {
  readonly band: ReignBandNumber;
  readonly maxDays: number;
  readonly chance: number;
}

/** The six reign bands as set, shortest first. */
export function reignBandsAsSet(tunables: EngineTunables): ReignBand[] {
  return REIGN_BAND_NUMBERS.map((band) => ({
    band,
    maxDays: tunables.get(reignBandDaysKey(band)),
    chance: tunables.get(reignBandChanceKey(band)),
  }));
}

/** Every place the bands' `maxDays` fail to increase; empty when they are in order. */
export function reignBandProblems(bands: readonly ReignBand[]): string[] {
  const problems: string[] = [];
  for (let index = 1; index < bands.length; index++) {
    const previous = bands[index - 1];
    const current = bands[index];
    if (previous !== undefined && current !== undefined && current.maxDays <= previous.maxDays) {
      problems.push(
        `Band ${String(current.band)} ends at ${String(current.maxDays)} days, which is not after band ${String(previous.band)} (${String(previous.maxDays)} days)`,
      );
    }
  }
  return problems;
}

/**
 * The reign bands to use: the set ones when their `maxDays` increase, otherwise the defaults, with
 * the problems so the Why? can say the settings were ignored.
 */
export function reignBandsOf(tunables: EngineTunables): {
  bands: ReignBand[];
  problems: string[];
} {
  const bands = reignBandsAsSet(tunables);
  const problems = reignBandProblems(bands);
  if (problems.length === 0) {
    return { bands, problems };
  }
  return {
    bands: REIGN_BAND_NUMBERS.map((band) => ({
      band,
      maxDays: aipResultsTunables[reignBandDaysKey(band)].default,
      chance: aipResultsTunables[reignBandChanceKey(band)].default,
    })),
    problems,
  };
}
