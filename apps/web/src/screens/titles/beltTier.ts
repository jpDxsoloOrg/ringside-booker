import type { ImageTier } from '@/components/ImageSlot';

/**
 * The belt metal a title is drawn in, from its prestige. A display table only, not a game number:
 * a big title looks gold, a minor one plain. Owner art (`imageRef`) replaces the placeholder belt
 * through the image resolver whatever the tier.
 */
export const BELT_TIER_FLOORS: readonly { readonly tier: ImageTier; readonly from: number }[] = [
  { tier: 'gold', from: 70 },
  { tier: 'silver', from: 45 },
  { tier: 'bronze', from: 20 },
];

/** Gold from 70 prestige, silver from 45, bronze from 20, plain below. */
export function beltTierOf(prestige: number): ImageTier {
  return BELT_TIER_FLOORS.find((floor) => prestige >= floor.from)?.tier ?? 'plain';
}
