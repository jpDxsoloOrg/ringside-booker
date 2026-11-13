import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LEDGER_CATEGORIES, LEDGER_CATEGORY_LABELS, ledgerCategoryKind } from '@ringside/engine';
import type {
  FinanceLedgerArgs,
  FinanceLedgerPage,
  FinanceLedgerRow,
  LedgerCategory,
  LedgerEntryId,
  PromotionId,
  YearMonth,
} from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate } from '@/components/format';
import { VisuallyHidden } from '@/components/layout';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { WorkerLink } from '@/components/WorkerLink';
import { WhyButton } from '@/components/Trace';
import { formatYearMonth, ledgerFiltersOf, withLedgerFilters } from './financeParams';
import type { LedgerFilters } from './financeParams';
import { FinanceQueryError, SignedMoney } from './financeParts';
import styles from './Finances.module.css';

/** Rows asked for per page: the ledger can hold thousands, so the screen never asks for all. */
export const LEDGER_PAGE_SIZE = 100;

/** How many months back the month filter offers. */
const MONTH_OPTIONS_SPAN = 24;

/** The select value that means "no filter". */
const ALL = 'all';

/** The Ledger's empty state on a game where nothing has been paid yet. */
export const LEDGER_EMPTY_TEXT = 'No money has moved yet. Press Next Day.';

/** A row's name, as its Why? button and links read it: "Wages, Mon 4 Jan 2027". */
export function ledgerRowName(row: FinanceLedgerRow): string {
  return `${row.label}, ${formatGameDate(row.date, 'dayMonthYear')}`;
}

function RowLinks({ row }: { readonly row: FinanceLedgerRow }) {
  const { eventInstanceId, personId } = row.refs;
  if (eventInstanceId === null && personId === null) {
    return (
      <span className={styles['muted']}>
        <span aria-hidden="true">—</span>
        <VisuallyHidden>Nothing linked</VisuallyHidden>
      </span>
    );
  }
  return (
    <span className={styles['rowLinks']}>
      {eventInstanceId !== null && (
        <Link
          to={routes.game.showResults(eventInstanceId)}
          aria-label={`Show results for ${ledgerRowName(row)}`}
        >
          Show results
        </Link>
      )}
      {personId !== null && <WorkerLink personId={personId} name="Worker profile" />}
    </span>
  );
}

const LEDGER_COLUMNS: readonly ColumnDef<FinanceLedgerRow>[] = [
  {
    id: 'date',
    header: 'Date',
    card: 'meta',
    width: 'md',
    cell: (row) => <time dateTime={row.date}>{formatGameDate(row.date, 'dayMonthYear')}</time>,
  },
  {
    id: 'category',
    header: 'Category',
    card: 'title',
    width: 'md',
    cell: (row) => (
      <span className={styles['categoryCell']}>
        {row.label}
        <Badge tone={row.kind === 'income' ? 'positive' : 'negative'}>
          {row.kind === 'income' ? 'Income' : 'Cost'}
        </Badge>
      </span>
    ),
  },
  {
    id: 'memo',
    header: 'Memo',
    card: 'subtitle',
    width: 'auto',
    cell: (row) => row.memo ?? '',
  },
  {
    id: 'amount',
    header: 'Amount',
    card: 'stat',
    numeric: true,
    align: 'end',
    width: 'sm',
    cell: (row) => <SignedMoney amount={row.amount} showPlus />,
  },
  {
    id: 'why',
    header: 'Why?',
    card: 'stat',
    width: 'xs',
    align: 'center',
    cell: (row) =>
      row.traceRef === null ? (
        <span className={styles['muted']}>Not kept</span>
      ) : (
        <WhyButton
          label={ledgerRowName(row)}
          value={row.amount}
          unit="money"
          source={{ traceRef: row.traceRef }}
        />
      ),
  },
  {
    id: 'links',
    header: 'From',
    card: 'meta',
    width: 'md',
    cell: (row) => <RowLinks row={row} />,
  },
];

function rowId(row: FinanceLedgerRow): string {
  return row.id;
}

interface LoadedPage {
  readonly rows: readonly FinanceLedgerRow[];
  readonly nextCursor: LedgerEntryId | null;
}

/**
 * One older page, asked for with `before`. It draws nothing: it hands its rows up. A cursor names
 * a row, so a page keeps its rows when newer ones are posted after a Next Day.
 */
function OlderPage({
  args,
  before,
  onPage,
}: {
  readonly args: FinanceLedgerArgs;
  readonly before: LedgerEntryId;
  readonly onPage: (before: LedgerEntryId, page: LoadedPage) => void;
}) {
  const page = useEngineQuery('finance.ledger', { ...args, before });
  const data: FinanceLedgerPage | undefined = page.data;
  useEffect(() => {
    if (data !== undefined) onPage(before, data);
  }, [before, data, onPage]);
  return null;
}

function monthOptions(current: YearMonth | null, months: readonly YearMonth[]): SelectOption[] {
  const listed = new Set<YearMonth>(months);
  if (current !== null) listed.add(current);
  const options = [...listed]
    .sort((left, right) => (left < right ? 1 : left > right ? -1 : 0))
    .map((month) => ({ value: month, label: formatYearMonth(month, 'long') }));
  return [{ value: ALL, label: 'All months' }, ...options];
}

