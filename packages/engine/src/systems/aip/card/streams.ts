/**
 * The card planner's random streams (AIP4).
 *
 * - `aip.card`: rival show planning. Shows are planned in event instance ID order and each show
 *   draws one sequence from this stream, so adding a draw to one show's plan never reorders the
 *   picks of a show planned before it.
 * - `aip.autofill`: the player's Auto-fill on their own booking screen. It has its own stream so
 *   pressing Auto-fill never shifts what the rivals book.
 */

declare module '../../../core/rng/streams' {
  interface StreamNames {
    'aip.card': true;
    'aip.autofill': true;
  }
}

/** The stream rival show planning draws from. */
export const CARD_PLAN_STREAM = 'aip.card';

/** The stream the player's Auto-fill draws from. */
export const AUTOFILL_STREAM = 'aip.autofill';
