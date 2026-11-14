/**
 * The built-in renewal policy `contracts.simpleRivalRenewal` (D-01 stopgap until ECO6).
 *
 * Once contracts expire, every roster in the world would shrink until the rival labour market
 * exists, so computer-run promotions renew by a simple, traced rule (`aiRenewalDecision`). It
 * answers null, so the next policy is asked (and with none, the contract expires), for:
 *
 * - closed promotions and open-ended contracts;
 * - whenever the Rival rules shortcut `ai.contracts.simpleRenewals` does not apply, as AIP1's
 *   `aiShortcut` decides (ECO4-05): promotions the player runs (their contracts are never renewed
 *   by this rule), the "Level playing field" setting, or the shortcut turned off.
 *
 * The shortcut's Why? is the first line of the renewal's Why?.
 *
 * Design: docs/design/contracts.md#simple-renewals.
 */

import { addDays, isAfter } from '../../core/date';
import { aiShortcut, registerAiShortcutConsumer } from '../aip/aiShortcut';
import { aiRenewalDecision } from './formulas/aiRenewalDecision';
import { registerRenewalPolicy, type RenewalPolicy } from './renewals';
import { AI_RENEWAL_STREAM } from './streams';
import { titlesHeldBy } from './titles';

export const SIMPLE_RIVAL_RENEWAL_POLICY_ID = 'contracts.simpleRivalRenewal';

/** The Rival rules shortcut this policy acts on. */
export const SIMPLE_RENEWALS_SHORTCUT_KEY = 'ai.contracts.simpleRenewals';

export const simpleRivalRenewalPolicy: RenewalPolicy = {
  id: SIMPLE_RIVAL_RENEWAL_POLICY_ID,
  order: 100,
  decide: (read, employment, date, deps) => {
    const promotion = read.tables.promotions.get(employment.promotionId);
    if (promotion === undefined || promotion.status === 'closed' || employment.endsOn === null) {
      return null;
    }
    const shortcut = aiShortcut(
      read,
      deps.tunables,
      employment.promotionId,
      SIMPLE_RENEWALS_SHORTCUT_KEY,
    );
    if (!shortcut.value) {
      return null;
    }
    const titlesHeld = titlesHeldBy(read, employment.personId, employment.promotionId).length;
    const { decision, days } = aiRenewalDecision(
      { push: employment.push, titlesHeld, shortcut },
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
registerAiShortcutConsumer({
  key: SIMPLE_RENEWALS_SHORTCUT_KEY,
  featureId: 'ECO4',
  label: 'Contract renewals',
});
