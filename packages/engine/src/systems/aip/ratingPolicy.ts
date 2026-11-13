/**
 * The rival desk's rating policy (AIP1-07): MTCH1's policy door, answered from the Rival rules.
 *
 * MTCH1 never looks at who controls a promotion (D-01); it asks the one registered provider. This
 * is that provider: it asks `aiShortcut` for the score bonus, simpler booking and no in-match
 * injuries, so a promotion the player runs, and every promotion under the Level playing field,
 * gets the full rules. It registers itself on import, once (the registry throws on a second), and
 * registers MTCH1 as the consumer of the two shortcuts a rating acts on, and MTCH4 for
 * `ai.skipInMatchInjuries` (its in-match injuries read the policy on show night, MTCH4-04).
 *
 * Design: docs/design/rival-desk.md#shortcuts, docs/design/match-rating.md#the-policy-door-d-01.
 */

import type { PromotionId } from '../../core/ids';
import type { GameWorldView } from '../../model/tables';
import { DEFAULT_POLICY_LABEL } from '../match/formulas/segmentScore';
import { registerRatingPolicyProvider, type RatingPolicy } from '../match/rating/policy';
import type { EngineTunables } from '../tunables';
import { aiShortcut, registerAiShortcutConsumer } from './aiShortcut';
import { AI_SHORTCUTS } from './shortcuts';

/** The policy's name when any shortcut applies. */
export const RIVAL_POLICY_LABEL = 'Rival shortcuts';
/** The policy's name when none does: the same words as MTCH1's neutral policy. */
export const FULL_RULES_POLICY_LABEL = 'Full rules';
/** The score line's text when shortcuts apply but the bonus is 0. */
export const NO_RIVAL_BONUS_LINE = 'No rival score bonus';

/** The id the provider registers under, so a second registration names it. */
export const RIVAL_RATING_POLICY_ID = 'aip.ratingPolicy';

/** One policy line for a shortcut that applies, such as "Rival shortcut: Score bonus". */
export function rivalShortcutLine(label: string): string {
  return `Rival shortcut: ${label}`;
}

/**
 * The rating policy for `promotionId`. `lines[0]` titles the score's policy line, so it is always
 * about the bonus; one more line follows for each other shortcut that applies.
 */
export function rivalRatingPolicy(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
): RatingPolicy {
  const scoreBonus = aiShortcut(read, tunables, promotionId, 'ai.scoreBonus');
  const simpleInputs = aiShortcut(read, tunables, promotionId, 'ai.simpleBookingInputs').value;
  const skipInMatchInjuries = aiShortcut(
    read,
    tunables,
    promotionId,
    'ai.skipInMatchInjuries',
  ).value;
  const anyOn = scoreBonus.value > 0 || simpleInputs || skipInMatchInjuries;
  if (!anyOn) {
    return {
      scoreBonus,
      simpleInputs,
      skipInMatchInjuries,
      label: FULL_RULES_POLICY_LABEL,
      lines: [DEFAULT_POLICY_LABEL],
    };
  }
  const lines = [
    scoreBonus.value > 0
      ? rivalShortcutLine(AI_SHORTCUTS['ai.scoreBonus'].label)
      : NO_RIVAL_BONUS_LINE,
  ];
  if (simpleInputs) {
    lines.push(rivalShortcutLine(AI_SHORTCUTS['ai.simpleBookingInputs'].label));
  }
  if (skipInMatchInjuries) {
    lines.push(rivalShortcutLine(AI_SHORTCUTS['ai.skipInMatchInjuries'].label));
  }
  return { scoreBonus, simpleInputs, skipInMatchInjuries, label: RIVAL_POLICY_LABEL, lines };
}

/** The feature id and label the rules screen shows for the rating's shortcuts. */
const MATCH_RATINGS = { featureId: 'MTCH1', label: 'Match ratings' } as const;

registerRatingPolicyProvider(rivalRatingPolicy, { id: RIVAL_RATING_POLICY_ID, builtIn: true });
registerAiShortcutConsumer({ key: 'ai.scoreBonus', ...MATCH_RATINGS });
registerAiShortcutConsumer({ key: 'ai.simpleBookingInputs', ...MATCH_RATINGS });
// MTCH4-04: show night's physical toll reads `skipInMatchInjuries` from this policy for every match.
registerAiShortcutConsumer({
  key: 'ai.skipInMatchInjuries',
  featureId: 'MTCH4',
  label: 'Match injuries',
});
