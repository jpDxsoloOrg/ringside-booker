/**
 * The rival results' random streams (AIP5).
 *
 * - `aip.winners`: who wins a rival match. Per segment, in this order: the jitter on each side
 *   (side order), the draw roll, the squash roll, the protection roll, the finale roll, then the
 *   method roll. A roll a segment does not need is not drawn.
 * - `aip.titles`: whether a rival title match changes the title, then which challenger takes it.
 *
 * Shows draw in event instance ID order and segments in running order (pre-show first, then by
 * slot), so a change to one segment never shifts another show's rolls. See
 * docs/design/rival-booking.md#order-of-rolls.
 */

declare module '../../../core/rng/streams' {
  interface StreamNames {
    'aip.winners': true;
    'aip.titles': true;
  }
}

/** The stream rival winner rolls draw from. */
export const WINNERS_STREAM = 'aip.winners';

/** The stream rival title change rolls draw from. */
export const TITLES_STREAM = 'aip.titles';