function categoryOptions(
  current: LedgerCategory | null,
  categories: readonly LedgerCategory[],
): SelectOption[] {
  const listed = new Set<LedgerCategory>(categories);
  if (current !== null) listed.add(current);
  const options = LEDGER_CATEGORIES.filter((category) => listed.has(category)).map((category) => ({
    value: category,
    label: LEDGER_CATEGORY_LABELS[category],
    group: ledgerCategoryKind(category) === 'income' ? 'Income' : 'Costs',
  }));
  return [{ value: ALL, label: 'All categories' }, ...options];
}

interface LedgerRowsProps {
  readonly promotionId: PromotionId;
  readonly filters: LedgerFilters;
  readonly onClearFilters: () => void;
}

/** The rows for one set of filters: the newest page, then any older pages asked for. */
function LedgerRows({ promotionId, filters, onClearFilters }: LedgerRowsProps) {
  const args = useMemo<FinanceLedgerArgs>(
    () => ({
      promotionId,
      limit: LEDGER_PAGE_SIZE,
      ...(filters.month === null ? {} : { month: filters.month }),
      ...(filters.category === null ? {} : { category: filters.category }),
    }),
    [promotionId, filters.month, filters.category],
  );
  const first = useEngineQuery('finance.ledger', args);
  const [olderCursors, setOlderCursors] = useState<readonly LedgerEntryId[]>([]);
  const [olderPages, setOlderPages] = useState<ReadonlyMap<LedgerEntryId, LoadedPage>>(new Map());
  const onPage = useCallback((before: LedgerEntryId, page: LoadedPage) => {
    setOlderPages((pages) => {
      if (pages.get(before) === page) return pages;
      const next = new Map(pages);
      next.set(before, page);
      return next;
    });
  }, []);

  if (first.status === 'loading') {
    return (
      <DataTable rows={[]} columns={LEDGER_COLUMNS} getRowId={rowId} caption="Ledger" loading />
    );
  }
  if (first.data === undefined) {
    return <FinanceQueryError error={first.error} title="The ledger can't be shown" />;
  }

  const rows: FinanceLedgerRow[] = [...first.data.rows];
  let nextCursor = first.data.nextCursor;
  let waiting = false;
  for (const cursor of olderCursors) {
    const page = olderPages.get(cursor);
    if (page === undefined) {
      waiting = true;
      break;
    }
    rows.push(...page.rows);
    nextCursor = page.nextCursor;
  }
  const olderCursor = nextCursor;
  const filtered = filters.month !== null || filters.category !== null;

  return (
    <>
      {olderCursors.map((cursor) => (
        <OlderPage key={cursor} args={args} before={cursor} onPage={onPage} />
      ))}
      <DataTable
        rows={rows}
        columns={LEDGER_COLUMNS}
        getRowId={rowId}
        getRowLabel={ledgerRowName}
        caption="Ledger, newest first"
        sortable={false}
        striped
        emptyState={
          filtered ? (
            <EmptyState
              icon="search"
              title="No rows match these filters"
              body="Try another month or category."
              action={
                <Button variant="secondary" onClick={onClearFilters}>
                  Clear filters
                </Button>
              }
              headingLevel={3}
            />
          ) : (
            <EmptyState icon="finance" title={LEDGER_EMPTY_TEXT} headingLevel={3} />
          )
        }
      />
      <div className={styles['ledgerFooter']}>
        <p className={styles['muted']} role="status">
          {rows.length === 0
            ? null
            : `${String(rows.length)} ${rows.length === 1 ? 'row' : 'rows'} shown${
                nextCursor === null ? ', the oldest included' : ''
              }`}
        </p>
        {olderCursor !== null && (
          <Button
            variant="secondary"
            disabled={waiting}
            onClick={() => {
              setOlderCursors((cursors) => [...cursors, olderCursor]);
            }}
          >
            {waiting ? 'Loading older rows…' : 'Load older'}
          </Button>
        )}
      </div>
    </>
  );
}

export interface LedgerTabProps {
  readonly promotionId: PromotionId;
}

/**
 * The Ledger tab: every row, newest first, a page at a time, filtered by month and category (both
 * in the URL). Each row has its Why? and links to the show or person it came from.
 */
export function LedgerTab({ promotionId }: LedgerTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = ledgerFiltersOf(searchParams);
  const monthly = useEngineQuery('finance.monthly', { promotionId, months: MONTH_OPTIONS_SPAN });
  const monthsWithRows = (monthly.data?.months ?? [])
    .filter((month) => Object.keys(month.byCategory).length > 0)
    .map((month) => month.month);
  const categories = monthly.data?.categories ?? [];

  const setFilters = (next: LedgerFilters): void => {
    setSearchParams(withLedgerFilters(searchParams, next), { replace: true });
  };

  return (
    <div className={styles['tabBody']}>
      <div className={styles['filters']} role="group" aria-label="Ledger filters">
        <Select
          label="Month"
          value={filters.month ?? ALL}
          options={monthOptions(filters.month, monthsWithRows)}
          onValueChange={(value) => {
            const month = monthsWithRows.find((candidate) => candidate === value) ?? null;
            setFilters({ ...filters, month: value === ALL ? null : (month ?? filters.month) });
          }}
        />
        <Select
          label="Category"
          value={filters.category ?? ALL}
          options={categoryOptions(filters.category, categories)}
          onValueChange={(value) => {
            const category = LEDGER_CATEGORIES.find((candidate) => candidate === value) ?? null;
            setFilters({ ...filters, category });
          }}
        />
      </div>
      <LedgerRows
        key={`${filters.month ?? ALL}|${filters.category ?? ALL}`}
        promotionId={promotionId}
        filters={filters}
        onClearFilters={() => {
          setFilters({ month: null, category: null });
        }}
      />
    </div>
  );
}
