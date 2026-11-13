/**
 * The policy effect seam (ECO1-04): how other features add their non-money lines to the policy
 * preview, such as "Injuries heal faster" (WRK6, medical) or "+3 morale" (SOC3, catering and travel).
 *
 * ECO1 owns the three policies and what they cost. It never applies their other effects itself:
 * the feature that does registers a policy effect here, so the preview shows the player what each
 * level does, in that feature's own words and with its own Why?.
 *
 * A module-level registry, like the setup steps: register once when the module loads. Design:
 * docs/design/finances.md#seams.
 */

import { RegistryError } from '../../core/errors';
import type { PromotionId } from '../../core/ids';
import { PHASE_ID_PATTERN } from '../../core/pipeline/phase';
import type { TraceNode } from '../../core/trace/types';
import type { PolicyArea } from '../../model/entities/promotion';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import { POLICY_AREAS, type PolicyLevel } from './policies';

/** How a line reads to the player: good news, bad news, or neither. */
export type PolicyEffectTone = 'positive' | 'negative' | 'neutral';

/** One line a feature adds to a policy level in the preview. */
export interface PolicyEffectLine {
  /** Plain words, such as "Injuries heal faster". */
  text: string;
  tone: PolicyEffectTone;
  /** How the line was worked out, when there is a number behind it. */
  trace?: TraceNode;
}

/** What a feature registers to describe a policy's effect. */
export interface PolicyEffect {
  /** `system.camelName`, like a phase id, for example `wrk.medicalRecovery`. */
  readonly id: string;
  readonly area: PolicyArea;
  /** Position among the area's effects; lower comes first. Equal orders go by id. */
  readonly order: number;
  /** The lines for `level` of `promotionId`'s `area` policy. Pure: reads only its arguments. */
  readonly lines: (
    read: GameWorldView,
    promotionId: PromotionId,
    level: PolicyLevel,
    tunables: EngineTunables,
  ) => PolicyEffectLine[];
}

const registry = new Map<string, PolicyEffect>();

/**
 * Adds a policy effect. Throws `RegistryError` for a malformed id, an unknown area, an order that
 * is not a finite number, or an id already registered.
 */
export function registerPolicyEffect(effect: PolicyEffect): void {
  const fail = (message: string): never => {
    throw new RegistryError(`Policy effect "${effect.id}": ${message}`, { effectId: effect.id });
  };
  if (!PHASE_ID_PATTERN.test(effect.id)) {
    fail('the id must look like "system.camelName", for example "wrk.medicalRecovery"');
  }
  if (!POLICY_AREAS.includes(effect.area)) {
    fail(`the area must be one of ${POLICY_AREAS.join(', ')}`);
  }
  if (!Number.isFinite(effect.order)) {
    fail('the order must be a finite number');
  }
  if (registry.has(effect.id)) {
    fail('an effect with this id is already registered');
  }
  registry.set(effect.id, { ...effect });
}

/** The effects registered for `area`, by order then id. */
export function listPolicyEffects(area: PolicyArea): PolicyEffect[] {
  return [...registry.values()]
    .filter((effect) => effect.area === area)
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      if (left.id === right.id) {
        return 0;
      }
      return left.id < right.id ? -1 : 1;
    });
}

/** Every line the registered effects give `level` of the promotion's `area` policy, in order. */
export function policyEffectLines(
  read: GameWorldView,
  promotionId: PromotionId,
  area: PolicyArea,
  level: PolicyLevel,
  tunables: EngineTunables,
): PolicyEffectLine[] {
  return listPolicyEffects(area).flatMap((effect) =>
    effect.lines(read, promotionId, level, tunables),
  );
}

/** Removes a policy effect. For tests. Returns false when no effect had that id. */
export function unregisterPolicyEffect(id: string): boolean {
  return registry.delete(id);
}

/** Removes every policy effect. For tests. */
export function resetPolicyEffectsForTests(): void {
  registry.clear();
}
