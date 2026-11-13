/**
 * The risk modifier seam (MTCH4-01): how a later feature makes one segment, or one worker in it,
 * more or less tiring and dangerous without editing the physical toll.
 *
 * A modifier looks at the segment (`RiskContext`) and returns contributions. Each names its source
 * in player words ("Stipulation: Ladder"), the workers it applies to (or every competitor), and any
 * of a fatigue, wear or injury multiplier, an added injury chance and a keep-it-safe switch. The
 * fatigue and wear formulas multiply in every contribution that reaches the worker, one trace line
 * per source; MTCH4-02 reads the injury fields the same way.
 *
 * Like the setup step and rater registries, the registry is module-level: a system registers at
 * module load and tests unregister what they added.
 *
 * Design: docs/design/physical-toll.md#risk-modifiers.
 */

import { z } from 'zod';
import { RegistryError } from '../../../core/errors';
import type { PersonId } from '../../../core/ids';
import { PHASE_ID_PATTERN } from '../../../core/pipeline/phase';
import type { GameWorldView } from '../../../model/tables';
import type { PhysicalSegmentSpec } from './inputs';

/** What a risk modifier sees: the segment and a read view of the world. */
export interface RiskContext extends PhysicalSegmentSpec {
  readonly read: GameWorldView;
}

/** One change a modifier makes to a segment's physical toll. */
export interface RiskContribution {
  /** Player text naming the cause, shown as the trace line, for example "Stipulation: Ladder". */
  readonly source: string;
  /** The workers it applies to; null for every competitor. */
  readonly personIds: readonly PersonId[] | null;
  /** Multiplies fatigue gain. */
  readonly fatigueMultiplier?: number;
  /** Multiplies the wear load. */
  readonly wearMultiplier?: number;
  /** Multiplies the injury chance (MTCH4-02). */
  readonly injuryMultiplier?: number;
  /** Adds to the injury chance, 0..1 (MTCH4-02). */
  readonly injuryAdd?: number;
  /** Switches the keep-it-safe factors on for the workers it reaches. */
  readonly keepItSafe?: boolean;
}

/** What a feature registers. */
export interface RiskModifierSpec {
  /** `system.camelName`, like a phase id, for example `stip.ladder`. */
  readonly id: string;
  /** Lower runs first; ties by id. Whole number. */
  readonly order: number;
  readonly contribute: (ctx: RiskContext) => readonly RiskContribution[];
}

/** A contribution that reaches one worker, with the modifier it came from. */
export interface AppliedRiskContribution extends RiskContribution {
  readonly modifierId: string;
}

/** Largest allowed modifier order. */
export const MAX_RISK_MODIFIER_ORDER = 1_000_000;

/** zod 4 numbers are finite: NaN and Infinity are refused. */
const zMultiplier = z.number().min(0);

const RiskContributionSchema = z.strictObject({
  source: z.string().trim().min(1),
  personIds: z.array(z.string().min(1)).nullable(),
  fatigueMultiplier: zMultiplier.optional(),
  wearMultiplier: zMultiplier.optional(),
  injuryMultiplier: zMultiplier.optional(),
  injuryAdd: z.number().min(0).max(1).optional(),
  keepItSafe: z.boolean().optional(),
});

const registry = new Map<string, RiskModifierSpec>();

/**
 * Adds a risk modifier. Returns a function that removes it again (for tests).
 *
 * @throws RegistryError for a malformed id or order, or an id that is already taken.
 */
export function registerRiskModifier(spec: RiskModifierSpec): () => void {
  const fail = (message: string): never => {
    throw new RegistryError(`Risk modifier "${spec.id}": ${message}`, { modifierId: spec.id });
  };
  if (!PHASE_ID_PATTERN.test(spec.id)) {
    fail('the id must look like "system.camelName", for example "stip.ladder"');
  }
  if (!Number.isInteger(spec.order) || spec.order < 0 || spec.order > MAX_RISK_MODIFIER_ORDER) {
    fail(`the order must be a whole number from 0 to ${String(MAX_RISK_MODIFIER_ORDER)}`);
  }
  if (registry.has(spec.id)) {
    fail('a modifier with this id is already registered');
  }
  const stored: RiskModifierSpec = { ...spec };
  registry.set(spec.id, stored);
  return () => {
    if (registry.get(spec.id) === stored) {
      registry.delete(spec.id);
    }
  };
}

/** Every registered modifier's id, in the order they run. */
export function riskModifierIds(): string[] {
  return orderedModifiers().map((modifier) => modifier.id);
}

function orderedModifiers(): RiskModifierSpec[] {
  return [...registry.values()].sort(
    (left, right) => left.order - right.order || (left.id < right.id ? -1 : 1),
  );
}

function validated(modifier: RiskModifierSpec, contribution: RiskContribution): RiskContribution {
  const parsed = RiskContributionSchema.safeParse(contribution);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'contribution'}: ${issue.message}`)
      .join('; ');
    throw new RegistryError(
      `Risk modifier "${modifier.id}" returned a bad contribution (${problems})`,
      { modifierId: modifier.id },
    );
  }
  return contribution;
}

/**
 * The contributions that reach `personId` in this segment: every registered modifier's
 * contributions, ordered by modifier order then id (and in the modifier's own order within it),
 * keeping those for every competitor and those that name this worker.
 *
 * @throws RegistryError naming the modifier when it returns a bad contribution.
 */
export function collectRiskContributions(
  ctx: RiskContext,
  personId: PersonId,
): AppliedRiskContribution[] {
  const applied: AppliedRiskContribution[] = [];
  for (const modifier of orderedModifiers()) {
    for (const raw of modifier.contribute(ctx)) {
      const contribution = validated(modifier, raw);
      if (contribution.personIds === null || contribution.personIds.includes(personId)) {
        applied.push({ ...contribution, modifierId: modifier.id });
      }
    }
  }
  return applied;
}
