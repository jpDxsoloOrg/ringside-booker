/**
 * Injury time out: how many days an injury keeps someone out.
 *
 * Design: docs/design/health.md#injuries. The days are a roll inside the injury kind's catalog
 * range, scaled by the severity, the durable or injury-prone trait and the medical care the person
 * gets on the day they are hurt, rounded up and kept between 1 and `health.injury.maxDays`.
 */

import type { RngStream } from '../../../core/rng/registry';
import { rollInt } from '../../../core/rng/rolls';
import { startCalc } from '../../../core/trace/calc';
import { constantOf, traced } from '../../../core/trace/helpers';
import { tunableNode } from '../../../core/trace/tunable-node';
import type { RollNode, Traced } from '../../../core/trace/types';
import type { InjurySeverity } from '../../../model/catalogs';
import type { TraitKey } from '../../../model/entities/person';
import type { EngineTunables } from '../../tunables';
import type { MedicalLevel } from '../medical';
import { INJURY_DOC_REF, severityLabel } from './injurySeverity';

export interface InjuryDaysInputs {
  /** The injury kind's label and catalog range (both ends included). */
  kind: { label: string; minDays: number; maxDays: number };
  /** `decideInjurySeverity`'s result, attached to the severity step. */
  severity: Traced<InjurySeverity>;
  traits: readonly TraitKey[];
  /** The medical care the person gets today (`medicalLevelOf`). */
  medicalLevel: MedicalLevel;
  /** How that care reads in the Why?: `medicalCareLabel(level, promotion name)`. */
  medicalLabel: string;
}

export const NEITHER_TRAIT_BRANCH = 'Neither durable nor injury prone';
export const AT_LEAST_A_DAY = 'An injury always costs at least a day';

const SEVERITY_KEYS = {
  minor: 'health.injury.severityMultiplier.minor',
  moderate: 'health.injury.severityMultiplier.moderate',
  severe: 'health.injury.severityMultiplier.severe',
} as const;

const MEDICAL_KEYS = {
  0: 'health.medical.injuryMultiplier.level0',
  1: 'health.medical.injuryMultiplier.level1',
  2: 'health.medical.injuryMultiplier.level2',
  3: 'health.medical.injuryMultiplier.level3',
} as const;

/** "Sprained ankle: 7–21 days". */
export function catalogRangeLabel(kind: InjuryDaysInputs['kind']): string {
  return `${kind.label}: ${String(kind.minDays)}–${String(kind.maxDays)} days`;
}

/**
 * Days out: `ceil(roll × severity × trait × medical)`, kept between 1 and `health.injury.maxDays`.
 * Always draws exactly once from `deps.rng` (the catalog range roll).
 */
export function computeInjuryDays(
  inputs: InjuryDaysInputs,
  deps: { tunables: EngineTunables; rng: RngStream },
): Traced<number> {
  const { tunables } = deps;
  const rangeLabel = catalogRangeLabel(inputs.kind);
  const rolled = rollInt(deps.rng, inputs.kind.minDays, inputs.kind.maxDays, 'Catalog range');
  const rollNode: RollNode = {
    kind: 'roll',
    label: rangeLabel,
    value: rolled.value,
    roll: { ...rolled.roll },
  };
  const calc = startCalc('Days out', traced(rolled.value, rollNode), {
    unit: 'days',
    docRef: INJURY_DOC_REF,
  });

  const severity = inputs.severity.value;
  const severityKey = SEVERITY_KEYS[severity];
  const severityName = `${severityLabel(severity)} injury`;
  const severityFactor = tunables.get(severityKey);
  calc.multiply(
    severityName,
    traced(severityFactor, {
      kind: 'input',
      label: severityName,
      value: severityFactor,
      unit: 'multiplier',
      children: [inputs.severity.trace, tunableNode(tunables, severityKey, severityName)],
    }),
  );

  if (inputs.traits.includes('durable')) {
    calc
      .branch('Durable', true)
      .multiply('Durable', calc.tunable(tunables, 'health.injury.durableMultiplier', 'Durable'));
  } else if (inputs.traits.includes('injuryProne')) {
    calc
      .branch('Injury prone', true)
      .multiply(
        'Injury prone',
        calc.tunable(tunables, 'health.injury.injuryProneMultiplier', 'Injury prone'),
      );
  } else {
    calc.branch(NEITHER_TRAIT_BRANCH, true);
  }

  return calc
    .multiply(
      inputs.medicalLabel,
      calc.tunable(tunables, MEDICAL_KEYS[inputs.medicalLevel], inputs.medicalLabel),
    )
    .round('ceil')
    .max('At least a day', constantOf('At least a day', 1, AT_LEAST_A_DAY))
    .min('Longest time out', calc.tunable(tunables, 'health.injury.maxDays', 'Longest time out'))
    .done();
}
