/**
 * How a rival answers one of its workers' release requests (ECO4-03).
 *
 * The same keep rule as the simple rival renewal (`aiRenewalDecision`): a worker who holds one of
 * the promotion's titles (when `contracts.ai.keepChampions` is on) or is pushed at
 * `contracts.ai.keepPushAtOrAbove` or higher is kept, so the request is refused. Anyone else is let
 * go: the request is granted.
 *
 * Design: docs/design/contracts.md#rival-rules.
 */

import { startDecision } from '../../../core/trace/decision';
import type { Traced } from '../../../core/trace/types';
import type { Push } from '../../../model/entities/employment';
import type { EngineTunables } from '../../tunables';
import { PUSH_LABELS } from '../../workers/formulas/expectedPush';
import { isPushAtOrAbove } from './aiRenewalDecision';

export const RIVAL_RULES_DOC_REF = 'contracts.md#rival-rules';

export type AiReleaseChoice = 'grant' | 'refuse';

export interface AiReleaseInputs {
  readonly push: Push;
  /** The names of this promotion's titles the worker holds today. */
  readonly titles: readonly string[];
}

/** The rule texts the decision records. */
export const AI_RELEASE_RULES = Object.freeze({
  holdsTitle: (names: readonly string[]) => `Holds a title (${names.join(', ')})`,
  pushAtOrAbove: (push: Push, floor: Push) =>
    `Push ${PUSH_LABELS[push].toLowerCase()} at or above ${PUSH_LABELS[floor].toLowerCase()}`,
});

/** Decides one rival release request. Draws no random numbers. */
export function aiReleaseDecision(
  inputs: AiReleaseInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<AiReleaseChoice> {
  const { tunables } = deps;
  const decision = startDecision<AiReleaseChoice>('Rival answers a release request', {
    docRef: RIVAL_RULES_DOC_REF,
  });
  const keepChampions = decision.tunable(tunables, 'contracts.ai.keepChampions');
  const holds = inputs.titles.length > 0;
  if (keepChampions && holds) {
    decision.rule(AI_RELEASE_RULES.holdsTitle(inputs.titles), true);
    return decision.choose('refuse', 'Champions are always kept');
  }
  if (keepChampions) {
    decision.rule('Holds a title', false);
  } else if (holds) {
    decision.note('Holds a title, but champions are not kept by rule');
  }
  const floor = decision.tunable(tunables, 'contracts.ai.keepPushAtOrAbove');
  const pushed = isPushAtOrAbove(inputs.push, floor);
  decision.rule(AI_RELEASE_RULES.pushAtOrAbove(inputs.push, floor), pushed);
  if (pushed) {
    return decision.choose('refuse', 'Workers this high on the card are always kept');
  }
  return decision.choose('grant', 'Lets unhappy workers go');
}
