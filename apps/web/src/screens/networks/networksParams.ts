import { isId } from '@ringside/engine';
import type { DealId, NetworkId } from '@ringside/engine';
import { routes } from '@/app/routes';

/**
 * The Networks screen's state in the URL, so links, a reload and Back land in the same place:
 * `?tab=<registered tab id>`, `?deal=dea_…` (the open deal sheet) and `?propose=net_…` (the
 * Propose sheet on a network).
 */

export const TAB_PARAM = 'tab';
export const DEAL_PARAM = 'deal';
export const PROPOSE_PARAM = 'propose';

/** The built-in tabs' ids (also their `?tab=` values). */
export const YOUR_DEALS_TAB_ID = 'eco.yourDeals';
export const AVAILABLE_TAB_ID = 'eco.available';

export function dealFromSearch(search: URLSearchParams): DealId | null {
  const asked = search.get(DEAL_PARAM);
  return isId('deal', asked) ? asked : null;
}

export function proposeFromSearch(search: URLSearchParams): NetworkId | null {
  const asked = search.get(PROPOSE_PARAM);
  return isId('network', asked) ? asked : null;
}

/** `search` with one parameter set, or removed with null. */
export function searchWith(
  search: URLSearchParams,
  param: typeof TAB_PARAM | typeof DEAL_PARAM | typeof PROPOSE_PARAM,
  value: string | null,
): URLSearchParams {
  const next = new URLSearchParams(search);
  if (value === null) next.delete(param);
  else next.set(param, value);
  return next;
}

/** `/game/networks?tab=…&deal=…`, for links from other screens (the Finances card). */
export function networksPath(
  options: { readonly tab?: string; readonly deal?: DealId } = {},
): string {
  const search = new URLSearchParams();
  if (options.tab !== undefined) search.set(TAB_PARAM, options.tab);
  if (options.deal !== undefined) search.set(DEAL_PARAM, options.deal);
  const query = search.toString();
  return query === '' ? routes.game.networks() : `${routes.game.networks()}?${query}`;
}
