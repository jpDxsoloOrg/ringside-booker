/**
 * When a storyline shows as Hot (CRTV3-01): heat at or above `storylines.heat.hotFrom`. Display
 * only; the story shield (D-09) and the rival booker read their own heat lines.
 *
 * Design: docs/design/storylines.md#hot-storylines.
 */

export const HOT_STORYLINE_DOC_REF = 'storylines.md#hot-storylines';

/** True when `heat` reaches `hotFrom`. */
export function isHotHeat(heat: number, hotFrom: number): boolean {
  return heat >= hotFrom;
}
