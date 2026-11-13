import type { Cents, EventInstanceId, ShowCrowd, ShowMoney, TraceRef } from '@ringside/engine';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { useSettingsStore } from '@/app/settings/settingsStore';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import {
  formatMoney,
  formatNumber,
  formatSignedMoney,
  useMoneyFormatter,
} from '@/components/format';
import { KpiCard, KpiCardGrid } from '@/components/KpiCard';
import { VisuallyHidden } from '@/components/layout';
import { WhyButton } from '@/components/Trace';
import type { TraceSource } from '@/components/Trace';
import styles from './BoxOfficeSection.module.css';

/** What the section says in plain words. */
export const BOX_OFFICE_TEXT = {
  notSettled: 'Box office not settled yet',
  private: "Other promotions' takings are private",
  error: "The box office can't be shown",
  loss: 'Loss',
} as const;

const NO_REASON = 'The game did not say why.';

function errorText(error: EngineQueryError | null): string {
  if (error === null) return NO_REASON;
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ') || NO_REASON;
}

/** One money line of the box office with its Why?, or null once the breakdown is gone. */
export interface BoxOfficeLine {
  readonly amount: Cents;
  readonly why: TraceSource | null;
}

/** How many came, as the section draws it. */
export interface BoxOfficeCrowdData {
  readonly attendance: number;
  readonly capacity: number;
  /** 0 to 100, rounded. */
  readonly percentFull: number;
  readonly venueName: string;
  readonly why: TraceSource | null;
}

/** What one of the player's own shows took. Rent is negative, like its ledger row. */
export interface BoxOfficeMoneyData {
  readonly ticketPrice: Cents;
  readonly gateShare: Cents;
  readonly grossMerch: Cents;
  readonly merchShare: Cents;
  /** Ticket money kept, after the workers' share. */
  readonly tickets: BoxOfficeLine;
  readonly venueRent: BoxOfficeLine;
  /** Merch money kept, after the workers' share. */
  readonly liveMerch: BoxOfficeLine;
  readonly net: BoxOfficeLine;
}

/** The Attendance card's footer: "82% full · Harrowmere Arena, capacity 17,500". */
export function attendanceFooter(crowd: BoxOfficeCrowdData): string {
  return `${formatNumber(crowd.percentFull)}% full · ${crowd.venueName}, capacity ${formatNumber(crowd.capacity)}`;
}

function sourceOf(ref: TraceRef | null): TraceSource | null {
  return ref === null ? null : { traceRef: ref };
}

/** The crowd as the section draws it, or null until the show is settled. */
export function crowdData(crowd: ShowCrowd): BoxOfficeCrowdData | null {
  if (crowd.status !== 'settled' || crowd.attendance === null || crowd.capacity === null) {
    return null;
  }
  return {
    attendance: crowd.attendance,
    capacity: crowd.capacity,
    percentFull: crowd.percentFull ?? 0,
    venueName: crowd.venue?.name ?? 'The venue',
    why: sourceOf(crowd.attendanceTraceRef),
  };
}

/** The money as the section draws it. */
export function moneyData(money: ShowMoney): BoxOfficeMoneyData {
  const line = (amount: { amount: Cents; traceRef: TraceRef | null }): BoxOfficeLine => ({
    amount: amount.amount,
    why: sourceOf(amount.traceRef),
  });
  return {
    ticketPrice: money.ticketPrice.amount,
    gateShare: money.gateShare.amount,
    grossMerch: money.grossMerch.amount,
    merchShare: money.merchShare.amount,
    tickets: line(money.tickets),
    venueRent: line(money.venueRent),
    liveMerch: line(money.liveMerch),
    net: line(money.net),
  };
}

interface WhyProps {
  readonly label: string;
  readonly value: number;
  readonly unit: 'money' | 'people';
  readonly source: TraceSource | null;
  readonly showName: string;
}

/** A Why? for one card, or a muted note once its breakdown is no longer kept. */
function Why({ label, value, unit, source, showName }: WhyProps) {
  if (source === null) return <span className={styles['notKept']}>Breakdown no longer kept</span>;
  return (
    <WhyButton
      label={`${label} at ${showName}`}
      panelTitle={label}
      value={value}
      unit={unit}
      source={source}
    />
  );
}

export interface BoxOfficeKpisProps {
  readonly showName: string;
  readonly crowd: BoxOfficeCrowdData;
  /** The player's own show's money; null for a rival's show, whose takings are private. */
  readonly money: BoxOfficeMoneyData | null;
}

/**
 * The Box office cards: Attendance with how full the venue was, then, for the player's own shows,
 * Gate, Venue rent, Live merch and Net, each with its Why?. A rival's show shows its attendance
 * only.
 */
