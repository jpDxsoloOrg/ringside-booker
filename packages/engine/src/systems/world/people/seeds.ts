/**
 * The four WLD-07 seeds wrapped as people generator hooks: potential, traits, vices and
 * popularity, each on a stream of its own. `generatePerson` uses these unless its context passes
 * other hooks (an empty object turns them all off).
 *
 * Design: docs/design/world-generation.md#potential-traits-vices-and-popularity-seeding.
 */

import { traced } from '../../../core/trace';
import { seedPopularity } from './popularity';
import { seedPotential } from './potential';
import type { PersonSeedHook, PersonSeedHooks } from './spec';
import { seedTraits } from './traits';
import { seedVices } from './vices';

/** Fills `development` (ceilings and the potential number). Stream `worldgen.people.potential`. */
export const potentialSeedHook: PersonSeedHook = (input) => {
  const seeded = seedPotential(
    input.person,
    input.talent,
    input.worldDate,
    input.rng('worldgen.people.potential'),
    { tunables: input.tunables, library: input.library },
  );
  return traced({ ...input.person, development: seeded.value }, seeded.trace);
};

/** Fills `traits`. Stream `worldgen.people.traits`. */
export const traitsSeedHook: PersonSeedHook = (input) => {
  const seeded = seedTraits(input.person, input.rng('worldgen.people.traits'), input.library, {
    worldDate: input.worldDate,
    tunables: input.tunables,
  });
  return traced({ ...input.person, traits: seeded.value }, seeded.trace);
};

/** Fills `vices`. Stream `worldgen.people.vices`. */
export const vicesSeedHook: PersonSeedHook = (input) => {
  const seeded = seedVices(input.person, input.rng('worldgen.people.vices'), {
    worldDate: input.worldDate,
    tunables: input.tunables,
  });
  return traced({ ...input.person, vices: seeded.value }, seeded.trace);
};

/** Fills `regionalPop`. Stream `worldgen.people.popularity`. */
export const popularitySeedHook: PersonSeedHook = (input) => {
  const seeded = seedPopularity(
    input.person,
    input.stage,
    input.talent,
    input.worldDate,
    input.rng('worldgen.people.popularity'),
    input.geography,
    { tunables: input.tunables },
  );
  return traced({ ...input.person, regionalPop: seeded.value }, seeded.trace);
};

/** The seeds the people generator runs by default. */
export const DEFAULT_SEED_HOOKS: PersonSeedHooks = Object.freeze({
  seedPotential: potentialSeedHook,
  seedTraits: traitsSeedHook,
  seedVices: vicesSeedHook,
  seedPopularity: popularitySeedHook,
});
