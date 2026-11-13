/**
 * The guard AIP5's booked-card step checks first: rival results are only ever set on a show the
 * computer runs.
 *
 * `aip.bookShow` only books computer shows, but a brand can be handed back to the player between
 * planning and running, and nothing stops another caller from reaching the step. The rule is
 * EVT1's `showControllerOf`, which follows the brand's own controller before the promotion's, so a
 * computer GM brand inside your promotion counts as the computer's and your own brand never does.
 * See docs/design/rival-booking.md#hook.
 */

import type { GameWorldView } from '../../../model/tables';
import { showControllerOf, type ShowOwnership } from '../../calendar/control';

/** True when the computer runs `instance` (its brand's controller first, then its promotion's). */
export function isComputerBooked(read: GameWorldView, instance: ShowOwnership): boolean {
  return showControllerOf(read, instance).kind === 'computer';
}
