/**
 * `aiShortcut`: the one place that decides whether a Rival rules shortcut applies (D-01).
 *
 * A shortcut applies to a promotion (or brand) only when all three hold:
 *
 * 1. the computer runs it (`unitControllerOf`, so a computer GM brand inside the player's
 *    promotion counts as the computer's, and a brand with no controller of its own follows its
 *    promotion);
 * 2. the "Level playing field" setting is off;
 * 3. the shortcut's own `ai.*` tunable is on (above 0 for the score bonus).
 *
 * Systems that act on a shortcut call this and never look at controllers themselves, so there is
 * no `if (isAI)` branch anywhere else. The answer is traced, so a Why? that used a shortcut shows
 * it. Features register here as the consumer of a key, so the Rival rules screen can say which
 * shortcuts do anything yet. See docs/design/rival-desk.md#shortcuts.
 */

import type { BrandId, PromotionId } from '../../core/ids';
import { RegistryError } from '../../core/errors';
import { startCalc, startDecision, type Traced } from '../../core/trace';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import {
  AI_SHORTCUT_KEYS,
  AI_SHORTCUTS,
  isAiShortcutFlag,
  type AiShortcutFlagKey,
  type AiShortcutKey,
  type AiShortcutValue,
} from './shortcuts';
import { unitControllerOf } from './units';

const SHORTCUTS_DOC = 'rival-desk.md#shortcuts';

/** The rule names a shortcut's trace records. */
export const AI_SHORTCUT_RULES = Object.freeze({
  computer: 'Run by the computer',
  levelField: 'Level playing field is off',
});

/** Why a shortcut does not apply, or null when both rules pass (the tunable is checked after). */
function ruleFailure(
  computer: boolean,
  levelPlayingField: boolean,
): 'Run by a player, not the computer' | 'The level playing field is on' | null {
  if (!computer) {
    return 'Run by a player, not the computer';
  }
  if (levelPlayingField) {
    return 'The level playing field is on';
  }
  return null;
}

interface RuleState {
  readonly computer: boolean;
  readonly levelPlayingField: boolean;
}

function rulesFor(
  read: GameWorldView,
  promotionId: PromotionId,
  brandId: BrandId | null,
): RuleState {
  return {
    computer: unitControllerOf(read, promotionId, brandId).kind === 'computer',
    levelPlayingField: read.meta.settings.levelPlayingField,
  };
}

function flagShortcut(
  tunables: EngineTunables,
  rules: RuleState,
  key: AiShortcutFlagKey,
): Traced<boolean> {
  const decision = startDecision<boolean>(`Rival shortcut: ${AI_SHORTCUTS[key].label}`, {
    docRef: SHORTCUTS_DOC,
  });
  decision.rule(AI_SHORTCUT_RULES.computer, rules.computer);
  decision.rule(AI_SHORTCUT_RULES.levelField, !rules.levelPlayingField);
  const enabled = decision.tunable(tunables, key);
  const failure = ruleFailure(rules.computer, rules.levelPlayingField);
  if (failure !== null) {
    return decision.choose(false, failure);
  }
  if (!enabled) {
    return decision.choose(false, 'This shortcut is turned off');
  }
  return decision.choose(true, 'Rival rules apply');
}

function scoreBonusShortcut(tunables: EngineTunables, rules: RuleState): Traced<number> {
  const calc = startCalc('Rival score bonus', 0, {
    unit: 'points',
    docRef: SHORTCUTS_DOC,
    startLabel: 'No bonus',
  });
  calc.branch(AI_SHORTCUT_RULES.computer, rules.computer);
  calc.branch(AI_SHORTCUT_RULES.levelField, !rules.levelPlayingField);
  const failure = ruleFailure(rules.computer, rules.levelPlayingField);
  if (failure === null) {
    calc.add('Rival shortcut', calc.tunable(tunables, 'ai.scoreBonus'));
  } else {
    calc.note(failure);
  }
  return calc.done();
}

