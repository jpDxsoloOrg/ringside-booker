/**
 * Style taste tunables: what a promotion of each style values before its booker makes a taste of
 * their own (AIP2). One tunable per style and taste axis (`aip.styleTaste.<style>.<axis>`), 56 in
 * all, so a balance profile can make technical promotions care less about talkers without code.
 *
 * Design: docs/design/rival-desk.md#taste.
 */

import { TunableDefinitionError, type NumberTunableDef } from '../../core/tunables/define';
import { PROMOTION_STYLES, type PromotionStyle } from '../../model/entities/promotion-style';
import { PROMOTION_STYLE_LABELS } from '../match/formulas/segmentScore';
import { TASTE_AXES, TASTE_AXIS_LABELS, type TasteAxis } from './taste';

/** The tunable key of one style's default for one taste axis. */
export type StyleTasteKey = `aip.styleTaste.${PromotionStyle}.${TasteAxis}`;

export const STYLE_TASTE_CATEGORY = 'Rival taste';
export const TASTE_DOC_REF = 'rival-desk.md#taste';

const TASTE_MIN = 0;
const TASTE_MAX = 100;
const TASTE_STEP = 5;

/**
 * The defaults, in `TASTE_AXES` order: wrestling, entertainment, athletic, star, talk share, title,
 * youth, risk.
 */
export const DEFAULT_STYLE_TASTE: Readonly<
  Record<PromotionStyle, Readonly<Record<TasteAxis, number>>>
> = {
  mainstream: tasteRow([50, 60, 45, 70, 35, 55, 45, 35]),
  traditional: tasteRow([65, 45, 40, 55, 25, 60, 40, 35]),
  technical: tasteRow([85, 30, 45, 40, 15, 55, 45, 25]),
  hardHitting: tasteRow([80, 30, 40, 50, 15, 65, 40, 55]),
  hardcore: tasteRow([50, 45, 45, 45, 25, 45, 50, 90]),
  highFlying: tasteRow([55, 40, 90, 45, 20, 50, 60, 55]),
  entertainment: tasteRow([35, 85, 40, 75, 50, 50, 40, 30]),
};

type EightNumbers = readonly [number, number, number, number, number, number, number, number];

function tasteRow(values: EightNumbers): Record<TasteAxis, number> {
  const [
    wrestlingFocus,
    entertainmentFocus,
    athleticFocus,
    starFocus,
    talkShare,
    titleFocus,
    youthFocus,
    riskAppetite,
  ] = values;
  return {
    wrestlingFocus,
    entertainmentFocus,
    athleticFocus,
    starFocus,
    talkShare,
    titleFocus,
    youthFocus,
    riskAppetite,
  };
}

/** The key of `style`'s default for `axis`. */
export function styleTasteKey(style: PromotionStyle, axis: TasteAxis): StyleTasteKey {
  return `aip.styleTaste.${style}.${axis}`;
}

/** True when `definitions` holds a default for every style and axis. */
function holdsEveryStyleTaste(
  definitions: Readonly<Record<string, NumberTunableDef>>,
): definitions is Record<StyleTasteKey, NumberTunableDef> {
  return PROMOTION_STYLES.every((style) =>
    TASTE_AXES.every((axis) => Object.hasOwn(definitions, styleTasteKey(style, axis))),
  );
}

/** One tunable for every style and taste axis, in style then axis order. */
export function styleTasteTunables(): Record<StyleTasteKey, NumberTunableDef> {
  const definitions: Record<string, NumberTunableDef> = {};
  for (const style of PROMOTION_STYLES) {
    for (const axis of TASTE_AXES) {
      definitions[styleTasteKey(style, axis)] = {
        kind: 'number',
        default: DEFAULT_STYLE_TASTE[style][axis],
        min: TASTE_MIN,
        max: TASTE_MAX,
        step: TASTE_STEP,
        unit: 'points',
        category: STYLE_TASTE_CATEGORY,
        description: `${TASTE_AXIS_LABELS[axis]} of a ${PROMOTION_STYLE_LABELS[style].toLowerCase()} promotion until its booker sets a taste`,
        docRef: TASTE_DOC_REF,
      };
    }
  }
  // The loops fill in every key; the check is what tells the compiler so.
  if (!holdsEveryStyleTaste(definitions)) {
    throw new TunableDefinitionError(['aip.styleTaste: a style and axis pair has no default']);
  }
  return definitions;
}
