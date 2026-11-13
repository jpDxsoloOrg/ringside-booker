/**
 * The physical toll's random stream (MTCH4-01). `match.wear` rolls how rough a match was for one
 * worker: exactly one draw per worker per match (`formulas/conditionWear.ts`), whatever the tunables
 * say, so retuning never shifts the stream.
 */

declare module '../../../core/rng/streams' {
  interface StreamNames {
    'match.wear': true;
  }
}

/** The stream the wear roughness roll draws from. */
export const WEAR_STREAM = 'match.wear';
