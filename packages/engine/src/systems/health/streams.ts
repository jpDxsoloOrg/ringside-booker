/**
 * The health system's random streams. `health.recovery` rolls the extra rest each person gets on top
 * of the daily fatigue recovery; `health.injuries` rolls an injury's kind, severity, days out and
 * whether the person can still work angles (WRK6-03); `health.offscreen` rolls each wrestler's daily
 * off-screen injury check (WRK6-04).
 */

declare module '../../core/rng/streams' {
  interface StreamNames {
    'health.recovery': true;
    'health.injuries': true;
    'health.offscreen': true;
  }
}

/** The stream the fatigue recovery roll draws from. */
export const RECOVERY_STREAM = 'health.recovery';

/** The stream every `health.injure` roll draws from. */
export const INJURIES_STREAM = 'health.injuries';

/** The stream the daily off-screen injury check draws from: one draw per eligible wrestler. */
export const OFFSCREEN_STREAM = 'health.offscreen';
