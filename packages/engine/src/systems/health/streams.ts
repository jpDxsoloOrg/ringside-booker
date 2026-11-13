/**
 * The health system's random stream. `health.recovery` rolls the extra rest each person gets on top
 * of the daily fatigue recovery.
 */

declare module '../../core/rng/streams' {
  interface StreamNames {
    'health.recovery': true;
  }
}

/** The stream the fatigue recovery roll draws from. */
export const RECOVERY_STREAM = 'health.recovery';
