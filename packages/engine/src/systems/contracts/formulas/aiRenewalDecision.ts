/**
 * The simple rival renewal (D-01 stopgap until ECO6): whether a computer-run promotion renews a
 * contract that has reached its end date, and for how long.
 *
 * A worker who holds one of the promotion's titles (when `contracts.ai.keepChampions` is on) or is
 * pushed at `contracts.ai.keepPushAtOrAbove` or higher is always renewed. Anyone else is renewed on
 * a `contracts.ai.renewChance` roll. A renewal adds a rolled number of days, from
 * `contracts.ai.renewMinDays` to `contracts.ai.renewMaxDays` (a minimum above the maximum is read
 * as the swapped range), to the old end date.
 *
 * Design: docs/design/contracts.md#simple-renewals.
 */

import type { RngStream } from '../../../core/rng/registry';
import { rollChance, rollInt } from '../../../core/rng/rolls';
import { startCalc } from '../../../core/trace/calc';
import { startDecision } from '../../../core/trace/decision';
import type { Traced } from '../../../core/trace/types';
import { PUSH_LEVELS, type Push } from '../../../model/entities/employment';
import type { EngineTunables } from '../../tunables';
import { PUSH_LABELS } from '../../workers/formulas/expectedPush';

export const SIMPLE_RENEWALS_DOC_REF = 'contracts.md#simple-renewals';

export type AiRenewalChoice = 'renew' | 'letGo';

export interface AiRenewalInputs {
  /** The worker's card position under this contract. */
  readonly push: Push;
  /** How many of this promotion's titles the worker holds today (`titlesHeldBy`). */
  readonly titlesHeld: number;
  /**
   * The Rival rules shortcut that let this rule run (`aiShortcut`, ECO4-05), shown as the Why?'s
   * first line. Left out (tests of the formula alone): no line.
   */
  readonly shortcut?: Traced<boolean>;
}

export interface AiRenewalResult {
  readonly decision: Traced<AiRenewalChoice>;
  /** The new contract's length in days when renewed, with its trace; null when let go. */
  readonly days: Traced<number> | null;
}

/** The rule labels the decision records. */
export const AI_RENEWAL_RULES = Object.freeze({
  holdsTitle: 'Holds a title',
  pushAtOrAbove: (push: Push) => `Push at or above ${PUSH_LABELS[push].toLowerCase()}`,
});

/** True when `push` is `floor` or higher on the card. */
export function isPushAtOrAbove(push: Push, floor: Push): boolean {
  return PUSH_LEVELS.indexOf(push) <= PUSH_LEVELS.indexOf(floor);
}

/** The new contract's length: one roll between the tunable ends, as a replayable calculation. */
export function computeRenewalDays(tunables: EngineTunables, stream: RngStream): Traced<number> {
  const first = tunables.get('contracts.ai.renewMinDays');
  const second = tunables.get('contracts.ai.renewMaxDays');
  const rolled = rollInt(
    stream,
    Math.min(first, second),
    Math.max(first, second),
    'New contract length',
  );
  return startCalc('New contract length', 0, {
    unit: 'days',
    docRef: SIMPLE_RENEWALS_DOC_REF,
    startLabel: 'No days yet',
  })
    .roll(rolled.roll)
    .add('Days rolled', rolled.value)
    .done();
}

/**
 * Decides one rival renewal. Keepers draw once (the length); anyone else draws the renewal roll
 * and, when renewed, the length.
 */
export function aiRenewalDecision(
  inputs: AiRenewalInputs,
  deps: { readonly tunables: EngineTunables; readonly stream: RngStream },
): AiRenewalResult {
  const { tunables, stream } = deps;
  const decision = startDecision<AiRenewalChoice>('Rival renewal', {
    docRef: SIMPLE_RENEWALS_DOC_REF,
  });
  if (inputs.shortcut !== undefined) {
    decision.include(inputs.shortcut.trace.label, inputs.shortcut);
  }
  const keepChampions = decision.tunable(tunables, 'contracts.ai.keepChampions');
  const champion = keepChampions && inputs.titlesHeld > 0;
  decision.rule(AI_RENEWAL_RULES.holdsTitle, champion);
  if (!keepChampions && inputs.titlesHeld > 0) {
    decision.note('Holds a title, but champions are not kept by rule');
  }
  const floor = decision.tunable(tunables, 'contracts.ai.keepPushAtOrAbove');
  const pushed = isPushAtOrAbove(inputs.push, floor);
  decision.rule(AI_RENEWAL_RULES.pushAtOrAbove(floor), pushed);

  if (champion || pushed) {
    const days = computeRenewalDays(tunables, stream);
    decision.include('New contract length', days);
    return {
      decision: decision.choose(
        'renew',
        champion ? 'Champions are always kept' : 'Workers this high on the card are always kept',
      ),
      days,
    };
  }

  const renewChance = decision.tunable(tunables, 'contracts.ai.renewChance');
  const roll = rollChance(stream, renewChance, 'Renewal chance');
  decision.roll(roll.roll);
  if (!roll.value) {
    return { decision: decision.choose('letGo', 'The renewal roll failed'), days: null };
  }
  const days = computeRenewalDays(tunables, stream);
  decision.include('New contract length', days);
  return { decision: decision.choose('renew', 'The renewal roll passed'), days };
}
