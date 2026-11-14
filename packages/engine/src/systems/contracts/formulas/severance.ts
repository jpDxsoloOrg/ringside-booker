/**
 * Severance: what letting someone go costs, worked out from the value left in their contract.
 *
 * The curve is front-loaded: the first `contracts.severance.fullMonths` months still owed are paid
 * in full, the owed months after that only at `contracts.severance.tailRate`, and owed months past
 * `contracts.severance.capMonths` not at all. So breaking a long deal costs more than breaking a
 * short one, but never the whole remaining wage. In order:
 *
 * 1. monthly value: the monthly wage (written, development and tour deals), or the appearance fee ×
 *    `contracts.severance.appearancesPerMonth` (per-appearance deals);
 * 2. months owed: days owed ÷ 30.4375 (an average month), or `contracts.severance.openEndedMonths`
 *    for an open-ended deal;
 * 3. months paid: min(owed, full) + max(0, min(owed, cap) − full) × tail rate;
 * 4. × the monthly value;
 * 5. × `contracts.severance.ironCladMultiplier` for an iron-clad contract;
 * 6. × a share given by the caller (a granted release request, ECO4-03), or else, for a worker
 *    whose morale is at or below `contracts.severance.mutualMorale`, × (1 −
 *    `contracts.severance.mutualDiscount`);
 * 7. × `contracts.severance.unstartedFactor` when the deal has not started yet;
 * 8. rounded down to whole cents, never below 0.
 *
 * Design: docs/design/contracts.md#severance.
 */

import { startCalc } from '../../../core/trace/calc';
import { constantOf } from '../../../core/trace/helpers';
import type { Traced } from '../../../core/trace/types';
import type { ContractKind } from '../../../model/entities/employment';
import type { EngineTunables } from '../../tunables';

export const SEVERANCE_FORMULA_DOC_REF = 'contracts.md#severance';

/** Days in an average month: 365.25 ÷ 12. */
export const DAYS_PER_MONTH = 365.25 / 12;

export interface SeveranceInputs {
  readonly kind: ContractKind;
  /** Cents a month (0 on a per-appearance deal). */
  readonly monthlyWage: number;
  /** Cents an appearance. */
  readonly perAppearanceFee: number;
  /** Days left until the end date, or null for an open-ended deal. */
  readonly daysOwed: number | null;
  readonly ironClad: boolean;
  /** False for a signed deal that has not started yet. */
  readonly started: boolean;
  /** The worker's morale under this contract, −100 to 100. */
  readonly morale: number;
  /** A share that replaces the "glad to go" discount (a granted release request), or null. */
  readonly shareOverride: Traced<number> | null;
}

export interface SeveranceDeps {
  readonly tunables: EngineTunables;
}

/** "6.9": one decimal place, without a trailing ".0". */
function oneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function percent(ratio: number): string {
  return `${oneDecimal(ratio * 100)}%`;
}

function monthWord(count: number): string {
  return count === 1 ? 'month' : 'months';
}

function signed(value: number): string {
  return value < 0 ? `−${String(Math.abs(value))}` : String(value);
}

/** Step 1: what one month of this contract is worth, in cents. */
function monthlyValue(inputs: SeveranceInputs, tunables: EngineTunables): Traced<number> {
  if (inputs.kind !== 'perAppearance') {
    return startCalc('Monthly value', inputs.monthlyWage, {
      unit: 'money',
      docRef: SEVERANCE_FORMULA_DOC_REF,
      startLabel: 'Monthly wage',
    }).done();
  }
  const calc = startCalc('Monthly value', inputs.perAppearanceFee, {
    unit: 'money',
    docRef: SEVERANCE_FORMULA_DOC_REF,
    startLabel: 'Fee per appearance',
  });
  return calc
    .multiply(
      'Appearances a month',
      calc.tunable(tunables, 'contracts.severance.appearancesPerMonth'),
    )
    .done();
}

