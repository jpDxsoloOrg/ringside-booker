/**
 * Fatigue gain: how much fatigue one worker picks up in one match (MTCH4-01).
 *
 * Starts from the fatigue the slot's duration class costs (D-10: never minutes), shares it out when
 * more than two people work the match, eases it with stamina, and moves it by style, effort traits,
 * a house show, every risk contribution that reaches the worker, working more than once on the
 * card and keep-it-safe. Kept between 0 and `match.fatigue.maxPerSegment`.
 *
 * Talking segments never get here: angles cost no stamina (`collectPhysicalInputs`).
 *
 * Design: docs/design/physical-toll.md#fatigue-gain.
 */

import { InvalidArgumentError } from '../../../core/errors';
import { constantOf, startCalc, traced, type Calc, type Traced } from '../../../core/trace';
import { tunableNode } from '../../../core/trace/tunable-node';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { RingStyle, TraitKey } from '../../../model/entities/person';
import { STYLE_LABELS, formatNumber } from '../../world/people/labels';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import type { RiskContribution } from '../physical/riskModifiers';
import { DURATION_CLASS_LABELS, type DurationClass } from '../slots';

export const FATIGUE_GAIN_DOC_REF = 'physical-toll.md#fatigue-gain';

export interface FatigueGainInputs {
  /** The worker's name, for the trace. */
  name: string;
  durationClass: DurationClass;
  /** Competitors across every side, this worker included. */
  workersInMatch: number;
  stamina: number;
  style: RingStyle;
  traits: readonly TraitKey[];
  importance: EventImportance;
  /** The risk contributions that reach this worker, in order (`collectRiskContributions`). */
  contributions: readonly RiskContribution[];
  /** The booker asked for it to be kept safe. A contribution can switch it on as well. */
  keepItSafe: boolean;
  /** Matches this worker works earlier on the same card; 0 for the first. */
  matchesEarlierTonight: number;
}

const FATIGUE_BASE_KEYS = {
  short: 'match.fatigue.base.short',
  standard: 'match.fatigue.base.standard',
  long: 'match.fatigue.base.long',
} as const satisfies Readonly<Record<DurationClass, NumberTunableKey>>;

/** A one-on-one match: two workers carry the full workload between them. */
const FULL_WORKLOAD_WORKERS = 2;
/** The middle of the 0..100 stamina scale: stamina above it eases fatigue, below it adds. */
const STAMINA_MIDDLE = 50;

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];

/** "Second match tonight" for one earlier match. */
export function repeatMatchLabel(matchesEarlierTonight: number): string {
  const ordinal = ORDINALS[matchesEarlierTonight];
  return ordinal === undefined
    ? `Match ${String(matchesEarlierTonight + 1)} tonight`
    : `${ordinal} match tonight`;
}

/**
 * The repeat-match factor for a worker with `matchesEarlierTonight` earlier matches on the card:
 * `match.fatigue.repeatMatch ^ matchesEarlierTonight`. Fatigue and wear both use it.
 */
export function repeatMatchFactor(
  matchesEarlierTonight: number,
  tunables: EngineTunables,
): Traced<number> {
  const key = 'match.fatigue.repeatMatch';
  const perMatch = traced(tunables.get(key), tunableNode(tunables, key, 'Each extra match'));
  const earlier = matchesEarlierTonight === 1 ? 'match' : 'matches';
  return startCalc(repeatMatchLabel(matchesEarlierTonight), perMatch, { unit: 'multiplier' })
    .power(`${String(matchesEarlierTonight)} earlier ${earlier} tonight`, matchesEarlierTonight)
    .done();
}

/** Multiplies in the repeat-match factor when the worker has an earlier match on the card. */
export function applyRepeatMatch(
  calc: Calc,
  matchesEarlierTonight: number,
  tunables: EngineTunables,
): void {
  if (matchesEarlierTonight <= 0) {
    return;
  }
  const factor = repeatMatchFactor(matchesEarlierTonight, tunables);
  calc.multiply(
    `${repeatMatchLabel(matchesEarlierTonight)} ×${formatNumber(factor.value)}`,
    factor,
  );
}

/** The contribution that switched keep-it-safe on, if it was not the booker. */
export function keepItSafeSource(inputs: Pick<FatigueGainInputs, 'keepItSafe' | 'contributions'>): {
  on: boolean;
  label: string;
} {
  if (inputs.keepItSafe) {
    return { on: true, label: 'Keep it safe' };
  }
  const from = inputs.contributions.find((contribution) => contribution.keepItSafe === true);
  return from === undefined
    ? { on: false, label: 'Keep it safe' }
    : { on: true, label: `Keep it safe (${from.source})` };
}

