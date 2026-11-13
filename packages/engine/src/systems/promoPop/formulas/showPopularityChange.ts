/**
 * Show popularity change: how far one completed show moves a promotion's popularity in one region.
 *
 * The change comes from how the show scored against what that region's fans expected (D-02), not
 * from raw popularity. A margin inside the dead zone changes nothing; past it the response grows
 * in a straight line up to the blowout margin, where the show earns its full gain or loss. Event
 * size and how much of the show the region saw scale it. Gains then shrink smoothly as popularity
 * rises and stop at the region's monthly cap; losses shrink where the promotion has few fans to
 * lose. There is no flat floor either way: a tiny change stays tiny. No rolls, no rounding (the
 * popularity door stores two decimals).
 *
 * Player and rival shows use exactly this formula.
 *
 * Design: docs/design/promotion-popularity.md#show-popularity-change and #monthly-cap.
 */

import { InvalidArgumentError } from '../../../core/errors';
import {
  constantOf,
  inputOf,
  mapTraced,
  startCalc,
  type Calc,
  type Traced,
} from '../../../core/trace';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { importanceLabel } from './labels';

export const SHOW_POPULARITY_CHANGE_DOC_REF = 'promotion-popularity.md#show-popularity-change';
export const MONTHLY_CAP_DOC_REF = 'promotion-popularity.md#monthly-cap';

export interface ShowPopularityChangeInputs {
  readonly regionName: string;
  /** The show's score, 0..100 (`eventInstances.result.score`). */
  readonly score: Traced<number> | number;
  /** What fans in this region expected (`regionExpectation`). */
  readonly expectation: Traced<number>;
  /** The promotion's popularity in this region before this show, 0..100 (0 when none is stored). */
  readonly before: number;
  /** How much of the show this region saw (`showReach`). */
  readonly weight: Traced<number>;
  /** How the region saw the show, in words: "TV: National Signal Network" (`reachLabel`). */
  readonly reachLabel: string;
  readonly importance: EventImportance;
  /** Popularity already gained in this region this calendar month, 0 or more. */
  readonly gainedThisMonth: number;
}

const IMPACT_KEYS = {
  house: 'promoPop.impact.house',
  minor: 'promoPop.impact.minor',
  regular: 'promoPop.impact.regular',
  major: 'promoPop.impact.major',
  flagship: 'promoPop.impact.flagship',
} as const satisfies Readonly<Record<EventImportance, NumberTunableKey>>;

const POPULARITY_MIN = 0;
const POPULARITY_MAX = 100;
const STRENGTH_MIN = 0;
const STRENGTH_MAX = 1;

/** "+14", "−16": a margin as the trace reads it. */
function signed(value: number): string {
  const shown = formatNumber(Math.abs(value));
  if (shown === '0') {
    return '±0';
  }
  return value < 0 ? `−${shown}` : `+${shown}`;
}

function scoreOf(score: Traced<number> | number): Traced<number> {
  return typeof score === 'number' ? inputOf('Show score', score, undefined, 'points') : score;
}

/** `score − expectation`, labelled "Scored 75 against an expected 61: +14". */
function marginOf(inputs: ShowPopularityChangeInputs): Traced<number> {
  const score = scoreOf(inputs.score);
  const margin = score.value - inputs.expectation.value;
  const calc = startCalc(
    `Scored ${formatNumber(score.value)} against an expected ${formatNumber(inputs.expectation.value)}: ${signed(margin)}`,
    score,
    { unit: 'points' },
  );
  calc.subtract('Less what fans here expected', inputs.expectation);
  return calc.done();
}

/**
 * How strong the result was, 0..1: `(|margin| − deadZone) ÷ (blowoutMargin − deadZone)`, kept
 * within 0..1. When the blowout margin is not above the dead zone, anything outside it counts in
 * full (no division by 0).
 */
