import { cents } from '@ringside/engine';
import type { AiringRow, DealDetail, GameDate } from '@ringside/engine';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { formatGameDate, formatNumber } from '@/components/format';
import type { MoneyFormatter } from '@/components/format';
import { Explained } from '@/components/Trace';
import { DealHealthBadge } from './components/DealHealthBadge';
import { endsText, feeText } from './dealColumns';
import {
  airingStatusText,
  END_REASON_TEXT,
  perBuyText,
  perThousandLabel,
  TIMESLOT_LABELS,
  WEEKDAY_SHORT,
} from './networkText';
import styles from './Networks.module.css';

/** The engine's own line for a coming missed airing, which the sheet writes with its cause. */
const COMING_MISSED_PREFIX = 'Missed airing coming';

/** "Missed airing coming: Mon 18 Jan (show cancelled)". */
export function upcomingMissedText(date: GameDate): string {
  return `${COMING_MISSED_PREFIX}: ${formatGameDate(date, 'dayMonth')} (show cancelled)`;
}

/** What the last airing left the promotion with, when it lost money: said plainly. */
export function lastAiringLoss(airings: readonly AiringRow[]): AiringRow | null {
  const last = airings.find((airing) => airing.status === 'aired');
  return last !== undefined && last.net !== null && last.net < 0 ? last : null;
}

function airingColumns(): readonly ColumnDef<AiringRow>[] {
  return [
    {
      id: 'date',
      header: 'Date',
      cell: (row) => <span className={styles['nowrap']}>{formatGameDate(row.airDate)}</span>,
      sortValue: (row) => row.airDate,
      card: 'title',
    },
    {
      id: 'show',
      header: 'Show',
      cell: (row) => row.showName,
      card: 'subtitle',
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <span className={styles['airingStatus']}>
          <span>{airingStatusText(row)}</span>
          {row.note !== null && <span className={styles['muted']}>{row.note}</span>}
        </span>
      ),
      card: 'meta',
    },
    {
      id: 'viewers',
      header: 'Viewers',
      cell: (row) =>
        row.status === 'missed' ? (
          <span className={styles['muted']}>—</span>
        ) : (
          <Explained
            value={row.viewers}
            unit="count"
            label={`Viewers on ${formatGameDate(row.airDate)}`}
            traceRef={row.traceRef}
          />
        ),
      numeric: true,
      card: 'stat',
    },
    {
      id: 'expected',
      header: 'Expected',
      cell: (row) => <span className="tabular">{formatNumber(row.expectedViewers)}</span>,
      numeric: true,
      card: 'stat',
    },
    {
      id: 'net',
      header: 'Net',
      cell: (row) =>
        row.net === null ? (
          <span className={styles['muted']}>—</span>
        ) : (
          <span className={row.net < 0 ? styles['negative'] : undefined}>
            <Explained
              value={row.net}
              unit="money"
              label={`Net on ${formatGameDate(row.airDate)}`}
              traceRef={row.traceRef}
            />
          </span>
        ),
      numeric: true,
      card: 'stat',
    },
  ];
}

const AIRING_COLUMNS = airingColumns();

export interface DealDetailViewProps {
  readonly deal: DealDetail;
  readonly money: MoneyFormatter;
  readonly today: GameDate | null;
}

/**
 * One deal in full, for the deal sheet: its terms, what the network thinks of it with every
 * reason in words, coming missed airings, and the airing history with each airing's Why?.
 */
export function DealDetailView({ deal, money, today }: DealDetailViewProps) {
  const loss = lastAiringLoss(deal.airings);
  const reasons = deal.riskReasons.filter((reason) => !reason.startsWith(COMING_MISSED_PREFIX));
  return (
    <div className={styles['sheetBody']}>
      <section aria-labelledby="deal-terms-heading" className={styles['section']}>
        <h3 id="deal-terms-heading" className={styles['sectionHeading']}>
          Terms
        </h3>
        <dl className={styles['terms']}>
          <div>
            <dt>Fee per show</dt>
            <dd>{deal.kind === 'ppv' ? '—' : feeText(deal, money)}</dd>
          </div>
          <div>
            <dt>{perThousandLabel(deal.kind)}</dt>
            <dd>
              {deal.kind === 'ppv'
                ? perBuyText(deal.terms.perThousandViewers)
                : money(cents(deal.terms.perThousandViewers), { showCents: true })}
            </dd>
          </div>
          <div>
            <dt>Airtime cost per show</dt>
            <dd>{money(cents(deal.terms.costPerShow))}</dd>
          </div>
          <div>
            <dt>Aired</dt>
            <dd>{deal.live ? 'Live' : 'Taped'}</dd>
          </div>
          <div>
            <dt>Day</dt>
            <dd>
              {deal.weekday === null ? 'Whenever the show runs' : WEEKDAY_SHORT[deal.weekday]}
            </dd>
          </div>
          <div>
            <dt>Timeslot</dt>
            <dd>
              {deal.kind === 'ppv' ? 'Not tied to a timeslot' : TIMESLOT_LABELS[deal.timeslot]}
            </dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{formatGameDate(deal.startsOn)}</dd>
          </div>
          <div>
            <dt>Ends</dt>
            <dd>{endsText(deal, today)}</dd>
          </div>
        </dl>
        {loss?.net != null && (
          <p className={styles['lossNote']}>
            This deal lost money on its last airing: the airtime cost more than the network paid.
            Net{' '}
            <Explained
              value={loss.net}
              unit="money"
              label={`Net on ${formatGameDate(loss.airDate)}`}
              traceRef={loss.traceRef}
            />
          </p>
        )}
      </section>

      <section aria-labelledby="deal-health-heading" className={styles['section']}>
        <h3 id="deal-health-heading" className={styles['sectionHeading']}>
          Health
        </h3>
        {deal.risk === null ? (
          <p>{deal.endedReason === null ? 'Not running.' : END_REASON_TEXT[deal.endedReason]}</p>
        ) : (
          <>
            <DealHealthBadge
              risk={deal.risk}
              reasons={deal.riskReasons}
              healthTraceRef={deal.healthTraceRef}
              networkName={deal.networkName}
            />
            {(reasons.length > 0 || deal.upcomingMissed.length > 0) && (
              <ul className={styles['reasons']}>
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
                {deal.upcomingMissed.map((date) => (
                  <li key={date}>{upcomingMissedText(date)}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="deal-airings-heading" className={styles['section']}>
        <h3 id="deal-airings-heading" className={styles['sectionHeading']}>
          Airing history
        </h3>
        <DataTable
          rows={deal.airings}
          columns={AIRING_COLUMNS}
          getRowId={(row) => row.airingId}
          caption={`${deal.showName} on ${deal.networkName}: airings`}
          density="compact"
          emptyState={<p className={styles['muted']}>Nothing has aired yet.</p>}
        />
      </section>
    </div>
  );
}