/**
 * Whether a Rival rules shortcut applies to a promotion, or to one of its brands, with the trace.
 * Flags read as `true` (applies) or `false`; `ai.scoreBonus` reads as the points to add, 0 when it
 * does not apply.
 *
 * Partner sketches that wrote `aiShortcut(...).value !== 0` for a flag must use `.value`: flags
 * are booleans. {@link aiShortcutOn} is the flag-only form.
 *
 * @throws EntityNotFoundError when the promotion is not in the world.
 */
export function aiShortcut<K extends AiShortcutKey>(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
  key: K,
  brandId?: BrandId | null,
): Traced<AiShortcutValue<K>>;
export function aiShortcut(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
  key: AiShortcutKey,
  brandId: BrandId | null = null,
): Traced<boolean> | Traced<number> {
  const rules = rulesFor(read, promotionId, brandId);
  return isAiShortcutFlag(key)
    ? flagShortcut(tunables, rules, key)
    : scoreBonusShortcut(tunables, rules);
}

/**
 * The flag form of {@link aiShortcut}, for callers that want `Traced<boolean>` spelt out (for
 * example WRK6's `offscreenShortcutOf`). Use `.value`, never `.value !== 0`.
 */
export function aiShortcutOn(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
  key: AiShortcutFlagKey,
  brandId: BrandId | null = null,
): Traced<boolean> {
  return flagShortcut(tunables, rulesFor(read, promotionId, brandId), key);
}

/** Every shortcut for one promotion or brand, keyed by tunable. */
export type AiShortcutSet = { readonly [K in AiShortcutKey]: Traced<AiShortcutValue<K>> };

/** All six shortcuts for one promotion or brand, for the rules panel. */
export function aiShortcutsFor(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
  brandId: BrandId | null = null,
): AiShortcutSet {
  const rules = rulesFor(read, promotionId, brandId);
  return {
    'ai.skipInMatchInjuries': flagShortcut(tunables, rules, 'ai.skipInMatchInjuries'),
    'ai.skipResultMorale': flagShortcut(tunables, rules, 'ai.skipResultMorale'),
    'ai.scoreBonus': scoreBonusShortcut(tunables, rules),
    'ai.simpleBookingInputs': flagShortcut(tunables, rules, 'ai.simpleBookingInputs'),
    'ai.skipMediaRequests': flagShortcut(tunables, rules, 'ai.skipMediaRequests'),
    'ai.skipWorkerRequests': flagShortcut(tunables, rules, 'ai.skipWorkerRequests'),
  };
}

// ---------------------------------------------------------------------------------------------
// Consumers: the features that act on each shortcut

/** A feature that acts on a shortcut. */
export interface AiShortcutConsumer {
  readonly key: AiShortcutKey;
  /** The feature's ticket prefix or system id, for example `MTCH1`. */
  readonly featureId: string;
  /** What the rules screen calls it, for example "Match ratings". */
  readonly label: string;
}

const consumers: AiShortcutConsumer[] = [];

/**
 * Records that a feature acts on a shortcut, so the rules screen can say it takes effect. Returns
 * a function that removes the registration (for tests).
 *
 * @throws RegistryError when the same feature already registered for this key, or the key is not
 *   a shortcut.
 */
export function registerAiShortcutConsumer(consumer: AiShortcutConsumer): () => void {
  if (!(AI_SHORTCUT_KEYS as readonly string[]).includes(consumer.key)) {
    throw new RegistryError(`"${consumer.key}" is not a Rival rules shortcut`, {
      key: consumer.key,
    });
  }
  if (
    consumers.some(
      (existing) => existing.key === consumer.key && existing.featureId === consumer.featureId,
    )
  ) {
    throw new RegistryError(
      `"${consumer.featureId}" already acts on the shortcut "${consumer.key}"`,
      { key: consumer.key, featureId: consumer.featureId },
    );
  }
  const stored: AiShortcutConsumer = { ...consumer };
  consumers.push(stored);
  return () => {
    const index = consumers.indexOf(stored);
    if (index >= 0) {
      consumers.splice(index, 1);
    }
  };
}

/** The registered consumers, in registration order; with `key`, only that shortcut's. */
export function aiShortcutConsumers(key?: AiShortcutKey): AiShortcutConsumer[] {
  return consumers
    .filter((consumer) => key === undefined || consumer.key === key)
    .map((consumer) => ({ ...consumer }));
}
