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

// MTCH2-03: the auto-winner's unpredictability rolls, one per side.
declare module '../../core/rng/streams' {
  interface StreamNames {
    'match.auto-winner': true;
  }
}

/** The stream the auto-winner's unpredictability rolls draw from. */
export const MATCH_AUTO_WINNER_STREAM = 'match.auto-winner';
