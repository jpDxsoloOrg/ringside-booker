import type { TraceNode } from '@ringside/engine';

/** What the venue line and its Why? say when no venue is set. */
export const VENUE_NOT_CHOSEN_TEXT = 'not chosen yet';

/**
 * The placement reasoning with its outcome in the player's words. The engine names the outcome
 * with a rule key (`preferredVenue`, `notChosen`); the panel's headline is that outcome, so it
 * reads as the venue's name, or "Not chosen yet". The reason and every rule under it are the
 * engine's own and are left alone. Anything that is not a decision passes through unchanged.
 */
export function placementTraceInWords(trace: TraceNode, venueName: string | null): TraceNode {
  if (trace.kind !== 'decision') return trace;
  const outcome = venueName ?? 'Not chosen yet';
  return { ...trace, value: outcome, chosen: outcome };
}
