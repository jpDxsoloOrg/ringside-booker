/**
 * The built-in renewal policy `contracts.simpleRivalRenewal` (D-01 stopgap until ECO6).
 *
 * Once contracts expire, every roster in the world would shrink until the rival labour market
 * exists, so computer-run promotions renew by a simple, traced rule (`aiRenewalDecision`). It
 * answers null, so the next policy is asked (and with none, the contract expires), for:
 *
 * - promotions the player runs: their contracts are never renewed automatically;
 * - any promotion when `ai.contracts.simpleRenewals` is off;
 * - any promotion under the "Level playing field" setting (ECO4-05 moves this read to AIP1's
 *   `aiShortcut`).
 *
 * Design: docs/design/contracts.md#simple-renewals.
 */

import { addDays, isAfter } from '../../core/date';
import { aiRenewalDecision } from './formulas/aiRenewalDecision';
import { registerRenewalPolicy, type RenewalPolicy } from './renewals';
import { AI_RENEWAL_STREAM } from './streams';
import { titlesHeldBy } from './titles';

export const SIMPLE_RIVAL_RENEWAL_POLICY_ID = 'contracts.simpleRivalRenewal';

export const simpleRivalRenewalPolicy: RenewalPolicy = {
  id: SIMPLE_RIVAL_RENEWAL_POLICY_ID,
  order: 100,
  decide: (read, employment, date, deps) => {
    const promotion = read.tables.promotions.get(employment.promotionId);
    if (
      promotion === undefined ||
      promotion.controller.kind !== 'computer' ||
      promotion.status === 'closed' ||
      employment.endsOn === null ||
      !deps.tunables.get('ai.contracts.simpleRenewals') ||
      read.meta.settings.levelPlayingField
    ) {
      return null;
    }
    const titlesHeld = titlesHeldBy(read, employment.personId, employment.promotionId).length;
    const { decision, days } = aiRenewalDecision(
      { push: employment.push, titlesHeld },
      { tunables: deps.tunables, stream: deps.rng(AI_RENEWAL_STREAM) },
    );
    if (decision.value === 'letGo' || days === null) {
      return { renew: false };
    }
    // The old end date is today on a normal day; a save loaded long after a contract's end date
    // counts the new length from today, so the renewed contract still runs into the future.
    const fromEnd = addDays(employment.endsOn, days.value);
    const endsOn = isAfter(fromEnd, date) ? fromEnd : addDays(date, days.value);
    return { renew: true, endsOn, trace: decision.trace };
  },
};

registerRenewalPolicy(simpleRivalRenewalPolicy);
