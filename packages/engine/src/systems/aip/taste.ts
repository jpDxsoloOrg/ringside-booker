/**
 * A rival's taste: the eight axes its decisions lean on, each 0-100.
 *
 * The stored shape lives with the profile row (`model/entities/ai-profile.ts`), so the model never
 * imports from a system; this module re-exports it with the screen labels. The formula that works
 * a taste out from a promotion's style comes with AIP1-04. See docs/design/rival-desk.md#taste.
 */

import {
  TASTE_AXES,
  TasteSchema,
  type Taste,
  type TasteAxis,
} from '../../model/entities/ai-profile';

export { TASTE_AXES, TasteSchema, type Taste, type TasteAxis };

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
