/**
 * The contracts system's random streams. `contracts.ai-renewal` rolls a rival promotion's simple
 * renewal: whether a worker it does not have to keep is renewed, and for how long.
 * `contracts.walkout` rolls whether a worker whose release request was refused walks out today
 * (ECO4-03).
 *
 * Stream names are lowercase with dashes (`STREAM_NAME_PATTERN`), so the stream is
 * `contracts.ai-renewal` while its trace kind is `contracts.aiRenewal`.
 */

declare module '../../core/rng/streams' {
  interface StreamNames {
    'contracts.ai-renewal': true;
    'contracts.walkout': true;
  }
}

/** The stream every simple rival renewal draws from. */
export const AI_RENEWAL_STREAM = 'contracts.ai-renewal';

/** The stream every walk-out roll draws from (ECO4-03). */
export const WALKOUT_STREAM = 'contracts.walkout';
