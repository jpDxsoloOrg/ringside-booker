/**
 * The shows system's random stream. `shows.offscreen` rolls the random swing of a show scored
 * off-screen (docs/design/show-night.md#off-screen-score).
 *
 * Segment ratings on show night roll on the match system's world stream `match.rating` (declared in
 * `systems/match/streams.ts`), so the shows system declares no rating stream of its own.
 */

declare module '../../core/rng/streams' {
  interface StreamNames {
    'shows.offscreen': true;
  }
}

/** The stream an off-screen show's random swing draws from. */
export const SHOWS_OFFSCREEN_STREAM = 'shows.offscreen';
