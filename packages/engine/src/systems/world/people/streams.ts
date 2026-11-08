/**
 * The people generator's RNG streams. Identity, body and attributes draw from separate streams, so
 * changing the body archetypes (or the style weights) never changes anyone's attributes, and
 * changing the attribute profiles never moves anyone's home or birthday.
 *
 * The draw order inside each stream is fixed and documented in `generate.ts`.
 */

declare module '../../../core/rng/streams' {
  interface StreamNames {
    /** Home region, gender, career stage, age, birth date, debut date and motivation. */
    'worldgen.people.identity': true;
    /** Ring style, body archetype, height, weight, body wear and the mask roll. */
    'worldgen.people.body': true;
    /** Talent, the per-attribute variation and the natural standout. */
    'worldgen.people.attributes': true;
  }
}

export {};
