/**
 * The match system's random streams. `match.rating` rolls the night-to-night variance of a
 * segment's rating (the work rate roll in `formulas/workRate.ts`); the rater (MTCH1-05) passes it
 * to the formulas that roll.
 */

declare module '../../core/rng/streams' {
  interface StreamNames {
    'match.rating': true;
  }
}

/** The stream the rating rolls draw from. */
export const MATCH_RATING_STREAM = 'match.rating';

// The Match lab's previews (MTCH1-06) roll on a detached stream of this name, keyed by the
// preview seed (`detachedStream` in `core/rng/registry.ts`); it is never taken from the world's
// registry, so a preview can never move a world stream.
declare module '../../core/rng/streams' {
  interface StreamNames {
    'match.preview': true;
  }
}

/** The name of the detached stream a preview rolls on. */
export const MATCH_PREVIEW_STREAM = 'match.preview';

// MTCH2-02: the finish decided on the night and the method that ends the match. `autoFinish` and
// `chooseMethod` take any `RngStream`, so `match.simulate` can hand them a detached preview stream
// and EVT3 the world's `match.finish` stream.
declare module '../../core/rng/streams' {
  interface StreamNames {
    'match.finish': true;
  }
}

/** The stream the finish and method picks draw from. */
export const MATCH_FINISH_STREAM = 'match.finish';
