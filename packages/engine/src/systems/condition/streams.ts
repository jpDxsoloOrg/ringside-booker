/**
 * The condition system's random stream. `condition.recovery` rolls the extra rest each person gets
 * on top of the daily recovery.
 */

declare module '../../core/rng/streams' {
  interface StreamNames {
    'condition.recovery': true;
  }
}

/** The stream the fatigue recovery roll draws from. */
export const RECOVERY_STREAM = 'condition.recovery';
