import type { OfferRow, PromotionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { useSessionStore } from '@/app/session/sessionStore';
import { CountBadge } from '@/components/Badge';

const NO_ROWS: readonly OfferRow[] = [];

/**
 * The Offers tab's badge: how many counter-offers wait for your answer. Kept apart from the tab
 * so the tab itself still loads only when it is opened.
 */
export function CounteredOffersBadge() {
  const promotionId = useSessionStore((state) => state.seat?.promotionId ?? null);
  if (promotionId === null) return null;
  return <CounteredCount promotionId={promotionId} />;
}

function CounteredCount({ promotionId }: { readonly promotionId: PromotionId }) {
  const query = useEngineQuery(
    'contracts.offers',
    { promotionId, status: 'open' },
    { keepPreviousData: true },
  );
  const countered = (query.data ?? NO_ROWS).filter((row) => row.status === 'countered').length;
  return <CountBadge count={countered} label={`${String(countered)} countered`} tone="action" />;
}
