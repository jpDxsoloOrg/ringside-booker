/**
 * A rival's taste: the eight axes its decisions lean on, each 0-100.
 *
 * The stored shape lives with the profile row (`model/entities/ai-profile.ts`), so the model never
 * imports from a system; this module re-exports it with the screen labels. The formula that works
 * a taste out from a promotion's style is `formulas/defaultTaste.ts` (AIP1-04), and `tasteOf` below
 * picks the taste a unit decides with. See docs/design/rival-desk.md#taste.
 */

import {
  TASTE_AXES,
  TasteSchema,
  type Taste,
  type TasteAxis,
} from '../../model/entities/ai-profile';
import { EntityNotFoundError } from '../../core/errors';
import type { BrandId, PromotionId } from '../../core/ids';
import { inputOf } from '../../core/trace';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';
import { defaultTaste, tasteFromAxes, type TracedTaste } from './formulas/defaultTaste';
import { profileOf } from './profiles';

export { TASTE_AXES, TasteSchema, type Taste, type TasteAxis, type TracedTaste };

/** What screens call each axis. */
export const TASTE_AXIS_LABELS: Readonly<Record<TasteAxis, string>> = Object.freeze({
  wrestlingFocus: 'Wrestling focus',
  entertainmentFocus: 'Entertainment focus',
  athleticFocus: 'Athletic focus',
  starFocus: 'Star focus',
  talkShare: 'Talk share',
  titleFocus: 'Title focus',
  youthFocus: 'Youth focus',
  riskAppetite: 'Risk appetite',
});

/** What a trace line calls a taste the booker set (AIP2), rather than the style default. */
export const STORED_TASTE_LABEL = 'Booker taste';

/** A stored taste as a traced taste: each axis is the stored value, as an input. */
export function storedTaste(taste: DeepReadonly<Taste>): TracedTaste {
  return tasteFromAxes(
    (axis) =>
      inputOf(
        `${TASTE_AXIS_LABELS[axis]} (${STORED_TASTE_LABEL})`,
        taste[axis],
        undefined,
        'points',
      ),
    'stored',
    STORED_TASTE_LABEL,
  );
}

/**
 * The taste a unit decides with: its profile's stored taste when it has one (AIP2 fills it), else
 * its promotion's style default. A human promotion has no profile, so it gets its style default,
 * which is how "how would a rival value this worker" and AIP3's advisory pushes read it.
 *
 * @throws EntityNotFoundError when the promotion is not in the world.
 */
export function tasteOf(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
  brandId: BrandId | null = null,
): TracedTaste {
  const stored = profileOf(read, promotionId, brandId)?.taste ?? null;
  if (stored !== null) {
    return storedTaste(stored);
  }
  const promotion = read.tables.promotions.get(promotionId);
  if (promotion === undefined) {
    throw new EntityNotFoundError('promotions', promotionId);
  }
  return defaultTaste({ style: promotion.style }, { tunables });
}
