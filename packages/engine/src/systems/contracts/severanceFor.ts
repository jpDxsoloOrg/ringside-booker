/**
 * `severanceFor`: the one place that works out what ending a given contract costs today.
 *
 * It reads the contract (kind, wage or fee, end date, iron-clad perk, whether it has started, the
 * worker's morale) and hands it to the `severance` formula. The release preview, the release
 * command, `releaseEmployment` (ECO9 budget cuts, SOC6 conduct releases) and ECO4-03's granted
 * release requests all call it, so they can never disagree by a cent.
 *
 * Design: docs/design/contracts.md#severance.
 */

import { diffDays, type GameDate } from '../../core/date';
import { InvalidArgumentError } from '../../core/errors';
import type { EmploymentId } from '../../core/ids';
import type { Traced } from '../../core/trace/types';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import { startCalc } from '../../core/trace/calc';
import { severance } from './formulas/severance';

/** The share of normal severance a granted release request pays, as one tunable line. */
export function grantShare(tunables: EngineTunables): Traced<number> {
  const calc = startCalc('Agreed share', 0, {
    unit: 'ratio',
    docRef: 'contracts.md#unhappy-workers',
    startLabel: 'No share yet',
  });
  return calc
    .add('Share paid on a granted request', calc.tunable(tunables, 'contracts.quit.severanceShare'))
    .done();
}

/**
 * `release`: the promotion lets the worker go. `grant`: the promotion grants the worker's own
 * request to leave, paying `contracts.quit.severanceShare` of the normal amount ("Agreed share",
 * in place of the glad-to-go discount).
 */
export type SeveranceMode = 'release' | 'grant';

/**
 * The severance due if `employmentId` ended on `date`, in whole cents with its trace. Throws
 * `InvalidArgumentError` for an unknown employment.
 */
export function severanceFor(
  read: GameWorldView,
  employmentId: EmploymentId,
  date: GameDate,
  tunables: EngineTunables,
  mode: SeveranceMode,
): Traced<number> {
  const employment = read.tables.employments.get(employmentId);
  if (employment === undefined) {
    throw new InvalidArgumentError(
      'severanceFor',
      'employmentId',
      employmentId,
      'an existing employment',
    );
  }
  const { terms } = employment;
  return severance(
    {
      kind: terms.kind,
      monthlyWage: terms.monthlyWage,
      perAppearanceFee: terms.perAppearanceFee,
      daysOwed: employment.endsOn === null ? null : Math.max(0, diffDays(date, employment.endsOn)),
      ironClad: terms.perks.ironClad,
      started: employment.status === 'active',
      morale: employment.morale,
      shareOverride: mode === 'grant' ? grantShare(tunables) : null,
    },
    { tunables },
  );
}
