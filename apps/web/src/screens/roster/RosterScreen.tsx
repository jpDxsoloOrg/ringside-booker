import { useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ROSTER_ROLE_GROUPS } from '@ringside/engine';
import type {
  PromotionId,
  RosterRoleGroup,
  RosterRow,
  RosterRowsArgs,
  RosterSummary,
  RosterSummaryArgs,
} from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { workerLinkState } from '@/app/entityLinks';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { CountBadge } from '@/components/Badge';
import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatNumber } from '@/components/format';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { Tab, TabList, TabPanel, Tabs } from '@/components/Tabs';
import { useTracePanelStore } from '@/components/Trace';
import { useIsMobile } from '@/styles/useMediaQuery';
import { emptyGroupText, roleGroupLabel } from './labels';
import { columnsFor, compareRosterTies, initialSortFor } from './rosterColumns';
import {
  ALL_BRANDS,
  brandFromSearch,
  brandFromValue,
  isRoleGroup,
  knownBrand,
  searchWithBrand,
  searchWithTab,
  SHARED_BRAND,
  tabFromSearch,
} from './rosterParams';
import type { RosterBrandFilter } from './rosterParams';
import {
  BUILT_IN_TAB_ORDER_START,
  BUILT_IN_TAB_ORDER_STEP,
  useRosterTabs,
} from './rosterTabRegistry';
import type { RosterTabContext, RosterTabDefinition } from './rosterTabRegistry';
import styles from './RosterScreen.module.css';

const TITLE = 'Roster';
const NO_ROWS: readonly RosterRow[] = [];

/** What the screen says when the engine cannot answer at all (no world loaded). */
export const NO_GAME_TEXT = 'Start or load a game to see your roster.';

function rowId(row: RosterRow): string {
  return row.employmentId;
}

function rowLabel(row: RosterRow): string {
  return row.ringName;
}

/** "55 under contract at Altura". */
export function underContractText(total: number, promotionName: string): string {
  return `${formatNumber(total)} under contract at ${promotionName}`;
}

/** The roster's size whatever the brand filter: every brand's count, Shared included. */
function rosterTotal(summary: RosterSummary): number {
  return summary.byBrand.reduce((total, brand) => total + brand.total, 0);
}

/** "All brands (55)", each brand by priority with its size, then "Shared (11)". */
export function brandOptions(summary: RosterSummary): readonly SelectOption[] {
  return [
    { value: ALL_BRANDS, label: `All brands (${formatNumber(rosterTotal(summary))})` },
    ...summary.byBrand.map((brand) => ({
      value: brand.brandId ?? SHARED_BRAND,
      label: `${brand.name} (${formatNumber(brand.total)})`,
    })),
  ];
}

function hasRealBrand(summary: RosterSummary): boolean {
  return summary.byBrand.some((brand) => brand.brandId !== null);
}

/** One tab of the strip: a role group, or a tab another feature registered. */
type RosterTab =
  | { readonly kind: 'group'; readonly id: RosterRoleGroup; readonly order: number }
  | { readonly kind: 'registered'; readonly id: string; readonly definition: RosterTabDefinition };

function tabOrder(tab: RosterTab): number {
  return tab.kind === 'group' ? tab.order : tab.definition.order;
}

const ROLE_TABS: readonly RosterTab[] = ROSTER_ROLE_GROUPS.map((group, index) => ({
  kind: 'group',
  id: group,
  order: BUILT_IN_TAB_ORDER_START + index * BUILT_IN_TAB_ORDER_STEP,
}));

function summaryArgsFor(
  promotionId: PromotionId | undefined,
  brand: RosterBrandFilter,
): RosterSummaryArgs {
  return {
    ...(promotionId === undefined ? {} : { promotionId }),
    ...(brand === null ? {} : { brandId: brand }),
  };
}

interface RosterTableProps {
  readonly group: RosterRoleGroup;
  readonly rows: readonly RosterRow[];
  readonly loading: boolean;
  readonly promotionName: string;
  readonly onActivate: ((row: RosterRow) => void) | undefined;
}

/**
 * One role group's table. WRK2-05 turns on `selectable` here (with `checkedRowIds` held by the
 * screen) for its bulk push change, and adds its row menu as the last column in `columnsFor`.
 */
function RosterTable({ group, rows, loading, promotionName, onActivate }: RosterTableProps) {
  return (
    <DataTable
      className={styles['table']}
      rows={rows}
      columns={columnsFor(group)}
      getRowId={rowId}
      getRowLabel={rowLabel}
      compareTies={compareRosterTies}
      caption={`${roleGroupLabel(group)} at ${promotionName}`}
      initialSort={initialSortFor(group)}
      filterable
      filterLabel="Find a worker"
      columnPicker
      // Eleven columns: the tighter rows let them fit beside the sidebar on a laptop.
      density="compact"
      loading={loading}
      {...(onActivate === undefined ? {} : { onActivate })}
      emptyState={<EmptyState icon="roster" title={emptyGroupText(group)} />}
    />
  );
}

/**
 * Your promotion > Roster: everyone under contract, split into role tabs with counts, narrowed to
 * one brand when the promotion has brands. A sortable table on desktop; cards on a phone, where the
 * tab strip scrolls inside itself and the brand selector spans the width.
 *
 * Every number comes from the engine (`roster.rows`, `roster.summary`); the Why? buttons ask
 * `roster.explain` when opened. The tab and the brand live in the URL. Later features add tabs with
 * `registerRosterTab` (see `rosterTabRegistry.ts`) without touching this file.
 */
