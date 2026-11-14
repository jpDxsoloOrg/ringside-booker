import { useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { WorkerRow } from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { workerLinkState } from '@/app/entityLinks';
import { routes } from '@/app/routes';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import type { SortState } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import type { EmptyStateProps } from '@/components/EmptyState';
import { formatNumber } from '@/components/format';
import { Sheet } from '@/components/Sheet';
import { useTracePanelStore } from '@/components/Trace';
import { useIsMobile } from '@/styles/useMediaQuery';
import { compareWorkerTies, INJURED_WORKER_COLUMNS, WORKER_COLUMNS } from './workerColumns';
import { NO_WORKER_FACETS, WorkersFilterBar } from './WorkersFilterBar';
import {
  activeFilterCount,
  filtersFromSearch,
  listArgsFor,
  NO_WORKERS_FILTERS,
  searchWithFilters,
  searchWithSort,
  sortFromSearch,
} from './workersListParams';
import type { WorkersFilterState } from './workersListParams';
import styles from './WorkersScreen.module.css';

const TITLE = 'Workers';
const NO_ROWS: readonly WorkerRow[] = [];

function rowId(row: WorkerRow): string {
  return row.personId;
}

function rowLabel(row: WorkerRow): string {
  return row.ringName;
}

function errorText(error: EngineQueryError | null): string {
  if (error === null) return 'Something went wrong.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ');
}

