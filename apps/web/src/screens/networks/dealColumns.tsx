import { cents } from '@ringside/engine';
import type { DealRow, GameDate } from '@ringside/engine';
import type { ColumnDef } from '@/components/DataTable';
import { formatDaysBetween, formatGameDate } from '@/components/format';
import type { MoneyFormatter } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { Explained } from '@/components/Trace';
import { DealHealthBadge } from './components/DealHealthBadge';
import { DealTrend } from './components/DealTrend';
import { END_REASON_TEXT, formatSlot, perBuyText } from './networkText';
import styles from './Networks.module.css';

export interface DealColumnContext {
  readonly money: MoneyFormatter;
  readonly today: GameDate | null;
  readonly onOpen: (row: DealRow) => void;
}

/** "NSN · Mainstage". */
export function dealTitle(row: Pick<DealRow, 'networkName' | 'showName'>): string {
  return `${row.networkName} · ${row.showName}`;
}

/** "$45,000", or for pay-per-view (no flat fee) "— · $1.80 per buy". */
export function feeText(row: Pick<DealRow, 'kind' | 'terms'>, money: MoneyFormatter): string {
  if (row.kind === 'ppv') return `— · ${perBuyText(row.terms.perThousandViewers)}`;
  return money(cents(row.terms.feePerShow));
}

/** "Oct 4, 2027 · in 269 days", or "Ended Oct 4, 2027" once it has ended. */
export function endsText(row: Pick<DealRow, 'endsOn' | 'status'>, today: GameDate | null): string {
  const date = formatGameDate(row.endsOn);
  if (row.status !== 'active') return `Ended ${date}`;
  return today === null ? date : `${date} · ${formatDaysBetween(today, row.endsOn)}`;
}

/** What the network thinks of a running deal, or why an ended one ended. */
export function DealStanding({ row }: { readonly row: DealRow }) {
  if (row.risk === null) {
    return (
      <span className={styles['muted']}>
        {row.endedReason === null ? 'Not running' : END_REASON_TEXT[row.endedReason]}
      </span>
    );
  }
  return (
    <DealHealthBadge
      risk={row.risk}
      reasons={row.riskReasons}
      healthTraceRef={row.healthTraceRef}
      networkName={row.networkName}
    />
  );
}

/**
 * The Your deals table, declared once for the desktop table and the phone cards: logo (media),
 * network and show (title, a button that opens the deal sheet), slot (subtitle), fee, last and
 * expected viewers (stats, each with its Why?), the trend (desktop only), health and end date
 * (meta).
 */
export function dealColumns(context: DealColumnContext): readonly ColumnDef<DealRow>[] {
  const { money, today, onOpen } = context;
  return [
    {
      id: 'logo',
      header: 'Logo',
      cell: (row) => (
        <ImageSlot
          subject={{
            kind: 'network',
            id: row.networkId,
            name: row.networkName,
            ...(row.logoRef === null ? {} : { imageRef: row.logoRef }),
          }}
          size="sm"
          decorative
        />
      ),
      width: 'xs',
      card: 'media',
      headerHidden: true,
      hideable: false,
    },
    {
      id: 'deal',
      header: 'Network and show',
      cell: (row) => (
        <button
          type="button"
          className={styles['rowButton']}
          aria-haspopup="dialog"
          data-deal-open={row.dealId}
          onClick={() => {
            onOpen(row);
          }}
        >
          {dealTitle(row)}
        </button>
      ),
      sortValue: (row) => dealTitle(row),
      filterValue: (row) => dealTitle(row),
      width: 'lg',
      card: 'title',
    },
    {
      id: 'slot',
      header: 'Slot',
      cell: (row) => <span className={styles['nowrap']}>{formatSlot(row)}</span>,
      card: 'subtitle',
    },
    {
      id: 'fee',
      header: 'Fee per show',
      cell: (row) => <span className={styles['nowrap']}>{feeText(row, money)}</span>,
      sortValue: (row) => row.terms.feePerShow,
      numeric: true,
      card: 'stat',
      cardLabel: 'Fee',
    },
    {
      id: 'lastViewers',
      header: 'Last viewers',
      cell: (row) =>
        row.lastAiring === null ? (
          <span className={styles['muted']}>No airing yet</span>
        ) : (
          <Explained
            value={row.lastAiring.viewers}
            unit="count"
            label={`${row.showName} viewers on ${formatGameDate(row.lastAiring.airDate)}`}
            traceRef={row.lastAiring.traceRef}
          />
        ),
      sortValue: (row) => row.lastAiring?.viewers ?? null,
      numeric: true,
      card: 'stat',
      cardLabel: 'Last',
    },
    {
      id: 'expected',
      header: 'Network expects',
      cell: (row) =>
        row.expectedViewers === null ? (
          <span className={styles['muted']}>—</span>
        ) : (
          <Explained
            value={row.expectedViewers.value}
            unit="count"
            label={`What ${row.networkName} expects`}
            trace={row.expectedViewers.trace}
          />
        ),
      sortValue: (row) => row.expectedViewers?.value ?? null,
      numeric: true,
      card: 'stat',
      cardLabel: 'Expects',
    },
    {
      id: 'trend',
      header: 'Trend',
      cell: (row) => <DealTrend recent={row.recent} networkName={row.networkName} />,
      card: 'hidden',
    },
    {
      id: 'health',
      header: 'Health',
      cell: (row) => <DealStanding row={row} />,
      card: 'meta',
    },
    {
      id: 'ends',
      header: 'Ends',
      cell: (row) => <span className={styles['ends']}>{endsText(row, today)}</span>,
      sortValue: (row) => row.endsOn,
      card: 'meta',
    },
  ];
}
