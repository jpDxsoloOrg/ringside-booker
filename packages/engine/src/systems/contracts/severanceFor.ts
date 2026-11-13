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
import { severance } from './formulas/severance';

/**
 * `release`: the promotion lets the worker go. `grant`: the promotion grants the worker's own
 * request to leave (ECO4-03 adds its share tunable and the line it adds; until then it is refused).
 */
export type SeveranceMode = 'release' | 'grant';

/**
 * The severance due if `employmentId` ended on `date`, in whole cents with its trace. Throws
 * `InvalidArgumentError` for an unknown employment and, until ECO4-03, for `grant`.
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
  if (mode === 'grant') {
    // ECO4-03 adds `contracts.quit.severanceShare` and passes it here as the share line.
    throw new InvalidArgumentError(
      'severanceFor',
      'mode',
      mode,
      'release (grant arrives with ECO4-03)',
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
      shareOverride: null,
    },
    { tunables },
  );
}
