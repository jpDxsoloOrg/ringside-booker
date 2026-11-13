/**
 * The rating policy: the one door through which a promotion's rating shortcuts reach a rating.
 *
 * D-01 says rival shortcuts are named tunables, never an `if (isAI)` branch. MTCH1 never looks at
 * who controls a promotion: it asks the single registered policy provider (AIP1 registers it from
 * its own pack) and, with none, rates every promotion by the same rules.
 *
 * Design: docs/design/match-rating.md#the-policy-door-d-01.
 */

import { RegistryError } from '../../../core/errors';
import type { PromotionId } from '../../../core/ids';
import { constantOf, type Traced } from '../../../core/trace';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { DEFAULT_POLICY_LABEL } from '../formulas/segmentScore';

/** How a promotion's segments are rated. */
export interface RatingPolicy {
  /** Added to the segment score, with its own trace line. */
  readonly scoreBonus: Traced<number>;
  /** Skip every `detail: true` rating modifier, with a note naming it. */
  readonly simpleInputs: boolean;
  /** Carried for MTCH4, which reads it before rolling in-match injuries. Unused in MTCH1. */
  readonly skipInMatchInjuries: boolean;
  /** The policy's name as the player reads it, such as "Full rules". */
  readonly label: string;
  /** Extra lines explaining the policy, for the Why? panel. */
  readonly lines: readonly string[];
}

/** Answers which policy a promotion's segments are rated under. */
export type RatingPolicyProvider = (
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
) => RatingPolicy;

export const NEUTRAL_RATING_POLICY_LABEL = 'Full rules';

/** Every promotion, rated by the same rules. */
export const NEUTRAL_RATING_POLICY: RatingPolicy = Object.freeze({
  scoreBonus: constantOf('Score bonus', 0, DEFAULT_POLICY_LABEL),
  simpleInputs: false,
  skipInMatchInjuries: false,
  label: NEUTRAL_RATING_POLICY_LABEL,
  lines: Object.freeze([DEFAULT_POLICY_LABEL]),
});

interface RegisteredProvider {
  readonly id: string;
  readonly provide: RatingPolicyProvider;
}

let registered: RegisteredProvider | null = null;
/** The provider registered on import with `builtIn` (the rival desk's), which a reset restores. */
let builtIn: RegisteredProvider | null = null;

/**
 * Registers the rating policy provider. There is at most one. Returns a function that removes it
 * again. `options.id` names it in errors; it defaults to the function's name.
 *
 * @throws RegistryError when a provider is already registered, naming it.
 */
export function registerRatingPolicyProvider(
  provider: RatingPolicyProvider,
  options: { id?: string; builtIn?: boolean } = {},
): () => void {
  const id = options.id ?? (provider.name === '' ? 'anonymous provider' : provider.name);
  if (registered !== null) {
    throw new RegistryError(
      `Rating policy provider "${id}": "${registered.id}" is already registered; there can be only one`,
      { provider: id, registered: registered.id },
    );
  }
  const entry: RegisteredProvider = { id, provide: provider };
  registered = entry;
  if (options.builtIn === true) {
    builtIn = entry;
  }
  return () => {
    if (registered === entry) {
      registered = null;
    }
  };
}

/** The policy a promotion's segments are rated under: the provider's answer, or the neutral one. */
export function ratingPolicyFor(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
): RatingPolicy {
  return registered === null
    ? NEUTRAL_RATING_POLICY
    : registered.provide(read, tunables, promotionId);
}

/** Removes the provider, built-in or not. For tests of MTCH1's own seams. */
export function clearRatingPolicyProvider(): void {
  registered = null;
}

/** Puts back the built-in provider, if one registered on import. For `resetMatchRegistriesForTests`. */
export function restoreBuiltInRatingPolicyProvider(): void {
  registered = builtIn;
}
