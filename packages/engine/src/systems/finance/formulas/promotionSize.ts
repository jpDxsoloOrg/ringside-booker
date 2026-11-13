/**
 * Promotion size: the display label read off reach (Local, Regional, National, Continental,
 * Global).
 *
 * The label is for screens only. No formula reads it: ticket prices, sponsorship, TV deal value and
 * what workers ask for all read reach itself, which is smooth, so nothing jumps when a company
 * crosses a threshold.
 *
 * Design: docs/design/finances.md#reach-and-size.
 */

import { startDecision, type Traced } from '../../../core/trace';
import type { EngineTunables } from '../../tunables';
import { REACH_DOC_REF } from './promotionReach';

/** Every size, smallest first. */
export const PROMOTION_SIZES = ['local', 'regional', 'national', 'continental', 'global'] as const;

export type PromotionSize = (typeof PROMOTION_SIZES)[number];

/** The words a player reads for each size. */
export const PROMOTION_SIZE_LABELS: Readonly<Record<PromotionSize, string>> = {
  local: 'Local',
  regional: 'Regional',
  national: 'National',
  continental: 'Continental',
  global: 'Global',
};

/** The sizes that have a threshold, smallest first. Local is what is left below Regional. */
export type ThresholdSize = Exclude<PromotionSize, 'local'>;

export const THRESHOLD_SIZES: readonly ThresholdSize[] = [
  'regional',
  'national',
  'continental',
  'global',
];

/** The tunable that holds each size's threshold. */
export const SIZE_THRESHOLD_KEYS = {
  regional: 'finance.size.regionalAt',
  national: 'finance.size.nationalAt',
  continental: 'finance.size.continentalAt',
  global: 'finance.size.globalAt',
} as const satisfies Record<ThresholdSize, string>;

/** The note a size trace carries when the thresholds are not in rising order. */
export const THRESHOLDS_OUT_OF_ORDER_NOTE = 'Thresholds are out of order';

/** Each threshold size's reach threshold as the tunables set it, untraced (for "next size" lines). */
export function sizeThresholds(tunables: EngineTunables): Record<ThresholdSize, number> {
  return {
    regional: tunables.get(SIZE_THRESHOLD_KEYS.regional),
    national: tunables.get(SIZE_THRESHOLD_KEYS.national),
    continental: tunables.get(SIZE_THRESHOLD_KEYS.continental),
    global: tunables.get(SIZE_THRESHOLD_KEYS.global),
  };
}

function formatReach(value: number): string {
  return value.toFixed(1);
}

/**
 * The size label for a reach: the largest size whose threshold reach has reached, or Local when it
 * has reached none. The walk always goes from Global down, so thresholds tuned out of order still
 * give an answer (the trace notes it) and never throw.
 */
export function promotionSize(
  reach: Traced<number>,
  deps: { tunables: EngineTunables },
): Traced<PromotionSize> {
  const decision = startDecision<PromotionSize>('Company size', { docRef: REACH_DOC_REF });
  decision.note(`Reach is ${formatReach(reach.value)}`);

  const readThreshold = (size: ThresholdSize): number =>
    decision.tunable(
      deps.tunables,
      SIZE_THRESHOLD_KEYS[size],
      `${PROMOTION_SIZE_LABELS[size]} threshold`,
    );
  // Smallest first, so the trace lists the thresholds in rising order.
  const thresholds: Record<ThresholdSize, number> = {
    regional: readThreshold('regional'),
    national: readThreshold('national'),
    continental: readThreshold('continental'),
    global: readThreshold('global'),
  };
  const inOrder = THRESHOLD_SIZES.every((size, index) => {
    const smaller = THRESHOLD_SIZES[index - 1];
    return smaller === undefined || thresholds[smaller] <= thresholds[size];
  });
  if (!inOrder) {
    decision.note(THRESHOLDS_OUT_OF_ORDER_NOTE);
  }

  // From the largest size down; the first threshold reach has reached wins.
  for (let index = THRESHOLD_SIZES.length - 1; index >= 0; index -= 1) {
    const size = THRESHOLD_SIZES[index];
    if (size === undefined) {
      continue;
    }
    const label = PROMOTION_SIZE_LABELS[size];
    const at = thresholds[size];
    const passed = reach.value >= at;
    decision.rule(`Reach ≥ ${label} threshold (${String(at)})`, passed);
    if (passed) {
      const larger = THRESHOLD_SIZES[index + 1];
      const notYet =
        larger === undefined
          ? ''
          : ` but not the ${PROMOTION_SIZE_LABELS[larger]} threshold (${String(thresholds[larger])})`;
      return decision.choose(
        size,
        `Reach ${formatReach(reach.value)} reached the ${label} threshold (${String(at)})${notYet}`,
      );
    }
  }
  return decision.choose(
    'local',
    `Reach ${formatReach(reach.value)} is below the Regional threshold (${String(thresholds.regional)})`,
  );
}
