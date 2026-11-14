import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ColumnDef, SortState } from '@/components/DataTable';
import {
  searchTextFromSearch,
  searchWithSearchText,
  searchWithSort,
  sortFromSearch,
} from './contractsListParams';

export interface ListUrlState {
  readonly sort: SortState;
  readonly onSortChange: (sort: SortState) => void;
  readonly searchText: string;
  readonly onSearchTextChange: (text: string) => void;
}

/**
 * A Contracts list's sort and search box, kept in the URL (ECO5-09): `sort=ask:desc` when it is
 * one of `columns`' sortable ones (else `fallback`, the tab's own order) and `q=` for the search.
 * Changes replace the entry, so Back leaves the screen instead of stepping through every click.
 */
export function useListUrlState<Row>(
  columns: readonly ColumnDef<Row>[],
  fallback: SortState,
): ListUrlState {
  const [searchParams, setSearchParams] = useSearchParams();
  const sortable = useMemo(
    () => columns.filter((column) => column.sortValue !== undefined).map((column) => column.id),
    [columns],
  );
  const sort = sortFromSearch(searchParams, sortable, fallback);
  const onSortChange = useCallback(
    (next: SortState): void => {
      setSearchParams((current) => searchWithSort(current, next, fallback), { replace: true });
    },
    [setSearchParams, fallback],
  );
  const onSearchTextChange = useCallback(
    (text: string): void => {
      setSearchParams((current) => searchWithSearchText(current, text), { replace: true });
    },
    [setSearchParams],
  );
  return { sort, onSortChange, searchText: searchTextFromSearch(searchParams), onSearchTextChange };
}
