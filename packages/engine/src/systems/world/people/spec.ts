/**
 * What the people generator is asked for, what it hands back, and what it needs to run.
 *
 * A {@link GenerateSpec} is short on purpose: a role, and optionally anything the caller wants to
 * pin down (career stage, gender, where they are from, ring style, body archetype, talent, single
 * attributes). Everything left out is rolled from the `base` pack's generation records.
 *
 * Design: docs/design/world-generation.md#generating-people.
 */

import type { GameDate } from '../../../core/date';
import type { ContinentId, CountryId, PersonId, RegionId } from '../../../core/ids';
import type { RngStream, StreamName } from '../../../core/rng';
import type { Traced } from '../../../core/trace';
import type {
  AttributeKey,
  Gender,
  Person,
  PersonRole,
  RingStyle,
} from '../../../model/entities/person';
import type { ContentLibrary } from '../../../persistence/packs/library';
import type { CareerStage } from '../../../persistence/packs/records/generation';
import type { EngineTunables } from '../../tunables';
import type { Geography } from '../geography';
import type { NameGenerator } from '../names/generator';

export { CAREER_STAGES, type CareerStage } from '../../../persistence/packs/records/generation';

/** The key of a body archetype record in the content library, such as `power-brawler`. */
export type ArchetypeKey = string;

/** Who to generate. Only `role` is required. */
export interface GenerateSpec {
  readonly role: PersonRole;
  /** Rolled from the role's stage shares when left out. */
  readonly careerStage?: CareerStage;
  /** Rolled from the role's gender shares when left out. */
  readonly gender?: Gender;
  /**
   * Where they are from. A region is used as given; otherwise a region is picked inside the
   * country, else inside the continent, else anywhere, weighted by population × interest.
   */
  readonly countryId?: CountryId;
  readonly regionId?: RegionId;
  readonly continentId?: ContinentId;
  /** A ring style. Wrestling roles only; everyone else is always `nonWrestler`. */
  readonly style?: RingStyle;
  /** A body archetype key. Used as given, even when it is a poor fit for the style. */
  readonly archetype?: ArchetypeKey;
  /** The talent z-score, for hand-picked stars. Rolled from N(0, 1) when left out. */
  readonly talent?: number;
  /** Attributes set by hand. Each is clamped to 0-100 and rounded. */
  readonly attributeOverrides?: Partial<Record<AttributeKey, number>>;
}

/** What the generator returns. Talent is not stored on the person; it is passed to the seeds. */
export interface GeneratedPerson {
  readonly person: Person;
  /** The talent z-score the attributes were rolled with. */
  readonly talent: number;
}

/** Hands out named RNG streams, like `StepContext.rng`. */
export type StreamSource = (name: StreamName) => RngStream;

/** What a seed hook (WLD-07: potential, traits, vices, popularity) receives. */
export interface PersonSeedInput {
  /** The person so far, with every earlier seed already applied. */
  readonly person: Person;
  readonly talent: number;
  readonly stage: CareerStage;
  readonly spec: GenerateSpec;
  readonly worldDate: GameDate;
  readonly rng: StreamSource;
  readonly tunables: EngineTunables;
  readonly library: ContentLibrary;
  readonly geography: Geography;
}

/** A seed hook: returns the person with its part filled in, and the trace that explains it. */
export type PersonSeedHook = (input: PersonSeedInput) => Traced<Person>;

/**
 * The seeds the generator runs after the core person is built, in this order. Each one is
 * optional; a missing seed leaves its fields at the neutral defaults (potential 0, no ceilings, no
 * traits, no vices, no popularity). The defaults are `DEFAULT_SEED_HOOKS` in `seeds.ts`.
 */
export interface PersonSeedHooks {
  readonly seedPotential?: PersonSeedHook;
  readonly seedTraits?: PersonSeedHook;
  readonly seedVices?: PersonSeedHook;
  readonly seedPopularity?: PersonSeedHook;
}

/** Everything `generatePerson` reads besides the spec. */
export interface GenerateContext {
  /** The new person's ID, minted by the caller (inside a transaction, or by the world builder). */
  readonly personId: PersonId;
  /** Today in the game. Ages are measured at this date. */
  readonly worldDate: GameDate;
  readonly library: ContentLibrary;
  readonly geography: Geography;
  /** Gives the person a legal name; draws from `worldgen.names.person`. */
  readonly names: NameGenerator;
  readonly rng: StreamSource;
  /** Defaults to every engine tunable at its default value. */
  readonly tunables?: EngineTunables;
  /**
   * The seeds to run after the core person is built. Defaults to the WLD-07 seeds (potential,
   * traits, vices, popularity); pass `{}` to run none.
   */
  readonly hooks?: PersonSeedHooks;
  /**
   * Parse the result with `PersonSchema` before returning it (default true). Turn it off only in
   * a hot loop whose output is validated elsewhere.
   */
  readonly validate?: boolean;
}
