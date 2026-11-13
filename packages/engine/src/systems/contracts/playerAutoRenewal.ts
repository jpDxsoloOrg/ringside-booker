/**
 * The built-in renewal policy `contracts.playerAutoRenewal`: a TEMPORARY stopgap until ECO5.
 *
 * Contracts now run out (ECO4-01), but the player has no way to renew one until ECO5's renewal
 * talks. Without this policy a three-year game would empty the player's roster. So, while
 * `contracts.autoRenewPlayer` is on (the default), a contract of a promotion the player runs that
 * reaches its end date renews on the same terms for `contracts.autoRenewPlayerDays` more days (a
 * year by default; a renewal only moves `endsOn`, so the length of the last term is not known). It
 * goes through the renewal registry like any renewal: the lifecycle writes the new end date,
 * records the Why? and publishes `contract.renewed` (source `player`).
 *
 * It answers null (so the next policy is asked and, with none, the contract expires) for computer
 * promotions, closed promotions, open-ended contracts and when the tunable is off.
 *
 * ECO5-05 removes this policy or defaults the tunable to off once the player can renew.
 * Design: docs/design/contracts.md#player-renewals.
 */

import { addDays, isAfter } from '../../core/date';
import { startCalc } from '../../core/trace/calc';
import { startDecision } from '../../core/trace/decision';
import { registerRenewalPolicy, type RenewalPolicy } from './renewals';

export const PLAYER_AUTO_RENEWAL_POLICY_ID = 'contracts.playerAutoRenewal';
export const PLAYER_RENEWALS_DOC_REF = 'contracts.md#player-renewals';

/** The line the Why? and the news use for this renewal. */
export const PLAYER_AUTO_RENEWAL_NOTE =
  'Renewed automatically on the same terms, until you can renew contracts yourself';

export const playerAutoRenewalPolicy: RenewalPolicy = {
  id: PLAYER_AUTO_RENEWAL_POLICY_ID,
  // Before the rival rule (100). ECO5's own player policy should sit lower still.
  order: 50,
  decide: (read, employment, date, deps) => {
    const promotion = read.tables.promotions.get(employment.promotionId);
    if (
      promotion?.controller.kind !== 'human' ||
      promotion.status === 'closed' ||
      employment.endsOn === null ||
      !deps.tunables.get('contracts.autoRenewPlayer')
    ) {
      return null;
    }
    const calc = startCalc('New contract length', 0, {
      unit: 'days',
      docRef: PLAYER_RENEWALS_DOC_REF,
      startLabel: 'No days yet',
    });
    const days = calc
      .add(
        'Days added by an automatic renewal',
        calc.tunable(deps.tunables, 'contracts.autoRenewPlayerDays'),
      )
      .done();
    const length = days.value;
    // On a normal day the old end date is today; a save loaded long after it counts from today.
    const fromEnd = addDays(employment.endsOn, length);
    const endsOn = isAfter(fromEnd, date) ? fromEnd : addDays(date, length);
    const decision = startDecision<'renew'>('Automatic renewal', {
      docRef: PLAYER_RENEWALS_DOC_REF,
    });
    decision.tunable(deps.tunables, 'contracts.autoRenewPlayer');
    decision.note(PLAYER_AUTO_RENEWAL_NOTE);
    decision.include('New contract length', days);
    return {
      renew: true,
      endsOn,
      trace: decision.choose('renew', 'Your contracts renew automatically for now').trace,
    };
  },
};

registerRenewalPolicy(playerAutoRenewalPolicy);