function checkInputs(inputs: FatigueGainInputs): void {
  if (!Number.isInteger(inputs.workersInMatch) || inputs.workersInMatch < 1) {
    throw new InvalidArgumentError(
      'computeFatigueGain',
      'workersInMatch',
      inputs.workersInMatch,
      'a whole number of at least 1',
    );
  }
  if (!Number.isInteger(inputs.matchesEarlierTonight) || inputs.matchesEarlierTonight < 0) {
    throw new InvalidArgumentError(
      'computeFatigueGain',
      'matchesEarlierTonight',
      inputs.matchesEarlierTonight,
      'a whole number of at least 0',
    );
  }
}

/** `clamp(2 ÷ workers, minShare, 1)`. */
function workloadShare(workers: number, tunables: EngineTunables): Traced<number> {
  const share = startCalc('Share of the workload', 0, { unit: 'ratio', startLabel: 'Nothing yet' });
  share
    .add(
      'A one-on-one match',
      constantOf(
        'One-on-one workers',
        FULL_WORKLOAD_WORKERS,
        'A one-on-one match is the full workload',
      ),
    )
    .divide(`${String(workers)} workers share it`, workers)
    .max(
      'Smallest share',
      share.tunable(tunables, 'match.fatigue.minShare', 'Smallest share of the workload'),
    )
    .min('Never more than the full workload', 1);
  return share.done();
}

/** `1 − (stamina − 50) × staminaRelief`. */
function staminaFactor(name: string, stamina: number, tunables: EngineTunables): Traced<number> {
  const relief = startCalc('Stamina relief', stamina, {
    unit: 'ratio',
    startLabel: `${name}'s stamina`,
  });
  relief
    .subtract(
      'Middle of the scale',
      constantOf('Middle of the scale', STAMINA_MIDDLE, 'Stamina of 50 neither eases nor adds'),
    )
    .multiply(
      'Per point of stamina',
      relief.tunable(tunables, 'match.fatigue.staminaRelief', 'Stamina relief per point'),
    );
  return startCalc('Stamina factor', 1, { unit: 'multiplier', startLabel: 'No stamina effect' })
    .subtract('Stamina relief', relief.done())
    .done();
}

/**
 * Fatigue one worker gains in one match, in fatigue points:
 *
 * `base.<class> × share × (1 − (stamina − 50) × staminaRelief) × style.<style> × workhorse/coaster
 * × house show × each contribution's fatigueMultiplier × repeatMatch^earlier × keep it safe`,
 * kept within 0..`match.fatigue.maxPerSegment`. The first trace line names the duration class.
 *
 * @throws InvalidArgumentError for a `workersInMatch` below 1 or a negative `matchesEarlierTonight`.
 */
export function computeFatigueGain(
  inputs: FatigueGainInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  checkInputs(inputs);
  const { tunables } = deps;
  const baseKey = FATIGUE_BASE_KEYS[inputs.durationClass];
  const base = traced(
    tunables.get(baseKey),
    tunableNode(tunables, baseKey, `${DURATION_CLASS_LABELS[inputs.durationClass]} duration class`),
  );
  const calc = startCalc(`Fatigue gain for ${inputs.name}`, base, {
    unit: 'points',
    docRef: FATIGUE_GAIN_DOC_REF,
  });

  if (inputs.workersInMatch > FULL_WORKLOAD_WORKERS) {
    const label = `Shared workload (${String(inputs.workersInMatch)} workers)`;
    calc.branch(label, true).multiply(label, workloadShare(inputs.workersInMatch, tunables));
  }

  calc
    .multiply(
      `Stamina ${formatNumber(inputs.stamina)}`,
      staminaFactor(inputs.name, inputs.stamina, tunables),
    )
    .multiply(
      `${STYLE_LABELS[inputs.style]} style`,
      calc.tunable(tunables, `match.fatigue.style.${inputs.style}`),
    );

  if (inputs.traits.includes('workhorse')) {
    calc.multiply('Workhorse', calc.tunable(tunables, 'match.fatigue.workhorseFactor'));
  }
  if (inputs.traits.includes('coaster')) {
    calc.multiply('Coaster', calc.tunable(tunables, 'match.fatigue.coasterFactor'));
  }
  if (inputs.importance === 'house') {
    calc.multiply('House show', calc.tunable(tunables, 'match.fatigue.houseShowFactor'));
  }
  for (const contribution of inputs.contributions) {
    if (contribution.fatigueMultiplier !== undefined) {
      calc.multiply(contribution.source, contribution.fatigueMultiplier);
    }
  }
  applyRepeatMatch(calc, inputs.matchesEarlierTonight, tunables);
  const safe = keepItSafeSource(inputs);
  if (safe.on) {
    calc.multiply(safe.label, calc.tunable(tunables, 'match.fatigue.keepItSafeFactor'));
  }

  return calc
    .clamp(
      0,
      calc.tunable(tunables, 'match.fatigue.maxPerSegment'),
      'Between 0 and the most one match can add',
    )
    .done();
}
