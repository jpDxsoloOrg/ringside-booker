/**
 * The negotiation system's random streams (ECO5-01). `contracts.counter` rolls the concessions in
 * a worker's counter-offer; `contracts.review` breaks ties when a worker reviews offers. Nothing
 * draws from them yet: ECO5-03 and ECO5-05 do.
 *
 * Stream names are lowercase with dashes (`STREAM_NAME_PATTERN`).
 */

declare module '../../core/rng/streams' {
  interface StreamNames {
    'contracts.counter': true;
    'contracts.review': true;
  }
}

/** The stream every counter-offer concession draws from. */
export const COUNTER_STREAM = 'contracts.counter';

/** The stream every review tie-break draws from. */
export const REVIEW_STREAM = 'contracts.review';
