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
