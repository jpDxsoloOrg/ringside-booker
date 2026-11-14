/**
 * Starting patience: how many offers that do not please them a worker sits through before they
 * walk away (ECO5-03 spends it).
 *
 * `contracts.patience.base`, − `contracts.patience.egotist` for an egotist, +
 * `contracts.patience.professional` for a professional, − `contracts.patience.unhappyPenalty`
 * when renewing below `contracts.renewal.unhappyMorale`, plus each registered patience modifier;
 * kept within 0..`contracts.patience.max` and rounded down. 0 means no counter-offers at all.
 *
 * Design: docs/design/negotiation.md#patience.
 */

import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import type { TraitKey } from '../../../model/entities/person';
import type { EngineTunables } from '../../tunables';
import { PATIENCE_DOC_REF, signedText } from './shared';

export interface StartPatienceInputs {
  readonly traits: readonly TraitKey[];
  /** The morale under the contract being renewed, or null for a signing. */
  readonly renewalMorale: number | null;
  /** Registered patience modifiers, added in order. */
  readonly modifiers: readonly Traced<number>[];
}

/** The patience a worker starts a negotiation with, a whole number, every step traced. */
export function startPatience(
  inputs: StartPatienceInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc('Patience', 0, {
    unit: 'count',
    docRef: PATIENCE_DOC_REF,
    startLabel: 'Nothing yet',
  });
  calc.add('Usual patience', calc.tunable(tunables, 'contracts.patience.base'));

  const egotist = inputs.traits.includes('egotist');
  calc.branch('Egotist', egotist);
  if (egotist) {
    calc.subtract('Egotist', calc.tunable(tunables, 'contracts.patience.egotist'));
  }
  const professional = inputs.traits.includes('professional');
  calc.branch('Professional', professional);
  if (professional) {
    calc.add('Professional', calc.tunable(tunables, 'contracts.patience.professional'));
  }
  if (inputs.renewalMorale !== null) {
    const unhappy = inputs.renewalMorale < tunables.get('contracts.renewal.unhappyMorale');
    const label = `Morale ${signedText(inputs.renewalMorale)}: unhappy here`;
    calc.branch(label, unhappy);
    if (unhappy) {
      calc.subtract(label, calc.tunable(tunables, 'contracts.patience.unhappyPenalty'));
    }
  }
  for (const modifier of inputs.modifiers) {
    calc.add(modifier.trace.label, modifier);
  }
  calc.max('At least none', 0);
  calc.min('Most patience anyone has', calc.tunable(tunables, 'contracts.patience.max'));
  return calc.round('floor').done();
}
