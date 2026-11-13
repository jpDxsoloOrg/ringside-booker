/**
 * Default taste: what a promotion values before its booker makes a taste of their own.
 *
 * Every axis is its style's tunable (`aip.styleTaste.<style>.<axis>`), kept within 0-100. A
 * hard-hitting promotion leans on ring work, an entertainment promotion on talkers. AIP2 stores a
 * booker-made taste per rival, and `tasteOf` (`systems/aip/taste.ts`) prefers it.
 *
 * Design: docs/design/rival-desk.md#taste.
 */

import { startCalc, type Traced, type TraceNode } from '../../../core/trace';
import type { Taste, TasteAxis } from '../../../model/entities/ai-profile';
import type { PromotionStyle } from '../../../model/entities/promotion-style';
import { PROMOTION_STYLE_LABELS } from '../../match/formulas/segmentScore';
import type { EngineTunables } from '../../tunables';
import { TASTE_AXIS_LABELS } from '../taste';
import type { StyleTasteKey } from '../tasteTunables';

/** The ends of every taste axis. */
export const TASTE_MIN = 0;
export const TASTE_MAX = 100;

const TASTE_DOC_REF = 'rival-desk.md#taste';

/** A taste with a trace per axis, and where it came from. */
export interface TracedTaste {
  readonly values: Taste;
  readonly traces: Readonly<Record<TasteAxis, TraceNode>>;
  /** `style` for a style default, `stored` for a booker-made taste on the profile. */
  readonly source: 'style' | 'stored';
  /** What a trace line calls the taste: "Style taste: Hard-hitting" or "Booker taste". */
  readonly label: string;
}

export interface DefaultTasteInputs {
  style: PromotionStyle;
}

/** "Style taste: Hard-hitting". */
export function styleTasteLabel(style: PromotionStyle): string {
  return `Style taste: ${PROMOTION_STYLE_LABELS[style]}`;
}

/** One value per taste axis, worked out by `pick`. */
export function mapTasteAxes<T>(pick: (axis: TasteAxis) => T): Record<TasteAxis, T> {
  return {
    wrestlingFocus: pick('wrestlingFocus'),
    entertainmentFocus: pick('entertainmentFocus'),
    athleticFocus: pick('athleticFocus'),
    starFocus: pick('starFocus'),
    talkShare: pick('talkShare'),
    titleFocus: pick('titleFocus'),
    youthFocus: pick('youthFocus'),
    riskAppetite: pick('riskAppetite'),
  };
}

/** Builds a taste from one traced number per axis. */
export function tasteFromAxes(
  axis: (axis: TasteAxis) => Traced<number>,
  source: TracedTaste['source'],
  label: string,
): TracedTaste {
  const results = mapTasteAxes(axis);
  return {
    values: mapTasteAxes((key) => results[key].value),
    traces: mapTasteAxes((key) => results[key].trace),
    source,
    label,
  };
}

/** A promotion's taste from its style: each axis is the style's tunable, kept within 0-100. */
export function defaultTaste(
  inputs: DefaultTasteInputs,
  deps: { tunables: EngineTunables },
): TracedTaste {
  const styleLabel = PROMOTION_STYLE_LABELS[inputs.style];
  return tasteFromAxes(
    (axis) => {
      const key: StyleTasteKey = `aip.styleTaste.${inputs.style}.${axis}`;
      const calc = startCalc(TASTE_AXIS_LABELS[axis], 0, {
        unit: 'points',
        docRef: TASTE_DOC_REF,
        startLabel: 'Nothing counted yet',
      });
      return calc
        .add(`Style default (${styleLabel})`, calc.tunable(deps.tunables, key))
        .clamp(TASTE_MIN, TASTE_MAX)
        .done();
    },
    'style',
    styleTasteLabel(inputs.style),
  );
}
