/**
 * Average morale (DAY2-03): the mean morale of the people under contract, worked out role group
 * by role group ("Wrestlers: 44 contracts, average 12.0"), then notes naming the
 * `office.morale.namedInWhy` lowest so the Why? says who is pulling it down.
 *
 * Nobody under contract gives 0 with the note "Nobody is under contract"; the dashboard then shows
 * no value at all rather than a fake 0.
 *
 * Design: docs/design/office.md#kpis-and-deltas.
 */

import { startCalc, type Traced } from '../../../core/trace';
import { EMPLOYMENT_ROLES, type EmploymentRole } from '../../../model/entities/employment';
import type { EngineTunables } from '../../tunables';
import { ROLE_PLURAL_LABELS } from './rosterSize';

export const AVERAGE_MORALE_DOC_REF = 'office.md#kpis-and-deltas';

/** One contract as the formula needs it. */
export interface MoraleContract {
  readonly name: string;
  readonly role: EmploymentRole;
  readonly morale: number;
}

/** The plain inputs of {@link averageMorale}. */
export interface AverageMoraleInputs {
  readonly contracts: readonly MoraleContract[];
}

/** One decimal, always shown ("12.0", "-6.5"). */
function oneDecimal(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/** Lowest first, then by name, so the named people never depend on table order. */
function byMoraleThenName(left: MoraleContract, right: MoraleContract): number {
  if (left.morale !== right.morale) {
    return left.morale - right.morale;
  }
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

/** The mean morale of `contracts`, with each role group as a line. */
export function averageMorale(
  inputs: AverageMoraleInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { contracts } = inputs;
  const calc = startCalc('Average morale', 0, {
    unit: 'points',
    docRef: AVERAGE_MORALE_DOC_REF,
    startLabel: 'Morale added up',
  });
  if (contracts.length === 0) {
    return calc.note('Nobody is under contract').done();
  }
  for (const role of EMPLOYMENT_ROLES) {
    const group = contracts.filter((contract) => contract.role === role);
    if (group.length === 0) {
      continue;
    }
    const total = group.reduce((sum, contract) => sum + contract.morale, 0);
    const noun = group.length === 1 ? 'contract' : 'contracts';
    calc.add(
      `${ROLE_PLURAL_LABELS[role]}: ${String(group.length)} ${noun}, average ${oneDecimal(total / group.length)}`,
      total,
    );
  }
  calc.divide('Contracts', contracts.length);
  const named = calc.tunable(deps.tunables, 'office.morale.namedInWhy', 'Lowest morale named');
  const lowest = [...contracts].sort(byMoraleThenName).slice(0, named);
  for (const contract of lowest) {
    calc.note(`Low morale: ${contract.name} ${oneDecimal(contract.morale)}`);
  }
  return calc.done();
}
