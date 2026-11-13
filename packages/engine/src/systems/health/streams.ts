/**
 * The health system's random streams. `health.recovery` rolls the extra rest each person gets on top
 * of the daily fatigue recovery; `health.injuries` rolls an injury's kind, severity, days out and
 * whether the person can still work angles (WRK6-03).
 */

declare module '../../core/rng/streams' {
  interface StreamNames {
    'health.recovery': true;
    'health.injuries': true;
  }
}

/** The stream the fatigue recovery roll draws from. */
export const RECOVERY_STREAM = 'health.recovery';

/** The stream every `health.injure` roll draws from. */
export const INJURIES_STREAM = 'health.injuries';
