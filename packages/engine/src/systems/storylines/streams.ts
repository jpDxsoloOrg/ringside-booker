/**
 * The storylines system's random streams. `storylines.starters` picks the face and the heel of
 * each starter storyline at new game (CRTV3-02): two picks per starter.
 */

declare module '../../core/rng/streams' {
  interface StreamNames {
    'storylines.starters': true;
  }
}

/** The stream the starter storyline picks draw from. */
export const STARTERS_STREAM = 'storylines.starters';
