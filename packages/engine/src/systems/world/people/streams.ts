/**
 * The people generator's RNG streams. Identity, body and attributes draw from separate streams, so
 * changing the body archetypes (or the style weights) never changes anyone's attributes, and
 * changing the attribute profiles never moves anyone's home or birthday.
 *
 * The seeds (potential, traits, vices, popularity) each have a stream of their own too, so a change
 * to the trait table never moves anyone's ceilings or popularity.
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
    /** The late-bloomer roll and the per-attribute headroom variation (WLD-07). */
    'worldgen.people.potential': true;
    /** One chance roll per trait record, then a pick for each exclusive pair that hit twice. */
    'worldgen.people.traits': true;
    /** One chance roll per vice. */
    'worldgen.people.vices': true;
    /** The home popularity variation, then one variation roll per region in ID order. */
    'worldgen.people.popularity': true;
    /** Re-rolling potential for people already in the world (the new-game re-roll option). */
    'worldgen.people.reseed': true;
  }
}

export {};