function counted(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

/** "286 people · 44 free agents": everyone in the world, before any filter. */
export function workersCountText(total: number, freeAgents: number): string {
  return `${counted(total, 'person', 'people')} · ${counted(freeAgents, 'free agent', 'free agents')}`;
}

/** The phone's filter button: "Filters", or "Filters (2)" while some are set. */
export function filtersButtonText(activeCount: number): string {
  return activeCount === 0 ? 'Filters' : `Filters (${String(activeCount)})`;
}

/** What the empty list says: nobody hurt, nobody matching, or an empty world. */
function emptyCopy(
  activeCount: number,
  injuredOnly: boolean,
  clearFilters: () => void,
): Pick<EmptyStateProps, 'title' | 'body' | 'action'> {
  if (injuredOnly && activeCount === 1) {
    return { title: 'Nobody is injured', body: 'Everyone in the world is fit to work.' };
  }
  if (activeCount > 0) {
    return {
      title: 'Nobody matches these filters',
      body: 'Loosen a filter, or clear them all.',
      action: (
        <Button size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      ),
    };
  }
  return { title: 'Nobody to show', body: 'This world has no people in it.' };
}

/**
 * World > Workers: everyone in the world in one sortable, filterable list. A table on desktop;
 * below `--bp-mobile` the rows become cards and the filters move into a bottom sheet.
 *
 * The filters and the sort live in the URL (see `workersListParams.ts`). The engine applies the
 * filters; the screen sorts the rows it gets back, so re-sorting asks the engine nothing. If the
 * engine cannot answer (no world, a refusal), the screen says why instead of showing a table.
 */
export function WorkersScreen() {
  useDocumentTitle(TITLE);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  const filters = useMemo(() => filtersFromSearch(searchParams), [searchParams]);
  const sort = useMemo(() => sortFromSearch(searchParams), [searchParams]);
  const listArgs = useMemo(() => listArgsFor(filters), [filters]);
  const query = useEngineQuery('workers.list', listArgs, { keepPreviousData: true });

  // Replace, so Back leaves the list instead of stepping back through every filter change.
  const changeFilters = useCallback(
    (next: WorkersFilterState): void => {
      setSearchParams((current) => searchWithFilters(current, next), { replace: true });
    },
    [setSearchParams],
  );
  const changeSort = useCallback(
    (next: SortState): void => {
      setSearchParams((current) => searchWithSort(current, next), { replace: true });
    },
    [setSearchParams],
  );
  const openProfile = useCallback(
    (row: WorkerRow): void => {
      useTracePanelStore.setState({ openPanelId: null });
      navigate(routes.game.worker(row.personId), { state: workerLinkState(location) });
    },
    [navigate, location],
  );

  const failed = query.status === 'error';
  const list = failed ? undefined : query.data;
  const rows = list?.rows ?? NO_ROWS;
  const facets = list?.facets ?? NO_WORKER_FACETS;
  const activeCount = activeFilterCount(filters);
  const clearFilters = (): void => {
    changeFilters(NO_WORKERS_FILTERS);
  };
  // The "Injured" quick filter is the availability filter set to injured (`?availability=injured`).
  const injuredOnly = filters.availability === 'injured';
  // The injury columns follow the rows on screen, not the URL: while the injured list loads, the
  // previous (full) list stays up with its own columns. Re-laying every row of the full list out
  // with the injury columns only to drop them a moment later held the toggle's pressed state back
  // by a second or more, and past five seconds on WebKit under load (WRK6-09).
  const [rowsAreInjuredOnly, setRowsAreInjuredOnly] = useState(injuredOnly);
  if (!query.isPreviousData && rowsAreInjuredOnly !== injuredOnly) {
    setRowsAreInjuredOnly(injuredOnly);
  }
  const toggleInjured = (): void => {
    changeFilters({ ...filters, availability: injuredOnly ? null : 'injured' });
  };

  // One tree for every state, so the heading RouteFocus focused on arrival stays mounted when the
  // query settles into an error: swapping in a second heading dropped focus to <body>.
  return (
    <div className={styles['screen']}>
      <div className={styles['intro']}>
        <RouteHeading className={styles['heading']}>{TITLE}</RouteHeading>
        {list !== undefined && (
          <p className={styles['count']}>
            <span className="tabular">{workersCountText(list.total, list.freeAgents)}</span>
            {activeCount > 0 && (
              <span className={styles['shown']} role="status">
                {`${formatNumber(rows.length)} shown`}
              </span>
            )}
          </p>
        )}
      </div>

      {failed ? (
        <EmptyState
          size="page"
          icon="user-search"
          title="The workers list could not be loaded"
          body={errorText(query.error)}
        />
      ) : (
        <>
          <div className={styles['quickFilters']}>
            <Button
              size="sm"
              variant={injuredOnly ? 'primary' : 'secondary'}
              iconStart="injured"
              aria-pressed={injuredOnly}
              onClick={toggleInjured}
            >
              Injured
            </Button>
          </div>
          {isMobile ? (
            <div className={styles['filterButton']}>
              <Button
                variant="secondary"
                iconStart="settings"
                aria-haspopup="dialog"
                onClick={() => {
                  setSheetOpen(true);
                }}
              >
                {filtersButtonText(activeCount)}
              </Button>
              <Sheet
                open={sheetOpen}
                onClose={() => {
                  setSheetOpen(false);
                }}
                title="Filters"
                side="bottom"
                size="lg"
                footer={
                  <Button
                    variant="primary"
                    onClick={() => {
                      setSheetOpen(false);
                    }}
                  >
                    {`Show ${counted(rows.length, 'worker', 'workers')}`}
                  </Button>
                }
              >
                <WorkersFilterBar
                  filters={filters}
                  facets={facets}
                  onChange={changeFilters}
                  layout="sheet"
                />
              </Sheet>
            </div>
          ) : (
            <section className={styles['filterPanel']} aria-label="Filters">
              <WorkersFilterBar filters={filters} facets={facets} onChange={changeFilters} />
            </section>
          )}

          <DataTable
            className={styles['table']}
            rows={rows}
            columns={rowsAreInjuredOnly ? INJURED_WORKER_COLUMNS : WORKER_COLUMNS}
            getRowId={rowId}
            compareTies={compareWorkerTies}
            getRowLabel={rowLabel}
            caption={TITLE}
            sort={sort}
            onSortChange={changeSort}
            filterable
            filterLabel="Search by name"
            columnPicker
            loading={query.status === 'loading'}
            // On a phone the name is the way in: its link covers the whole card (see the CSS), so the
            // card is not a button with a link and more buttons inside it.
            {...(isMobile ? {} : { onActivate: openProfile })}
            emptyState={
              <EmptyState
                icon="user-search"
                {...emptyCopy(activeCount, injuredOnly, clearFilters)}
              />
            }
          />
        </>
      )}
    </div>
  );
}
