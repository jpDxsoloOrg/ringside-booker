/**
 * Asking fee: what a worker asks for each appearance on a per-appearance deal.
 *
 * 1. the monthly ask × `contracts.ask.perAppearanceShare`;
 * 2. at least `contracts.ask.minFee`, at most `contracts.ask.maxFee`;
 * 3. rounded to the nearest $10;
 * 4. at least the fee of their current per-appearance deal with this promotion (never a rival's).
 *
 * Design: docs/design/negotiation.md#asking-terms.
 */

import { startCalc } from '../../../core/trace/calc';
import { constantOf } from '../../../core/trace/helpers';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';
import { ASKING_TERMS_DOC_REF } from './shared';

export interface AskingFeeInputs {
  /** The worker's monthly ask from `askingWage`, in cents. */
  readonly monthlyAsk: Traced<number>;
  /** The fee of their current per-appearance deal with this promotion, or null. */
  readonly currentFeeFloor: number | null;
}

export const CURRENT_FEE_FLOOR_LABEL = "Won't take less than their current fee with you";
export const TENS_REASON = 'Fees are quoted in tens';

/** $10 in cents: the step fees are quoted in. */
const TEN_DOLLARS = 1_000;

/** The fee a worker asks per appearance, in whole cents, every step traced. */
export function askingFee(
  inputs: AskingFeeInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc('Asking fee per appearance', inputs.monthlyAsk, {
    unit: 'money',
    docRef: ASKING_TERMS_DOC_REF,
  });
  calc.multiply(
    'Share of the monthly ask per appearance',
    calc.tunable(tunables, 'contracts.ask.perAppearanceShare'),
  );
  calc.max('Least anyone asks', calc.tunable(tunables, 'contracts.ask.minFee'));
  calc.min('Most anyone asks', calc.tunable(tunables, 'contracts.ask.maxFee'));
  const ten = constantOf('$10', TEN_DOLLARS, TENS_REASON);
  calc.divide('In tens', ten).round('round', TENS_REASON).multiply('Back to cents', ten);
  if (inputs.currentFeeFloor !== null) {
    calc.max(CURRENT_FEE_FLOOR_LABEL, inputs.currentFeeFloor);
  }
  return calc.done();
}
