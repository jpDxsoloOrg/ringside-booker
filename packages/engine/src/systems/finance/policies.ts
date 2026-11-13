/**
 * The three staff policies a promotion sets (travel, catering, medical), each at a level from 0
 * (None) to 3 (Premium): the words the player reads for them. One source for the engine's traces
 * and the web app.
 *
 * Design: docs/design/finances.md#policies.
 */

import { POLICY_AREAS, type PolicyArea } from '../../model/entities/promotion';

export { POLICY_AREAS, type PolicyArea };

/** A policy level, 0 (none) to 3 (best). */
export type PolicyLevel = 0 | 1 | 2 | 3;

/** Every policy level, lowest first. */
export const POLICY_LEVELS: readonly PolicyLevel[] = Object.freeze([0, 1, 2, 3] as const);

/** What the player reads for each policy level, indexed by level. */
export const POLICY_LEVEL_LABELS = Object.freeze(['None', 'Basic', 'Good', 'Premium'] as const);

/** The name of each policy area. */
export const POLICY_AREA_LABELS: Readonly<Record<PolicyArea, string>> = Object.freeze({
  travel: 'Travel',
  catering: 'Catering',
  medical: 'Medical',
});

/** One line on what each policy area pays for. */
export const POLICY_AREA_DESCRIPTIONS: Readonly<Record<PolicyArea, string>> = Object.freeze({
  travel: 'Travel: who pays for getting to shows',
  catering: 'Catering: food backstage on show nights',
  medical: 'Medical: care for everyone under contract, paid monthly',
});

/** True when `value` is a policy level. */
export function isPolicyLevel(value: number): value is PolicyLevel {
  return value === 0 || value === 1 || value === 2 || value === 3;
}
