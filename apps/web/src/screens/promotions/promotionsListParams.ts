import type { SortState } from '@/components/DataTable';

/** The Promotions list's search parameters: `?sort=prestige&dir=asc`. */
export const PROMOTIONS_LIST_PARAMS = { sort: 'sort', direction: 'dir' } as const;

/** The list's order when the URL names none: most popular at home first. */
export const DEFAULT_PROMOTIONS_SORT = {
  columnId: 'popularity',
  direction: 'desc',
} as const satisfies SortState;

/** The sort the URL asks for, or the default for a missing or unknown column. */
export function promotionsSortFromSearch(
  search: URLSearchParams,
  sortableIds: readonly string[],
): SortState {
  const columnId = search.get(PROMOTIONS_LIST_PARAMS.sort);
  if (columnId === null || !sortableIds.includes(columnId)) return DEFAULT_PROMOTIONS_SORT;
  const direction = search.get(PROMOTIONS_LIST_PARAMS.direction) === 'asc' ? 'asc' : 'desc';
  return { columnId, direction };
}

/** The search with `sort` written in; the default sort leaves the URL bare. */
export function searchWithPromotionsSort(
  current: URLSearchParams,
  sort: SortState,
): URLSearchParams {
  const next = new URLSearchParams(current);
  const isDefault =
    sort === null ||
    (sort.columnId === DEFAULT_PROMOTIONS_SORT.columnId &&
      sort.direction === DEFAULT_PROMOTIONS_SORT.direction);
  if (isDefault) {
    next.delete(PROMOTIONS_LIST_PARAMS.sort);
    next.delete(PROMOTIONS_LIST_PARAMS.direction);
  } else {
    next.set(PROMOTIONS_LIST_PARAMS.sort, sort.columnId);
    next.set(PROMOTIONS_LIST_PARAMS.direction, sort.direction);
  }
  return next;
}