export function RosterScreen() {
  useDocumentTitle(TITLE);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const promotionId = useSessionStore((state) => state.seat?.promotionId) ?? undefined;

  const registeredTabs = useRosterTabs();
  const tabs = useMemo<readonly RosterTab[]>(
    () =>
      [
        ...ROLE_TABS,
        ...registeredTabs.map((definition): RosterTab => ({
          kind: 'registered',
          id: definition.id,
          definition,
        })),
      ].sort((left, right) => tabOrder(left) - tabOrder(right)),
    [registeredTabs],
  );
  const registeredIds = useMemo(() => registeredTabs.map((tab) => tab.id), [registeredTabs]);
  const selectedTab = tabFromSearch(searchParams, registeredIds);
  const selectedGroup = isRoleGroup(selectedTab) ? selectedTab : null;
  const askedBrand = brandFromSearch(searchParams);

  const summaryArgs = summaryArgsFor(promotionId, askedBrand);
  const summaryQuery = useEngineQuery('roster.summary', summaryArgs, { keepPreviousData: true });
  const summary = summaryQuery.status === 'error' ? undefined : summaryQuery.data;
  const brand = knownBrand(askedBrand, summary?.byBrand);

  // A brand this roster does not have (a link from another save) is All brands: drop it from the
  // URL, which asks again without it. `byBrand` is the same whatever brand was asked for.
  useEffect(() => {
    if (brand !== askedBrand) {
      setSearchParams((current) => searchWithBrand(current, null), { replace: true });
    }
  }, [brand, askedBrand, setSearchParams]);

  const rowsArgs: RosterRowsArgs = {
    ...summaryArgs,
    ...(selectedGroup === null ? {} : { group: selectedGroup }),
  };
  const rowsQuery = useEngineQuery('roster.rows', rowsArgs, { enabled: selectedGroup !== null });
  const rows = (rowsQuery.status === 'success' ? rowsQuery.data?.rows : undefined) ?? NO_ROWS;

  // Replace, so Back leaves the roster instead of stepping back through every tab.
  const changeTab = useCallback(
    (next: string): void => {
      setSearchParams((current) => searchWithTab(current, next), { replace: true });
    },
    [setSearchParams],
  );
  const changeBrand = useCallback(
    (next: string): void => {
      setSearchParams((current) => searchWithBrand(current, brandFromValue(next)), {
        replace: true,
      });
    },
    [setSearchParams],
  );
  const openProfile = useCallback(
    (row: RosterRow): void => {
      useTracePanelStore.setState({ openPanelId: null });
      navigate(routes.game.worker(row.personId), { state: workerLinkState(location) });
    },
    [navigate, location],
  );

  const failed = summaryQuery.status === 'error' || rowsQuery.status === 'error';
  const promotion = summary?.promotion ?? null;

  let body: ReactNode;
  if (failed) {
    body = <EmptyState size="page" icon="roster" title={NO_GAME_TEXT} />;
  } else if (summary !== undefined && summary.unavailableReason !== null) {
    body = (
      <EmptyState
        size="page"
        icon="roster"
        title="No roster to show"
        body={summary.unavailableReason}
      />
    );
  } else {
    const context: RosterTabContext | null =
      summary === undefined || promotion === null
        ? null
        : { promotionId: promotion.promotionId, brandId: brand, summary };
    const tabCount = (tab: RosterTab): number | null => {
      if (context === null) return null;
      if (tab.kind === 'group') return context.summary.byGroup[tab.id];
      return tab.definition.count?.(context) ?? null;
    };
    const tabLabel = (tab: RosterTab): string =>
      tab.kind === 'group' ? roleGroupLabel(tab.id) : tab.definition.label;

    body = (
      <>
        {summary !== undefined && hasRealBrand(summary) && (
          <div className={styles['brandBar']}>
            <Select
              label="Brand"
              options={brandOptions(summary)}
              value={brand ?? ALL_BRANDS}
              onValueChange={changeBrand}
            />
          </div>
        )}
        <Tabs value={selectedTab} onChange={changeTab}>
          <TabList label="Roster sections">
            {tabs.map((tab) => {
              const count = tabCount(tab);
              return (
                <Tab key={tab.id} value={tab.id}>
                  <span className={styles['tabLabel']}>
                    {tabLabel(tab)}
                    {count !== null && (
                      <CountBadge
                        count={count}
                        showZero
                        max={999}
                        tone="neutral"
                        variant="soft"
                        label={`(${formatNumber(count)})`}
                      />
                    )}
                  </span>
                </Tab>
              );
            })}
          </TabList>
          {tabs.map((tab) => (
            <TabPanel key={tab.id} value={tab.id}>
              {tab.kind === 'group' ? (
                <RosterTable
                  group={tab.id}
                  rows={rows}
                  loading={rowsQuery.status === 'loading' || summary === undefined}
                  promotionName={promotion?.name ?? 'your promotion'}
                  // On a phone the name is the way in: its link covers the whole card (see the
                  // CSS), so the card is not a button with a link and more buttons inside it.
                  onActivate={isMobile ? undefined : openProfile}
                />
              ) : (
                context !== null && tab.definition.render(context)
              )}
            </TabPanel>
          ))}
        </Tabs>
      </>
    );
  }

  // One tree for every state, so the heading RouteFocus focused on arrival stays mounted when the
  // queries settle into an error.
  return (
    <div className={styles['screen']}>
      <div className={styles['intro']}>
        <RouteHeading className={styles['heading']}>{TITLE}</RouteHeading>
        {summary !== undefined && promotion !== null && (
          <p className={styles['count']}>
            {underContractText(rosterTotal(summary), promotion.name)}
          </p>
        )}
      </div>
      {body}
    </div>
  );
}
