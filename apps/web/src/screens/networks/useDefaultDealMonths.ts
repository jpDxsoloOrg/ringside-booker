import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { BROADCAST_CATEGORY, DEFAULT_MONTHS_KEY, FALLBACK_DEFAULT_MONTHS } from './networkText';

/** `broadcast.deal.defaultMonths` from `tunables.list` (saved with the game), 24 until it loads. */
export function useDefaultDealMonths(): number {
  const rules = useEngineQuery(
    'tunables.list',
    { category: BROADCAST_CATEGORY },
    { keepPreviousData: true },
  );
  const value = rules.data?.find((row) => row.key === DEFAULT_MONTHS_KEY)?.value;
  return typeof value === 'number' ? value : FALLBACK_DEFAULT_MONTHS;
}
