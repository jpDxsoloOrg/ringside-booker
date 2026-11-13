import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LEDGER_CATEGORY_LABELS, ledgerCategoryKind } from '@ringside/engine';
import type {
  FinanceMonth,
  FinanceMonthly,
  LedgerCategory,
  PromotionId,
  YearMonth,
} from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { classNames } from '@/components/classNames';
import { EmptyState } from '@/components/EmptyState';
import { VisuallyHidden } from '@/components/layout';
import { useIsMobile } from '@/styles/useMediaQuery';
import { FINANCE_TAB_IDS, formatYearMonth } from './financeParams';
import { FinanceQueryError, SignedMoney } from './financeParts';
import styles from './Finances.module.css';

/** Months the Monthly tab lists: a year. */
export const MONTHLY_TAB_MONTHS = 12;

/** What a month before the game started shows in each cell. */
export const BEFORE_START_TEXT = '—';

export interface MonthlyTabProps {
  readonly promotionId: PromotionId;
}

function ledgerLink(month: YearMonth, category?: LedgerCategory): string {
  return routes.game.finances({
    tab: FINANCE_TAB_IDS.ledger,
    month,
    ...(category === undefined ? {} : { category }),
  });
}

/** An amount that links to its rows in the Ledger; zero is plain. */
function AmountLink({
  amount,
  month,
  category,
  label,
}: {
  readonly amount: number;
  readonly month: YearMonth;
  readonly category?: LedgerCategory;
  /** What the link is, for its accessible name: "Wages, Jan 2027". */
  readonly label: string;
}) {
  if (amount === 0) return <SignedMoney amount={0} coloured={false} />;
  return (
    <Link to={ledgerLink(month, category)} className={styles['amountLink']}>
      <SignedMoney amount={amount} />
      <VisuallyHidden>{`, ${label}: see the rows`}</VisuallyHidden>
    </Link>
  );
}

function isBeforeStart(month: YearMonth, startMonth: YearMonth): boolean {
  return month < startMonth;
}

interface MonthlyViewProps {
  readonly monthly: FinanceMonthly;
  readonly currentMonth: YearMonth;
}

function monthHeading(month: YearMonth, currentMonth: YearMonth): string {
  return month === currentMonth ? `${formatYearMonth(month)} (so far)` : formatYearMonth(month);
}

