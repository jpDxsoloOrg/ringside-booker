/**
 * The physical toll's random streams.
 *
 * - `match.wear` (MTCH4-01) rolls how rough a match was for one worker: exactly one draw per worker
 *   per match (`formulas/conditionWear.ts`), whatever the tunables say, so retuning never shifts
 *   the stream.
 * - `match.injury` (MTCH4-02) rolls whether a worker is hurt in a match: exactly one draw per
 *   worker per segment (`injuries.ts`), even when the chance is 0 or the segment's limit is
 *   already reached.
 */

declare module '../../../core/rng/streams' {
  interface StreamNames {
    'match.wear': true;
    'match.injury': true;
  }
}

/** The stream the wear roughness roll draws from. */
export const WEAR_STREAM = 'match.wear';

/** The stream the in-match injury roll draws from. */
export const INJURY_STREAM = 'match.injury';
