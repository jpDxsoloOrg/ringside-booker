/**
 * How likely a rival booker is to move a title in tonight's match, in percent.
 *
 * ```
 * chance = clamp(
 *   band(reignDays)
 *   + aip.titles.changePrestigeWeight × (aip.titles.prestigePivot − prestige)
 *   + aip.titles.tempoWeight × (titleTaste − 50)
 *   + aip.titles.importance.<importance>
 *   + hotShot,
 *   0, aip.titles.maxChance)
 * ```
 *
 * - `band(d)` is `aip.titles.band<n>.chance` for the first band n (1..6) with
 *   `d ≤ aip.titles.band<n>.maxDays`, else `aip.titles.bandBeyond.chance`. Bands whose days do not
 *   increase are ignored for the default bands, with a note ({@link reignBandsOf}).
 * - 50 is the neutral title taste (a constant, not a tunable).
 * - `hotShot` is `aip.titles.hotShot.bonus` when each of the last `aip.titles.hotShot.weeks`
 *   weekly popularity readings is strictly lower than the one before, else 0.
 *
 * Pure: no world access, no rolls. Each line names its tunable, so the trace replays exactly.
 *
 * Design: docs/design/rival-booking.md#title-changes.
 */

import type { GameDate } from '../../../core/date';
import { constantOf, startCalc, type Calc, type Traced } from '../../../core/trace';
import type { EventImportance } from '../../../model/entities/event-definition';
import { formatNumber } from '../../world/people/labels';
import type { EngineTunables } from '../../tunables';
import { NO_POPULARITY_HISTORY_NOTE } from '../results/history';
import { STORED_TITLE_TASTE_LABEL, STYLE_TITLE_TASTE_LABEL } from '../results/inputs';
import {
  reignBandChanceKey,
  reignBandDaysKey,
  reignBandsOf,
  TITLE_CHANGES_DOC_REF,
  titleImportanceKey,
  type ReignBand,
} from '../results/tunables';

export type TitleTasteSource = 'booker' | 'styleDefault';

export interface PopularityPoint {
  date: GameDate;
  value: number;
}

export interface TitleChangeChanceInputs {
  titleName: string;
  /** Days the current reign has lasted. */
  reignDays: number;
  /** The title's prestige, 0-100. */
  prestige: number;
  /** The booker's title taste (AIP1's `titleFocus` axis), 0-100. */
  titleTaste: Traced<number>;
  /** Where the taste came from: the booker's own, or its style's default. */
  titleTasteSource: TitleTasteSource;
  importance: EventImportance;
  /** The promotion's weekly popularity readings, or null with no history source. */
  popularityHistory: readonly PopularityPoint[] | null;
}

export interface TitleChangeChanceDeps {
  tunables: EngineTunables;
}

/** Title taste is 0-100; 50 moves the chance neither way. */
export const NEUTRAL_TITLE_TASTE = 50;
export const NEUTRAL_TITLE_TASTE_LABEL = 'Neutral title taste';
export const NEUTRAL_TITLE_TASTE_REASON =
  'Title taste is 0-100; 50 neither speeds up nor slows down title changes';

const IMPORTANCE_LABELS: Readonly<Record<EventImportance, string>> = {
  house: 'House show',
  minor: 'Minor show',
  regular: 'Regular show',
  major: 'Major show',
  flagship: 'Flagship show',
};

export function titleChangeChanceLabel(titleName: string): string {
  return `Title change chance: ${titleName}`;
}

export function reignBandText(reignDays: number, maxDays: number): string {
  return `Reign of ${formatNumber(reignDays)} days: up to ${formatNumber(maxDays)} days band`;
}

export function reignBeyondText(reignDays: number, lastMaxDays: number): string {
  return `Reign of ${formatNumber(reignDays)} days: past every band (over ${formatNumber(lastMaxDays)} days)`;
}

export function hotShotText(weeks: number): string {
  return `Popularity fell ${formatNumber(weeks)} weeks running (hot-shot)`;
}

/**
 * The hot-shot line before there are enough readings to compare: "No popularity history yet" with
 * none (a new game), else "Only 1 weekly reading so far, needs 4".
 */
export function fewReadingsText(count: number, needed: number): string {
  if (count === 0) return NO_POPULARITY_HISTORY_NOTE;
  const readings = count === 1 ? 'reading' : 'readings';
  return `Only ${formatNumber(count)} weekly ${readings} so far, needs ${formatNumber(needed)}`;
}

