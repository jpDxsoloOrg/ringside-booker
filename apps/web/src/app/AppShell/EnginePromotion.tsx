import type { ReactNode } from 'react';
import { useEngineQuery } from '../engine/useEngineQuery';
import type { ShellPromotion } from './shellPreview';

export interface EnginePromotionProps {
  /** Shown, marked as a sample, until the engine names the player's promotion. */
  readonly fallback: ShellPromotion | null;
  /** Draws the shell with the promotion to show and whether it is the sample. */
  readonly children: (promotion: ShellPromotion | null, sample: boolean) => ReactNode;
}

/**
 * Reads the player's promotion from `sim.status` (the same query the top bar uses, so it costs no
 * extra round trip) and hands it to the shell for the sidebar crest and the phone crest. While the
 * engine has not answered, or answers without a promotion (the dev helper's faked world), the
 * sample promotion stays and is marked as one.
 */
export function EnginePromotion({ fallback, children }: EnginePromotionProps) {
  const status = useEngineQuery('sim.status', {});
  const promotion = status.data?.promotion ?? null;
  if (promotion === null) return children(fallback, true);
  return children(
    { id: promotion.promotionId, name: promotion.name, shortName: promotion.shortName },
    false,
  );
}
