/**
 * The generation records of a content library, compiled once into lookups the people generator
 * reads: one role record per person role with its profiles by career stage, one style record per
 * ring style, the body archetypes and the body modifiers, all in key order.
 *
 * Compiling never throws for missing data, so a library without generation records (a names-only
 * test library, say) still works for everything else. Asking for a role, profile or style the
 * library does not have throws a {@link GenerationContentError} naming it.
 */

import { GenerationContentError } from '../../../core/errors';
import type { WeightedEntry } from '../../../core/rng';
import {
  GENDERS,
  MOTIVATIONS,
  RING_STYLES,
  type Gender,
  type Motivation,
  type PersonRole,
  type RingStyle,
} from '../../../model/entities/person';
import type { ContentLibrary } from '../../../persistence/packs/library';
import {
  CAREER_STAGES,
  type BodyArchetypeRecord,
  type BodyModifierRecord,
  type CareerStage,
  type GenerationProfileRecord,
  type GenerationRoleRecord,
  type GenerationStyleRecord,
} from '../../../persistence/packs/records/generation';

/** A role record with its weighted tables and its profiles by career stage. */
export interface CompiledRole {
  readonly record: GenerationRoleRecord;
  readonly genders: readonly WeightedEntry<Gender>[];
  readonly stages: readonly WeightedEntry<CareerStage>[];
  readonly motivations: readonly WeightedEntry<Motivation>[];
  readonly profiles: ReadonlyMap<CareerStage, GenerationProfileRecord>;
}

export interface CompiledGeneration {
  readonly roles: ReadonlyMap<PersonRole, CompiledRole>;
  readonly styles: ReadonlyMap<RingStyle, GenerationStyleRecord>;
  /** The styles a wrestler can be given (every style but `nonWrestler`), in key order. */
  readonly wrestlingStyles: readonly GenerationStyleRecord[];
  /** Every archetype, in key order. */
  readonly archetypes: readonly BodyArchetypeRecord[];
  readonly archetypesByKey: ReadonlyMap<string, BodyArchetypeRecord>;
  /** Per ring style, the archetypes with a weight above 0 for it, in key order. */
  readonly archetypesByStyle: ReadonlyMap<RingStyle, readonly WeightedEntry<BodyArchetypeRecord>[]>;
  /** Every body modifier, in key order. */
  readonly bodyModifiers: readonly BodyModifierRecord[];
  /** Problems found while compiling (two records for one role, say), thrown on first use. */
  readonly problems: readonly string[];
}

function inKeyOrder<Row>(records: Readonly<Record<string, Row>>): Row[] {
  return Object.keys(records)
    .sort()
    .flatMap((key) => {
      const record = records[key];
      return record === undefined ? [] : [record];
    });
}

function compile(library: ContentLibrary): CompiledGeneration {
  const problems: string[] = [];
  const profilesByRole = new Map<PersonRole, Map<CareerStage, GenerationProfileRecord>>();
  for (const profile of inKeyOrder(library.generationProfiles)) {
    const byStage =
      profilesByRole.get(profile.role) ?? new Map<CareerStage, GenerationProfileRecord>();
    const existing = byStage.get(profile.stage);
    if (existing !== undefined) {
      problems.push(
        `profiles ${existing.key} and ${profile.key} are both for ${profile.role} at stage ${profile.stage}`,
      );
      continue;
    }
    byStage.set(profile.stage, profile);
    profilesByRole.set(profile.role, byStage);
  }

  const roles = new Map<PersonRole, CompiledRole>();
  for (const record of inKeyOrder(library.generationRoles)) {
    const existing = roles.get(record.role);
    if (existing !== undefined) {
      problems.push(
        `generation roles ${existing.record.key} and ${record.key} are both for ${record.role}`,
      );
      continue;
    }
    roles.set(record.role, {
      record,
      genders: GENDERS.map((gender) => ({ item: gender, weight: record.genderShares[gender] })),
      stages: CAREER_STAGES.map((stage) => ({ item: stage, weight: record.stageShares[stage] })),
      motivations: MOTIVATIONS.map((motivation) => ({
        item: motivation,
        weight: record.motivationWeights[motivation],
      })),
      profiles: profilesByRole.get(record.role) ?? new Map<CareerStage, GenerationProfileRecord>(),
    });
  }

  const styles = new Map<RingStyle, GenerationStyleRecord>();
  for (const record of inKeyOrder(library.generationStyles)) {
    const existing = styles.get(record.style);
    if (existing !== undefined) {
      problems.push(`styles ${existing.key} and ${record.key} are both for ${record.style}`);
      continue;
    }
    styles.set(record.style, record);
  }

  const archetypes = inKeyOrder(library.bodyArchetypes);
  const archetypesByStyle = new Map<RingStyle, WeightedEntry<BodyArchetypeRecord>[]>();
  for (const style of RING_STYLES) {
    archetypesByStyle.set(
      style,
      archetypes
        .map((archetype) => ({ item: archetype, weight: archetype.styleWeights[style] }))
        .filter((entry) => entry.weight > 0),
    );
  }
  return {
    roles,
    styles,
    wrestlingStyles: [...styles.values()].filter((record) => record.style !== 'nonWrestler'),
    archetypes,
    archetypesByKey: new Map(archetypes.map((archetype) => [archetype.key, archetype])),
    archetypesByStyle,
    bodyModifiers: inKeyOrder(library.bodyModifiers),
    problems,
  };
}

/** Compiled content per library. Libraries are frozen, so a library's lookups never go stale. */
const compiledByLibrary = new WeakMap<ContentLibrary, CompiledGeneration>();

/** The compiled generation records of `library`, built on first use. */
export function compiledGenerationOf(library: ContentLibrary): CompiledGeneration {
  let compiled = compiledByLibrary.get(library);
  if (compiled === undefined) {
    compiled = compile(library);
    compiledByLibrary.set(library, compiled);
  }
  if (compiled.problems.length > 0) {
    throw new GenerationContentError(compiled.problems.join('; '));
  }
  return compiled;
}

/** The role record for `role`. Throws when the library has none. */
export function roleOf(compiled: CompiledGeneration, role: PersonRole): CompiledRole {
  const found = compiled.roles.get(role);
  if (found === undefined) {
    throw new GenerationContentError(`the content library has no generation role for ${role}`, {
      role,
    });
  }
  return found;
}

/** The attribute profile for a role at a career stage. Throws when the library has none. */
export function profileOf(role: CompiledRole, stage: CareerStage): GenerationProfileRecord {
  const found = role.profiles.get(stage);
  if (found === undefined) {
    throw new GenerationContentError(
      `the content library has no generation profile for ${role.record.role} at stage ${stage}`,
      { role: role.record.role, stage },
    );
  }
  return found;
}

/** The style record for `style`. Throws when the library has none. */
export function styleOf(compiled: CompiledGeneration, style: RingStyle): GenerationStyleRecord {
  const found = compiled.styles.get(style);
  if (found === undefined) {
    throw new GenerationContentError(`the content library has no generation style for ${style}`, {
      style,
    });
  }
  return found;
}