function addReignBand(calc: Calc, inputs: TitleChangeChanceInputs, tunables: EngineTunables): void {
  const { bands, problems } = reignBandsOf(tunables);
  for (const problem of problems) {
    calc.note(`${problem}: the default bands are used`);
  }
  const usingSet = problems.length === 0;
  const band: ReignBand | undefined = bands.find((entry) => inputs.reignDays <= entry.maxDays);
  if (band === undefined) {
    const last = bands[bands.length - 1];
    calc.branch(reignBeyondText(inputs.reignDays, last?.maxDays ?? 0), true);
    calc.add(
      'Reign band chance',
      calc.tunable(tunables, 'aip.titles.bandBeyond.chance', 'Chance past the last band'),
    );
    return;
  }
  if (!usingSet) {
    calc.branch(reignBandText(inputs.reignDays, band.maxDays), true);
    calc.add('Reign band chance (default)', band.chance);
    return;
  }
  // The days read attaches to the band line, the chance read to the band chance.
  calc.tunable(tunables, reignBandDaysKey(band.band), `Band ${String(band.band)} ends at`);
  calc.branch(reignBandText(inputs.reignDays, band.maxDays), true);
  calc.add(
    'Reign band chance',
    calc.tunable(tunables, reignBandChanceKey(band.band), `Band ${String(band.band)} chance`),
  );
}

function prestigeTerm(inputs: TitleChangeChanceInputs, tunables: EngineTunables): Traced<number> {
  const term = startCalc(`Prestige of ${inputs.titleName}`, 0, {
    unit: 'percent',
    startLabel: 'Nothing counted yet',
    docRef: TITLE_CHANGES_DOC_REF,
  });
  term.add('Prestige pivot', term.tunable(tunables, 'aip.titles.prestigePivot'));
  term.subtract('Title prestige', inputs.prestige);
  term.multiply('Prestige weight', term.tunable(tunables, 'aip.titles.changePrestigeWeight'));
  return term.done();
}

function tasteTerm(inputs: TitleChangeChanceInputs, tunables: EngineTunables): Traced<number> {
  const label =
    inputs.titleTasteSource === 'booker' ? STORED_TITLE_TASTE_LABEL : STYLE_TITLE_TASTE_LABEL;
  const term = startCalc(label, inputs.titleTaste, {
    unit: 'percent',
    docRef: TITLE_CHANGES_DOC_REF,
  });
  term.subtract(
    NEUTRAL_TITLE_TASTE_LABEL,
    constantOf(NEUTRAL_TITLE_TASTE_LABEL, NEUTRAL_TITLE_TASTE, NEUTRAL_TITLE_TASTE_REASON),
  );
  term.multiply('Title tempo weight', term.tunable(tunables, 'aip.titles.tempoWeight'));
  return term.done();
}

function compareDates(left: PopularityPoint, right: PopularityPoint): number {
  return left.date < right.date ? -1 : left.date > right.date ? 1 : 0;
}

function addHotShot(calc: Calc, inputs: TitleChangeChanceInputs, tunables: EngineTunables): void {
  if (inputs.popularityHistory === null) {
    calc.note(NO_POPULARITY_HISTORY_NOTE);
    return;
  }
  const weeks = calc.tunable(tunables, 'aip.titles.hotShot.weeks', 'Weeks of falling popularity');
  const readings = [...inputs.popularityHistory].sort(compareDates);
  if (readings.length < weeks + 1) {
    calc.note(fewReadingsText(readings.length, weeks + 1));
    return;
  }
  const recent = readings.slice(readings.length - (weeks + 1));
  const falling = recent.every(
    (reading, index) => index === 0 || reading.value < (recent[index - 1]?.value ?? -Infinity),
  );
  if (falling) {
    calc.add(hotShotText(weeks), calc.tunable(tunables, 'aip.titles.hotShot.bonus'));
    return;
  }
  calc.branch(hotShotText(weeks), false);
  calc.note(`Weekly readings: ${recent.map((reading) => formatNumber(reading.value)).join(', ')}`);
}

export function titleChangeChance(
  inputs: TitleChangeChanceInputs,
  deps: TitleChangeChanceDeps,
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(titleChangeChanceLabel(inputs.titleName), 0, {
    unit: 'percent',
    startLabel: 'Nothing counted yet',
    docRef: TITLE_CHANGES_DOC_REF,
  });
  addReignBand(calc, inputs, tunables);

  const prestige = prestigeTerm(inputs, tunables);
  calc.add(
    `Prestige ${formatNumber(inputs.prestige)} vs pivot ${formatNumber(tunables.get('aip.titles.prestigePivot'))}`,
    prestige,
  );

  const taste = tasteTerm(inputs, tunables);
  calc.add(
    `${inputs.titleTasteSource === 'booker' ? STORED_TITLE_TASTE_LABEL : STYLE_TITLE_TASTE_LABEL} ${formatNumber(inputs.titleTaste.value)}`,
    taste,
  );

  calc.add(
    IMPORTANCE_LABELS[inputs.importance],
    calc.tunable(tunables, titleImportanceKey(inputs.importance)),
  );

  addHotShot(calc, inputs, tunables);

  const maxChance = calc.tunable(tunables, 'aip.titles.maxChance');
  calc.clamp(0, maxChance, `Kept between 0% and ${formatNumber(maxChance)}%`);
  return calc.done();
}
