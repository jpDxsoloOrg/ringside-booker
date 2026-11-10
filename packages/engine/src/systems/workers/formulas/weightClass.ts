/**
 * Weight class: which of the five classes a weight falls in.
 *
 * The person row stores a weight in kilograms and never a class, so moving a limit moves people on
 * the next read with no data migration.
 *
 * Design: docs/design/workers.md#weight-class.
 */

import { startDecision, type Traced } from '../../../core/trace';
import type { EngineTunables, TunableKey } from '../../tunables';

export const WEIGHT_CLASSES = [
  'lightweight',
  'cruiserweight',
  'lightHeavyweight',
  'heavyweight',
  'superHeavyweight',
] as const;
export type WeightClass = (typeof WEIGHT_CLASSES)[number];

/** The class names as the player reads them. */
export const WEIGHT_CLASS_LABELS: Readonly<Record<WeightClass, string>> = {
  lightweight: 'Lightweight',
  cruiserweight: 'Cruiserweight',
  lightHeavyweight: 'Light heavyweight',
  heavyweight: 'Heavyweight',
  superHeavyweight: 'Super heavyweight',
};

export const WEIGHT_CLASS_DOC_REF = 'workers.md#weight-class';

/** What the formula needs to know about the person. */
export interface WeightClassInputs {
  /** Body weight in kilograms. */
  weightKg: number;
}

/** The classes that have an upper limit, lightest first, with the tunable that sets it. */
const LIMITED_CLASSES: readonly {
  readonly weightClass: Exclude<WeightClass, 'superHeavyweight'>;
  readonly limitKey: TunableKey & `workers.weightClass.${string}`;
}[] = [
  { weightClass: 'lightweight', limitKey: 'workers.weightClass.lightweightMaxKg' },
  { weightClass: 'cruiserweight', limitKey: 'workers.weightClass.cruiserweightMaxKg' },
  { weightClass: 'lightHeavyweight', limitKey: 'workers.weightClass.lightHeavyweightMaxKg' },
  { weightClass: 'heavyweight', limitKey: 'workers.weightClass.heavyweightMaxKg' },
];

function formatKg(weightKg: number): string {
  return `${String(weightKg)} kg`;
}

/**
 * The weight class for a weight: the first class, lightest first, whose upper limit the weight
 * does not exceed (a weight exactly on a limit is still in that class). Anyone over the
 * heavyweight limit is a super heavyweight.
 *
 * Every limit is read and checked on every call, so the trace always lists all four. A limit set
 * below the one before it is read as the one before it, with a note, so limits put out of order by
 * an override never throw and never leave a gap.
 */
export function weightClass(
  inputs: WeightClassInputs,
  deps: { tunables: EngineTunables },
): Traced<WeightClass> {
  const decision = startDecision<WeightClass>('Weight class', { docRef: WEIGHT_CLASS_DOC_REF });
  const weight = formatKg(inputs.weightKg);

  let chosen: WeightClass | null = null;
  let because = '';
  let previousLimit: number | null = null;
  let previousLabel = '';
  for (const { weightClass: candidate, limitKey } of LIMITED_CLASSES) {
    const label = WEIGHT_CLASS_LABELS[candidate];
    const ownLimit = decision.tunable(deps.tunables, limitKey, `${label} limit`);
    let limit = ownLimit;
    if (previousLimit !== null && ownLimit < previousLimit) {
      limit = previousLimit;
      decision.note(
        `The ${label} limit of ${formatKg(ownLimit)} is below the ${previousLabel} limit of ${formatKg(previousLimit)}, so ${formatKg(limit)} is used`,
      );
    }
    const over = inputs.weightKg > limit;
    decision.rule(`${weight} is over the ${label} limit of ${formatKg(limit)}`, over);
    if (!over && chosen === null) {
      chosen = candidate;
      because = `${weight} is within the ${label} limit of ${formatKg(limit)}`;
    }
    previousLimit = limit;
    previousLabel = label;
  }

  if (chosen === null) {
    return decision.choose(
      'superHeavyweight',
      `${weight} is over the ${previousLabel} limit of ${formatKg(previousLimit ?? 0)}`,
    );
  }
  return decision.choose(chosen, because);
}