function strengthOf(margin: Traced<number>, tunables: EngineTunables): Traced<number> {
  const size = mapTraced(margin, 'Size of the margin either way', (value) => Math.abs(value));
  const calc = startCalc('Strength of the result', size, { unit: 'ratio' });
  calc.subtract('Less the dead zone', calc.tunable(tunables, 'promoPop.deadZone', 'Dead zone'));
  const deadZone = tunables.get('promoPop.deadZone');
  const blowout = tunables.get('promoPop.blowoutMargin');
  if (blowout > deadZone) {
    const span = startCalc('From the dead zone to a blowout', 0, {
      unit: 'points',
      startLabel: 'Nothing yet',
    });
    span.add('Blowout margin', span.tunable(tunables, 'promoPop.blowoutMargin', 'Blowout margin'));
    span.subtract('Less the dead zone', span.tunable(tunables, 'promoPop.deadZone', 'Dead zone'));
    calc.divide('Share of the way to a blowout', span.done());
  } else {
    calc.tunable(tunables, 'promoPop.blowoutMargin', 'Blowout margin');
    calc.note('Any result outside the dead zone counts in full');
    calc.max('Counts in full', constantOf('Full strength', 1, 'A blowout counts in full'));
  }
  calc.clamp(STRENGTH_MIN, STRENGTH_MAX, 'A blowout or more counts in full');
  return calc.done();
}

/** `strength × maxGainPerShow` or `strength × maxLossPerShow`. */
function baseChange(
  label: string,
  strength: Traced<number>,
  key: 'promoPop.maxGainPerShow' | 'promoPop.maxLossPerShow',
  tunables: EngineTunables,
): Traced<number> {
  const calc = startCalc(label, strength, { unit: 'points' });
  calc.multiply(
    key === 'promoPop.maxGainPerShow' ? 'Most one show can win' : 'Most one show can lose',
    calc.tunable(
      tunables,
      key,
      key === 'promoPop.maxGainPerShow' ? 'Most gain per show' : 'Most loss per show',
    ),
  );
  return calc.done();
}

/** `(1 − before ÷ 100) ^ diminishingPower`: gains shrink as popularity rises. */
function diminishingFactor(before: number, tunables: EngineTunables): Traced<number> {
  const calc = startCalc(
    'Share of a gain that still lands',
    constantOf('All fans', 1, 'Popularity runs up to 100, the whole region'),
    { unit: 'ratio' },
  );
  const share = startCalc(
    'Share of fans already won',
    inputOf('Popularity here', before, undefined, 'points'),
    { unit: 'ratio' },
  )
    .divide(
      'Out of 100',
      constantOf('Popularity scale', POPULARITY_MAX, 'Popularity runs from 0 to 100'),
    )
    .done();
  calc.subtract('Fans already won', share);
  calc.clamp(STRENGTH_MIN, STRENGTH_MAX, 'Fans left to win stay within 0–1');
  calc.power(
    'Diminishing power',
    calc.tunable(tunables, 'promoPop.diminishingPower', 'Diminishing power'),
  );
  return calc.done();
}

/** `min(1, before ÷ lossFullFrom)`: a promotion with few fans has few to lose. */
function lossScale(before: number, lossFullFrom: number, tunables: EngineTunables): Traced<number> {
  const label =
    before < lossFullFrom
      ? `Few fans to lose here (popularity ${formatNumber(before)})`
      : `Plenty of fans to lose here (popularity ${formatNumber(before)})`;
  const calc = startCalc(label, inputOf('Popularity here', before, undefined, 'points'), {
    unit: 'ratio',
  });
  calc.divide(
    'Full losses from popularity',
    calc.tunable(tunables, 'promoPop.lossFullFrom', 'Full losses from popularity'),
  );
  calc.min('Never more than the full loss', constantOf('Full loss', 1, 'A loss is never enlarged'));
  return calc.done();
}

/** `max(0, monthlyGainCap − gainedThisMonth)`: what this region can still gain this month. */
function remainingCap(gainedThisMonth: number, tunables: EngineTunables): Traced<number> {
  const calc = startCalc('Gain left this month', 0, {
    unit: 'points',
    docRef: MONTHLY_CAP_DOC_REF,
    startLabel: 'Nothing yet',
  });
  calc.add(
    'Monthly gain cap',
    calc.tunable(tunables, 'promoPop.monthlyGainCap', 'Monthly gain cap'),
  );
  calc.subtract('Already gained here this month', gainedThisMonth);
  calc.max('Never below 0', constantOf('Nothing left', 0, 'A cap cannot take back gains'));
  return calc.done();
}