export function BoxOfficeKpis({ showName, crowd, money }: BoxOfficeKpisProps) {
  const formatAmount = useMoneyFormatter();
  const moneyStyle = useSettingsStore((state) => state.settings.moneyStyle);
  return (
    <div className={styles['boxOffice']}>
      <KpiCardGrid label={`Box office for ${showName}`} className={styles['grid']}>
        <KpiCard
          label="Attendance"
          icon="users"
          value={formatNumber(crowd.attendance)}
          footer={attendanceFooter(crowd)}
          why={
            <Why
              label="Attendance"
              value={crowd.attendance}
              unit="people"
              source={crowd.why}
              showName={showName}
            />
          }
        />
        {money !== null && (
          <>
            <KpiCard
              label="Gate"
              value={formatAmount(money.tickets.amount)}
              footer={
                money.gateShare > 0
                  ? `${formatMoney(money.ticketPrice, { showCents: true })} a ticket · ${formatAmount(money.gateShare)} to workers`
                  : `${formatMoney(money.ticketPrice, { showCents: true })} a ticket`
              }
              why={
                <Why
                  label="Gate"
                  value={money.tickets.amount}
                  unit="money"
                  source={money.tickets.why}
                  showName={showName}
                />
              }
            />
            <KpiCard
              label="Venue rent"
              value={formatAmount(money.venueRent.amount)}
              footer={crowd.venueName}
              why={
                <Why
                  label="Venue rent"
                  value={money.venueRent.amount}
                  unit="money"
                  source={money.venueRent.why}
                  showName={showName}
                />
              }
            />
            <KpiCard
              label="Live merch"
              value={formatAmount(money.liveMerch.amount)}
              footer={
                money.merchShare > 0
                  ? `${formatAmount(money.grossMerch)} sold · ${formatAmount(money.merchShare)} to workers`
                  : `${formatAmount(money.grossMerch)} sold`
              }
              why={
                <Why
                  label="Live merch"
                  value={money.liveMerch.amount}
                  unit="money"
                  source={money.liveMerch.why}
                  showName={showName}
                />
              }
            />
            <KpiCard
              label="Net"
              tone={money.net.amount < 0 ? 'negative' : 'neutral'}
              value={formatSignedMoney(money.net.amount, { showPlus: true, style: moneyStyle })}
              {...(money.net.amount < 0
                ? { unit: <Badge tone="negative">{BOX_OFFICE_TEXT.loss}</Badge> }
                : {})}
              footer="Gate and merch, less the rent"
              why={
                <Why
                  label="Net"
                  value={money.net.amount}
                  unit="money"
                  source={money.net.why}
                  showName={showName}
                />
              }
            />
          </>
        )}
      </KpiCardGrid>
      {money === null && <p className={styles['private']}>{BOX_OFFICE_TEXT.private}</p>}
    </div>
  );
}

function BoxOfficeLoading() {
  return (
    <div className={styles['skeleton']} aria-busy="true">
      <VisuallyHidden>Loading the box office</VisuallyHidden>
      <span className={styles['skeletonCard']} />
      <span className={styles['skeletonCard']} />
      <span className={styles['skeletonCard']} />
    </div>
  );
}

export interface BoxOfficeSectionProps {
  readonly eventInstanceId: EventInstanceId;
  readonly showName: string;
  /** The viewer runs the show: only then is its money asked for. */
  readonly mine: boolean;
}

/**
 * The results page's "Box office" section (EVT6-05): how many came and, for the player's own
 * shows, what the night took. The heading is the results panel's own.
 */
export function BoxOfficeSection({ eventInstanceId, showName, mine }: BoxOfficeSectionProps) {
  const crowdQuery = useEngineQuery('boxOffice.showCrowd', { eventInstanceId });
  const settled = crowdQuery.data?.status === 'settled';
  const moneyQuery = useEngineQuery(
    'boxOffice.showMoney',
    { eventInstanceId },
    { enabled: mine && settled },
  );
  if (crowdQuery.status === 'loading') return <BoxOfficeLoading />;
  if (crowdQuery.status === 'error' || crowdQuery.data === undefined) {
    return (
      <EmptyState icon="warning" title={BOX_OFFICE_TEXT.error} body={errorText(crowdQuery.error)} />
    );
  }
  const crowd = crowdData(crowdQuery.data);
  if (crowd === null) return <EmptyState icon="info" title={BOX_OFFICE_TEXT.notSettled} />;
  if (!mine) return <BoxOfficeKpis showName={showName} crowd={crowd} money={null} />;
  if (moneyQuery.status === 'loading') return <BoxOfficeLoading />;
  if (moneyQuery.status === 'error' || moneyQuery.data === undefined) {
    return (
      <EmptyState icon="warning" title={BOX_OFFICE_TEXT.error} body={errorText(moneyQuery.error)} />
    );
  }
  return <BoxOfficeKpis showName={showName} crowd={crowd} money={moneyData(moneyQuery.data)} />;
}