/** Step 2: how many months are still owed. */
function monthsOwed(inputs: SeveranceInputs, tunables: EngineTunables): Traced<number> {
  if (inputs.daysOwed === null) {
    const calc = startCalc('Months owed', 0, {
      unit: 'months',
      docRef: SEVERANCE_FORMULA_DOC_REF,
      startLabel: 'No end date',
    });
    calc.branch('Open-ended contract', true);
    return calc
      .add(
        'Months counted for an open-ended deal',
        calc.tunable(tunables, 'contracts.severance.openEndedMonths'),
      )
      .done();
  }
  return startCalc('Months owed', Math.max(0, inputs.daysOwed), {
    unit: 'months',
    docRef: SEVERANCE_FORMULA_DOC_REF,
    startLabel: 'Days left on the contract',
  })
    .divide(
      'Days in a month',
      constantOf('Average month', DAYS_PER_MONTH, 'Average month: 365.25 ÷ 12 days'),
    )
    .done();
}

/** Step 3: the owed months that are paid, after the full months, the tail rate and the cap. */
function monthsPaid(owed: Traced<number>, tunables: EngineTunables): Traced<number> {
  const full = tunables.get('contracts.severance.fullMonths');
  const cap = tunables.get('contracts.severance.capMonths');
  const tailRate = tunables.get('contracts.severance.tailRate');

  const inFull = startCalc('Months paid in full', owed, {
    unit: 'months',
    docRef: SEVERANCE_FORMULA_DOC_REF,
  });
  const fullLimit = inFull.tunable(tunables, 'contracts.severance.fullMonths');
  const fullPart = inFull.min(`First ${String(full)} ${monthWord(full)} in full`, fullLimit).done();

  const tailMonths = Math.max(0, Math.min(owed.value, cap) - full);
  const inPart = startCalc('Months paid in part', owed, {
    unit: 'months',
    docRef: SEVERANCE_FORMULA_DOC_REF,
  });
  inPart.min('Up to the cap', inPart.tunable(tunables, 'contracts.severance.capMonths'));
  inPart.subtract(
    'Already paid in full',
    inPart.tunable(tunables, 'contracts.severance.fullMonths'),
  );
  inPart.max('Never below zero', 0);
  inPart.multiply(
    `Next ${oneDecimal(tailMonths)} ${monthWord(tailMonths)} at ${percent(tailRate)}`,
    inPart.tunable(tunables, 'contracts.severance.tailRate'),
  );
  const tailPart = inPart.done();

  const paid = startCalc('Months paid', fullPart, {
    unit: 'months',
    docRef: SEVERANCE_FORMULA_DOC_REF,
  }).add('Months paid in part', tailPart);
  if (owed.value > cap) {
    paid.note(`Beyond ${String(cap)} ${monthWord(cap)}: not paid`);
  }
  return paid.done();
}

/** Severance in whole cents, with every step traced. */
export function severance(inputs: SeveranceInputs, deps: SeveranceDeps): Traced<number> {
  const { tunables } = deps;
  const value = monthlyValue(inputs, tunables);
  const owed = monthsOwed(inputs, tunables);
  const paid = monthsPaid(owed, tunables);

  const calc = startCalc('Severance', value, {
    unit: 'money',
    docRef: SEVERANCE_FORMULA_DOC_REF,
  }).multiply('Months paid', paid);

  calc.branch('Iron-clad contract', inputs.ironClad);
  if (inputs.ironClad) {
    calc.multiply(
      'Iron-clad contract',
      calc.tunable(tunables, 'contracts.severance.ironCladMultiplier'),
    );
  }

  if (inputs.shareOverride !== null) {
    calc.multiply('Agreed share', inputs.shareOverride);
  } else {
    const mutualMorale = tunables.get('contracts.severance.mutualMorale');
    const glad = inputs.morale <= mutualMorale;
    calc.branch(`Glad to go (morale ${signed(inputs.morale)})`, glad);
    if (glad) {
      const discount = calc.tunable(tunables, 'contracts.severance.mutualDiscount');
      calc.multiply(`Glad to go (morale ${signed(inputs.morale)})`, 1 - discount);
    }
  }

  calc.branch("Deal hasn't started", !inputs.started);
  if (!inputs.started) {
    calc.multiply(
      "Deal hasn't started",
      calc.tunable(tunables, 'contracts.severance.unstartedFactor'),
    );
  }

  return calc.round('floor', 'To whole cents').max('Never below zero', 0).done();
}