function applyGainShaping(
  calc: Calc,
  inputs: ShowPopularityChangeInputs,
  tunables: EngineTunables,
): void {
  calc.multiply(
    `Diminishing returns at popularity ${formatNumber(inputs.before)}`,
    diminishingFactor(inputs.before, tunables),
  );
  const remaining = remainingCap(inputs.gainedThisMonth, tunables);
  const cap = tunables.get('promoPop.monthlyGainCap');
  calc.min(
    remaining.value <= 0
      ? 'Monthly gain cap reached'
      : `Monthly gain cap: ${formatNumber(inputs.gainedThisMonth)} of ${formatNumber(cap)} used`,
    remaining,
  );
}

function applyLossShaping(
  calc: Calc,
  inputs: ShowPopularityChangeInputs,
  tunables: EngineTunables,
): void {
  const lossFullFrom = tunables.get('promoPop.lossFullFrom');
  if (lossFullFrom <= 0) {
    calc.tunable(tunables, 'promoPop.lossFullFrom', 'Full losses from popularity');
    calc.branch('Losses not scaled', true);
    return;
  }
  const scale = lossScale(inputs.before, lossFullFrom, tunables);
  calc.multiply(scale.trace.label, scale);
}

function assertInputs(inputs: ShowPopularityChangeInputs): void {
  if (
    !Number.isFinite(inputs.before) ||
    inputs.before < POPULARITY_MIN ||
    inputs.before > POPULARITY_MAX
  ) {
    throw new InvalidArgumentError('showPopularityChange', 'before', inputs.before, 'within 0–100');
  }
  if (!Number.isFinite(inputs.gainedThisMonth) || inputs.gainedThisMonth < 0) {
    throw new InvalidArgumentError(
      'showPopularityChange',
      'gainedThisMonth',
      inputs.gainedThisMonth,
      '0 or more',
    );
  }
}

/**
 * The change in a promotion's popularity in one region from one completed show, in points. Adding
 * it to `before` never leaves 0..100. Deterministic: no rolls.
 */
export function showPopularityChange(
  inputs: ShowPopularityChangeInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  assertInputs(inputs);
  const calc = startCalc(`Popularity change in ${inputs.regionName}`, 0, {
    unit: 'points',
    docRef: SHOW_POPULARITY_CHANGE_DOC_REF,
    startLabel: 'No change yet',
  });
  const margin = marginOf(inputs);
  const deadZone = tunables.get('promoPop.deadZone');

  if (Math.abs(margin.value) <= deadZone) {
    calc.add(
      margin.trace.label,
      mapTraced(margin, 'Inside the dead zone: no change', () => 0),
    );
    calc.tunable(tunables, 'promoPop.deadZone', 'Dead zone');
    calc.branch(`About what fans expected (within ±${formatNumber(deadZone)})`, true);
    return calc.done();
  }

  const gain = margin.value > 0;
  const strength = strengthOf(margin, tunables);
  if (gain) {
    const label = `Beat expectations by ${formatNumber(margin.value)}`;
    calc.add(label, baseChange(label, strength, 'promoPop.maxGainPerShow', tunables));
  } else {
    const label = `Fell short of expectations by ${formatNumber(-margin.value)}`;
    calc.subtract(label, baseChange(label, strength, 'promoPop.maxLossPerShow', tunables));
  }

  const impactKey = IMPACT_KEYS[inputs.importance];
  calc.multiply(
    `Event size: ${importanceLabel(inputs.importance)} × ${formatNumber(tunables.get(impactKey))}`,
    calc.tunable(tunables, impactKey, 'Event size effect'),
  );
  calc.multiply(`Seen here as: ${inputs.reachLabel}`, inputs.weight);

  if (gain) {
    applyGainShaping(calc, inputs, tunables);
  } else {
    applyLossShaping(calc, inputs, tunables);
  }

  calc.clamp(
    POPULARITY_MIN - inputs.before,
    POPULARITY_MAX - inputs.before,
    'Popularity stays within 0–100',
  );
  return calc.done();
}