/** Desktop: one column per month, oldest on the left; Income, Costs, Net and Closing cash rows. */
function MonthlyTable({ monthly, currentMonth }: MonthlyViewProps) {
  const income = monthly.categories.filter((category) => ledgerCategoryKind(category) === 'income');
  const costs = monthly.categories.filter((category) => ledgerCategoryKind(category) === 'cost');
  const columnCount = monthly.months.length + 1;

  const cell = (month: FinanceMonth, render: () => ReactNode) =>
    isBeforeStart(month.month, monthly.startMonth) ? (
      <td key={month.month} className={styles['numberCell']}>
        <span aria-hidden="true">{BEFORE_START_TEXT}</span>
        <VisuallyHidden>Before the game started</VisuallyHidden>
      </td>
    ) : (
      <td key={month.month} className={styles['numberCell']}>
        {render()}
      </td>
    );

  const categoryRow = (category: LedgerCategory) => (
    <tr key={category}>
      <th scope="row" className={styles['rowHeader']}>
        {LEDGER_CATEGORY_LABELS[category]}
      </th>
      {monthly.months.map((month) =>
        cell(month, () => (
          <AmountLink
            amount={month.byCategory[category] ?? 0}
            month={month.month}
            category={category}
            label={`${LEDGER_CATEGORY_LABELS[category]}, ${formatYearMonth(month.month)}`}
          />
        )),
      )}
    </tr>
  );

  return (
    <div
      className={styles['tableScroller']}
      role="region"
      aria-label="Monthly table"
      // The table scrolls sideways when twelve months do not fit. A month with no money has no
      // links in it, so the region takes focus itself for the keyboard to scroll it (WCAG 2.1.1).
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
    >
      <table className={styles['monthlyTable']}>
        <caption className={styles['caption']}>
          Money in and out by month, oldest first. Each amount opens its rows in the Ledger; a dash
          marks a month before the game started.
        </caption>
        <thead>
          <tr>
            <th scope="col" className={styles['rowHeader']}>
              <VisuallyHidden>Category</VisuallyHidden>
            </th>
            {monthly.months.map((month) => (
              <th
                key={month.month}
                scope="col"
                className={classNames(
                  styles['numberCell'],
                  month.month === currentMonth && styles['currentMonth'],
                )}
              >
                {monthHeading(month.month, currentMonth)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className={styles['groupRow']}>
            <th scope="colgroup" colSpan={columnCount}>
              Income
            </th>
          </tr>
          {income.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className={styles['muted']}>
                No income in these months.
              </td>
            </tr>
          ) : (
            income.map(categoryRow)
          )}
          <tr className={styles['groupRow']}>
            <th scope="colgroup" colSpan={columnCount}>
              Costs
            </th>
          </tr>
          {costs.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className={styles['muted']}>
                No costs in these months.
              </td>
            </tr>
          ) : (
            costs.map(categoryRow)
          )}
        </tbody>
        <tfoot>
          <tr className={styles['totalRow']}>
            <th scope="row" className={styles['rowHeader']}>
              Net
            </th>
            {monthly.months.map((month) =>
              cell(month, () => <SignedMoney amount={month.net} showPlus />),
            )}
          </tr>
          <tr className={styles['totalRow']}>
            <th scope="row" className={styles['rowHeader']}>
              Closing cash
            </th>
            {monthly.months.map((month) =>
              cell(month, () => <SignedMoney amount={month.closingCash} coloured={false} />),
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Phone: one card per month, newest first, with the categories behind a disclosure. */
function MonthlyCards({ monthly, currentMonth }: MonthlyViewProps) {
  const months = [...monthly.months]
    .reverse()
    .filter((month) => !isBeforeStart(month.month, monthly.startMonth));
  return (
    <ul className={styles['monthCards']} aria-label="Months, newest first">
      {months.map((month) => {
        const categories = monthly.categories.filter(
          (category) => (month.byCategory[category] ?? 0) !== 0,
        );
        return (
          <li key={month.month} className={styles['monthCard']}>
            <h3 className={styles['monthCardTitle']}>{monthHeading(month.month, currentMonth)}</h3>
            <dl className={styles['monthFigures']}>
              <div>
                <dt>Income</dt>
                <dd>
                  <SignedMoney amount={month.income} />
                </dd>
              </div>
              <div>
                <dt>Costs</dt>
                <dd>
                  <SignedMoney amount={month.costs} />
                </dd>
              </div>
              <div>
                <dt>Net</dt>
                <dd>
                  <SignedMoney amount={month.net} showPlus />
                </dd>
              </div>
              <div>
                <dt>Closing cash</dt>
                <dd>
                  <SignedMoney amount={month.closingCash} coloured={false} />
                </dd>
              </div>
            </dl>
            {categories.length > 0 && (
              <details className={styles['monthDetails']}>
                <summary>By category ({categories.length})</summary>
                <ul className={styles['categoryList']}>
                  {categories.map((category) => (
                    <li key={category} className={styles['categoryLine']}>
                      <Link to={ledgerLink(month.month, category)}>
                        {LEDGER_CATEGORY_LABELS[category]}
                      </Link>
                      <SignedMoney amount={month.byCategory[category] ?? 0} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The Monthly tab: the last twelve months by category, each amount a way into the Ledger. */
export function MonthlyTab({ promotionId }: MonthlyTabProps) {
  const monthly = useEngineQuery('finance.monthly', { promotionId, months: MONTHLY_TAB_MONTHS });
  const isMobile = useIsMobile();

  if (monthly.status === 'loading') {
    return (
      <p className={styles['muted']} role="status">
        Loading the months…
      </p>
    );
  }
  if (monthly.data === undefined) {
    return <FinanceQueryError error={monthly.error} title="The months can't be shown" />;
  }
  const data = monthly.data;
  const currentMonth = data.months.at(-1)?.month;
  if (currentMonth === undefined) {
    return <EmptyState icon="finance" title="No months to show" headingLevel={2} />;
  }
  return isMobile ? (
    <MonthlyCards monthly={data} currentMonth={currentMonth} />
  ) : (
    <MonthlyTable monthly={data} currentMonth={currentMonth} />
  );
}
