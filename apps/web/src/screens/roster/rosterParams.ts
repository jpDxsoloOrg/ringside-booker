import { isId, ROSTER_ROLE_GROUPS } from '@ringside/engine';
import type { BrandId, RosterBrandCount, RosterRoleGroup } from '@ringside/engine';

/**
 * The roster's tab and brand in the URL (`?tab=referees&brand=brd_…`), so a reload and Back keep
 * them. A missing or unknown value falls back to Wrestlers and All brands.
 */

export const TAB_PARAM = 'tab';
export const BRAND_PARAM = 'brand';

/** The tab shown when the URL names none, or one that does not exist. */
export const DEFAULT_TAB: RosterRoleGroup = 'wrestlers';

/** The `?brand=` value (and the Select's value) for the contracts on no brand. */
export const SHARED_BRAND = 'shared';
/** The brand Select's value for every brand; never written to the URL. */
export const ALL_BRANDS = 'all';

export type RosterBrandFilter = BrandId | typeof SHARED_BRAND | null;

export function isRoleGroup(value: string): value is RosterRoleGroup {
  return ROSTER_ROLE_GROUPS.some((group) => group === value);
}

/**
 * The tab the URL asks for: a role group, or a registered tab's id. Anything else is Wrestlers.
 */
export function tabFromSearch(search: URLSearchParams, registeredIds: readonly string[]): string {
  const asked = search.get(TAB_PARAM);
  if (asked === null) return DEFAULT_TAB;
  return isRoleGroup(asked) || registeredIds.includes(asked) ? asked : DEFAULT_TAB;
}

/** The brand filter a URL or Select value names: a brand, Shared, or null for All brands. */
export function brandFromValue(value: string | null): RosterBrandFilter {
  if (value === SHARED_BRAND) return SHARED_BRAND;
  return isId('brand', value) ? value : null;
}

/** The brand the URL asks for, before it is checked against the roster's brands. */
export function brandFromSearch(search: URLSearchParams): RosterBrandFilter {
  return brandFromValue(search.get(BRAND_PARAM));
}

/**
 * The brand filter once the roster's brands are known: a brand it does not have (or "Shared" when
 * every contract has a brand) is All brands.
 */
export function knownBrand(
  brand: RosterBrandFilter,
  byBrand: readonly RosterBrandCount[] | undefined,
): RosterBrandFilter {
  if (brand === null || byBrand === undefined) return brand;
  const wanted = brand === SHARED_BRAND ? null : brand;
  return byBrand.some((entry) => entry.brandId === wanted) ? brand : null;
}

/** `search` with the tab set; the default tab is left out of the URL. */
export function searchWithTab(search: URLSearchParams, tab: string): URLSearchParams {
  const next = new URLSearchParams(search);
  if (tab === DEFAULT_TAB) next.delete(TAB_PARAM);
  else next.set(TAB_PARAM, tab);
  return next;
}

/** `search` with the brand set; All brands is left out of the URL. */
export function searchWithBrand(
  search: URLSearchParams,
  brand: RosterBrandFilter,
): URLSearchParams {
  const next = new URLSearchParams(search);
  if (brand === null) next.delete(BRAND_PARAM);
  else next.set(BRAND_PARAM, brand);
  return next;
}
