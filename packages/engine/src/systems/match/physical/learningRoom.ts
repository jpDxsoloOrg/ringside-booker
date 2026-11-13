/**
 * The hidden learning gate (MTCH4-03): how much room a worker has left to learn an attribute.
 *
 * Reads the hidden development fields (`person.development`: the potential number and the
 * per-attribute ceilings, see docs/design/data-model.md "Development is hidden") and returns only a
 * label. No trace, no numbers: the ring learning formula takes the label, and the player reads the
 * fixed line "Limited by potential" whenever it is not `open`, so neither the potential number nor a
 * ceiling can reach player text.
 *
 * - `closed`: potential below 0, or the attribute at or above its ceiling;
 * - `slowing`: the attribute within `match.learning.slowingBand` of its ceiling, or potential below
 *   `match.learning.lowPotential`;
 * - `open`: otherwise.
 *
 * An attribute without a ceiling is gated on potential only.
 *
 * Not exported from the engine's public index: only the match system reads it.
 *
 * Design: docs/design/physical-toll.md#ring-learning.
 */

import type { AttributeKey, Person } from '../../../model/entities/person';
import type { EngineTunables } from '../../tunables';

export const LEARNING_ROOMS = ['open', 'slowing', 'closed'] as const;

/** How much room a worker has left to learn one attribute. */
export type LearningRoom = (typeof LEARNING_ROOMS)[number];

/** Potential below this closes learning altogether: the worker is past growing. */
const CLOSED_BELOW_POTENTIAL = 0;

/** The room `person` has left to learn `attribute`. */
export function learningRoom(
  person: Pick<Person, 'attributes' | 'development'>,
  attribute: AttributeKey,
  tunables: EngineTunables,
): LearningRoom {
  const { potential, ceilings } = person.development;
  const value = person.attributes[attribute];
  const ceiling = ceilings[attribute];
  if (potential < CLOSED_BELOW_POTENTIAL || (ceiling !== undefined && value >= ceiling)) {
    return 'closed';
  }
  const nearCeiling =
    ceiling !== undefined && ceiling - value <= tunables.get('match.learning.slowingBand');
  if (nearCeiling || potential < tunables.get('match.learning.lowPotential')) {
    return 'slowing';
  }
  return 'open';
}
