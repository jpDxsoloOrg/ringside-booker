import { Link } from 'react-router-dom';
import { yearMonthOf } from '@ringside/engine';
import type { FinanceLedgerRow, ShowResultsView, YearMonth } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { VisuallyHidden } from '@/components/layout';
import { WhyButton } from '@/components/Trace';
import { formatYearMonth } from './financeParams';
import { queryErrorText, SignedMoney } from './financeParts';
import styles from './ShowMoney.module.css';

/** The most rows one show posts: tickets, broadcast, rent, fees, travel, catering and a few more. */
export const SHOW_MONEY_ROW_LIMIT = 50;

/** What the section says when it has nothing to list, in plain words. */
export const SHOW_MONEY_TEXT = {
  none: 'No money moved for this show.',
  rolledUp: "This show's money is now part of its month's totals.",
  error: "This show's money can't be shown",
  notKept: 'Breakdown no longer kept',
} as const;

/** The link under the rows: "See April 2026 in the ledger". */
export function showMoneyLedgerLinkText(month: YearMonth): string {
  return `See ${formatYearMonth(month, 'long')} in the ledger`;
}

/** The link for a rolled-up show: "See April 2026 in the monthly totals". */
export function showMoneyMonthlyLinkText(month: YearMonth): string {
  return `See ${formatYearMonth(month, 'long')} in the monthly totals`;
}

/** A row's name, as its Why? button reads it: "Travel for Test Weekly". */
function rowName(row: FinanceLedgerRow, showName: string): string {
  return `${row.label} for ${showName}`;
}

export interface ShowMoneyRowsProps {
  /** The show's ledger rows, newest first, as `finance.ledger` lists them. */
  readonly rows: readonly FinanceLedgerRow[];
  readonly showName: string;
  /** The month the show ran in, for the ledger link. */
  readonly month: YearMonth;
}

/** The rows a show posted, each with a Why?, then the net and a link to the month's ledger. */
export function ShowMoneyRows({ rows, showName, month }: ShowMoneyRowsProps) {
  const net = rows.reduce((sum, row) => sum + row.amount, 0);
  return (
    <div className={styles['showMoney']}>
      <ul className={styles['rows']} aria-label={`Money for ${showName}`}>
        {rows.map((row) => (
          <li key={row.id} className={styles['row']}>
            <span className={styles['what']}>
              <span className={styles['label']}>
                {row.label}
                <Badge tone={row.kind === 'income' ? 'positive' : 'negative'}>
                  {row.kind === 'income' ? 'Income' : 'Cost'}
                </Badge>
              </span>
              {row.memo !== null && <span className={styles['memo']}>{row.memo}</span>}
            </span>
            <span className={styles['amount']}>
              <SignedMoney amount={row.amount} showPlus />
              {row.traceRef === null ? (
                <span className={styles['memo']}>{SHOW_MONEY_TEXT.notKept}</span>
              ) : (
                <WhyButton
                  label={rowName(row, showName)}
                  value={row.amount}
                  unit="money"
                  source={{ traceRef: row.traceRef }}
                />
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className={styles['net']}>
        <span>Net for this show</span>
        <SignedMoney amount={net} showPlus />
      </p>
      <Link className={styles['ledgerLink']} to={routes.game.finances({ tab: 'ledger', month })}>
        {showMoneyLedgerLinkText(month)}
      </Link>
    </div>
  );
}

function ShowMoneyLoading() {
  return (
    <div className={styles['skeleton']} aria-busy="true">
      <VisuallyHidden>Loading the show&apos;s money</VisuallyHidden>
      <span className={styles['skeletonRow']} />
      <span className={styles['skeletonRow']} />
      <span className={styles['skeletonRow']} />
    </div>
  );
}

export interface ShowMoneySectionProps {
  /** One of the viewer's own completed shows: rivals' books are private. */
  readonly view: ShowResultsView;
}

/**
 * The results page's "Show money" section (ECO1-06): every ledger row the show posted (ticket
 * sales, rent, appearance fees, travel, catering), each with its Why?, and a link to the month in
 * the Finances ledger. The heading is the results panel's own.
 */
export function ShowMoneySection({ view }: ShowMoneySectionProps) {
  const query = useEngineQuery('finance.ledger', {
    promotionId: view.promotion.id,
    eventInstanceId: view.eventInstanceId,
    limit: SHOW_MONEY_ROW_LIMIT,
  });
  const data = query.data;
  if (query.status === 'loading') return <ShowMoneyLoading />;
  if (query.status === 'error' || data === undefined) {
    return (
      <EmptyState icon="warning" title={SHOW_MONEY_TEXT.error} body={queryErrorText(query.error)} />
    );
  }
  if (data.rows.length === 0 && view.history !== null) {
    // Older than the detail window (POL4-08): the rows went into the month's totals.
    const month = yearMonthOf(view.date);
    return (
      <EmptyState
        icon="info"
        title={SHOW_MONEY_TEXT.rolledUp}
        body={
          <>
            {view.history.note}{' '}
            <Link to={routes.game.finances({ tab: 'monthly' })}>
              {showMoneyMonthlyLinkText(month)}
            </Link>
          </>
        }
      />
    );
  }
  if (data.rows.length === 0) return <EmptyState icon="info" title={SHOW_MONEY_TEXT.none} />;
  return <ShowMoneyRows rows={data.rows} showName={view.name} month={yearMonthOf(view.date)} />;
}
