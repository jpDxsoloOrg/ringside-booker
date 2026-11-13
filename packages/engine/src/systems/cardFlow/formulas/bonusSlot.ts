/**
 * The bonus slot (D-10): a regular, major or flagship show of a promotion whose production ceiling
 * reaches `production.bonusSlotThreshold` gets one extra main-card slot, never past 12.
 *
 * Design: docs/design/card-flow.md#bonus-slot.
 */

import type { PromotionId } from '../../../core/ids';
import { startDecision, type Traced } from '../../../core/trace';
import {
  EVENT_IMPORTANCES,
  SHOW_SLOTS_MAX,
  type EventImportance,
} from '../../../model/entities/event-definition';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import {
  ceilingLevelsOf,
  productionCeilingOf,
  productionCeilingValue,
} from './productionCeiling';

export const BONUS_SLOT_DOC_REF = 'docs/design/card-flow.md#bonus-slot';

/** Why a show can never have more than {@link SHOW_SLOTS_MAX} main slots. */
export const SHOW_SLOTS_MAX_REASON = 'the show format allows 3 to 12 main slots';

export type BonusSlotOutcome = 'bonusSlot' | 'standard';

export interface BonusSlotInputs {
  promotionId: PromotionId;
  importance: EventImportance;
  /** The main-card slots the show has without the bonus (its definition's). */
  baseSlots: number;
}

export interface BonusSlotResult {
  /** `baseSlots`, plus one when the show gets the bonus slot. */
  slots: number;
  decision: Traced<BonusSlotOutcome>;
}

const IMPORTANCE_NAMES: Readonly<Record<EventImportance, string>> = {
  house: 'house show',
  minor: 'minor show',
  regular: 'regular show',
  major: 'major show',
  flagship: 'flagship show',
};

function isAtLeast(importance: EventImportance, smallest: EventImportance): boolean {
  return EVENT_IMPORTANCES.indexOf(importance) >= EVENT_IMPORTANCES.indexOf(smallest);
}

/**
 * Whether a show gets the bonus slot, without building a trace: the same three rules as
 * {@link bonusSlotFor}, for the paths that run over every scheduled show.
 */
export function qualifiesForBonusSlot(
  ceiling: number,
  importance: EventImportance,
  baseSlots: number,
  tunables: EngineTunables,
): boolean {
  return (
    isAtLeast(importance, tunables.get('production.bonusSlotMinImportance')) &&
    ceiling >= tunables.get('production.bonusSlotThreshold') &&
    baseSlots < SHOW_SLOTS_MAX
  );
}

/** The untraced main-slot count of a show: {@link bonusSlotFor}'s `slots` without its trace. */
export function bonusSlotCount(
  read: GameWorldView,
  inputs: BonusSlotInputs,
  tunables: EngineTunables,
): number {
  const ceiling = productionCeilingValue(ceilingLevelsOf(read, inputs.promotionId), tunables);
  return qualifiesForBonusSlot(ceiling, inputs.importance, inputs.baseSlots, tunables)
    ? inputs.baseSlots + 1
    : inputs.baseSlots;
}

/**
 * The show's main-slot count and the traced decision. Rules, in order, stopping at the first that
 * fails: the show is at least `production.bonusSlotMinImportance`; the promotion's production
 * ceiling (its trace attached) reaches `production.bonusSlotThreshold`; the show has fewer than
 * {@link SHOW_SLOTS_MAX} main slots. All pass: `bonusSlot`; else `standard`, naming the failed rule.
 */
export function bonusSlotFor(
  read: GameWorldView,
  inputs: BonusSlotInputs,
  tunables: EngineTunables,
): BonusSlotResult {
  const decision = startDecision<BonusSlotOutcome>('Bonus slot', { docRef: BONUS_SLOT_DOC_REF });
  const standard = (because: string): BonusSlotResult => ({
    slots: inputs.baseSlots,
    decision: decision.choose('standard', because),
  });

  const smallest = decision.tunable(
    tunables,
    'production.bonusSlotMinImportance',
    'Smallest show that can get it',
  );
  const bigEnough = isAtLeast(inputs.importance, smallest);
  const importanceRule = `A ${IMPORTANCE_NAMES[inputs.importance]} is a ${IMPORTANCE_NAMES[smallest]} or bigger`;
  decision.rule(importanceRule, bigEnough);
  if (!bigEnough) {
    return standard(`Only a ${IMPORTANCE_NAMES[smallest]} or bigger gets the extra slot`);
  }

  const ceiling = productionCeilingOf(read, inputs.promotionId, tunables);
  decision.include('Production ceiling', ceiling);
  const threshold = decision.tunable(
    tunables,
    'production.bonusSlotThreshold',
    'Ceiling needed for the extra slot',
  );
  const highEnough = ceiling.value >= threshold;
  decision.rule(
    `Production ceiling ${formatNumber(ceiling.value)} reaches ${formatNumber(threshold)}`,
    highEnough,
  );
  if (!highEnough) {
    return standard(`The production ceiling is below ${formatNumber(threshold)}`);
  }

  const roomLeft = inputs.baseSlots < SHOW_SLOTS_MAX;
  decision.rule(
    `${formatNumber(inputs.baseSlots)} main slots is fewer than ${formatNumber(SHOW_SLOTS_MAX)} (${SHOW_SLOTS_MAX_REASON})`,
    roomLeft,
  );
  if (!roomLeft) {
    return standard(`The show already has ${formatNumber(SHOW_SLOTS_MAX)} main slots`);
  }
  return {
    slots: inputs.baseSlots + 1,
    decision: decision.choose('bonusSlot', 'Production is big enough for one extra main slot'),
  };
}
