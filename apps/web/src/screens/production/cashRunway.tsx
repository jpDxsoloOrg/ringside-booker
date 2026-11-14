/**
 * The cash runway (ECO7-06): how much money the promotion makes or loses a month at this rate,
 * what its fixed spend is, and how many months its cash lasts. Drawn from `production.cashRunway`
 * as a "Cash runway" card on Production (header item, order 50, registered here) and on the
 * Finances Overview (KPI order 15, right after Cash, registered in `financeKpi.tsx`), and as a
 * warning banner at the top of both screens while money is going out faster than it comes in.
 * Every number has a Why?.
 */
import { Link } from 'react-router-dom';
import { cents } from '@ringside/engine';
import type { CashRunwayView, PromotionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { useSettingsStore } from '@/app/settings/settingsStore';
import { Badge } from '@/components/Badge';
import { classNames } from '@/components/classNames';
import { formatSignedMoney, useMoneyFormatter } from '@/components/format';
import { Icon } from '@/components/Icon';
import { KpiCard } from '@/components/KpiCard';
import type { KpiCardTone } from '@/components/KpiCard';
import { WhyButton } from '@/components/Trace';
import { registerBuiltinProductionHeaderItem } from './productionHeaderRegistry';
import styles from './cashRunway.module.css';

/** The card's id in the Finances KPI registry. */
export const CASH_RUNWAY_KPI_ID = 'eco7.cashRunway';
/** Right after Cash (10), before This month (20): how long that cash lasts. */
export const CASH_RUNWAY_KPI_ORDER = 15;
/** Last in the Production header, after show production (40). */
export const CASH_RUNWAY_HEADER_ORDER = 50;

/** "less than a month", "about 1 month", "about 8 months". */
export function runwayMonthsText(months: number): string {
  if (months < 1) return 'less than a month';
  const rounded = Math.round(months);
  return rounded === 1 ? 'about 1 month' : `about ${String(rounded)} months`;
}

/** "7 more days", "1 more day". */
function moreDaysText(days: number): string {
  return days === 1 ? '1 more day' : `${String(days)} more days`;
}

/** True while money goes out faster than it comes in, or the cash is gone. */
export function runwayWarns(runway: CashRunwayView): boolean {
  return (
    runway.status === 'losingMoney' ||
    runway.status === 'runningOut' ||
    runway.status === 'outOfCash'
  );
}

/** The badge words and tone for a status, or null when there is nothing to flag. */
function statusBadge(
  runway: CashRunwayView,
): { text: string; tone: 'warning' | 'negative' } | null {
  switch (runway.status) {
    case 'losingMoney':
      return { text: 'Losing money', tone: 'warning' };
    case 'runningOut':
      return { text: 'Running out of cash', tone: 'negative' };
    case 'outOfCash':
      return { text: 'Out of cash', tone: 'negative' };
    case 'makingMoney':
    case 'tooEarly':
      return null;
  }
}

/** The one sentence the card and the banner lead with. `money` formats cents. */
export function runwayHeadline(runway: CashRunwayView, money: (amount: number) => string): string {
  const monthly = money(Math.abs(runway.monthlyNet));
  switch (runway.status) {
    case 'losingMoney':
    case 'runningOut':
      return `At this rate you run out of cash in ${runwayMonthsText(runway.monthsLeft ?? 0)}.`;
    case 'outOfCash':
      return runway.monthlyNet < 0
        ? `You are out of cash. Costs are still paid, so the debt grows by about ${monthly} a month.`
        : 'You are out of cash. Costs are still paid until money comes back in.';
    case 'makingMoney':
      return `At this rate your cash grows by about ${monthly} a month.`;
    case 'tooEarly':
      return `Fixed costs come to ${monthly} a month. Ticket sales and other show money count after ${moreDaysText(runway.daysUntilForecast)}.`;
  }
}

/** The big number of the card. */
function cardValue(runway: CashRunwayView): { value: string; unit?: string } {
  switch (runway.status) {
    case 'losingMoney':
    case 'runningOut': {
      const months = runway.monthsLeft ?? 0;
      if (months < 1) return { value: 'Under 1', unit: 'month' };
      const rounded = Math.round(months);
      return { value: String(rounded), unit: rounded === 1 ? 'month' : 'months' };
    }
    case 'outOfCash':
      return { value: 'Out of cash' };
    case 'makingMoney':
      return { value: 'Growing' };
    case 'tooEarly':
      return { value: 'After a week' };
  }
}

function cardTone(runway: CashRunwayView): KpiCardTone {
  return runway.status === 'runningOut' || runway.status === 'outOfCash' ? 'negative' : 'neutral';
}

/** The Why? of the card's main figure: the months left when there are some, else the month's net. */
function RunwayWhy({ runway }: { readonly runway: CashRunwayView }) {
  if (runway.monthsLeft !== null && runway.monthsLeftTrace !== null) {
    return (
      <WhyButton
        label="Months of cash left"
        value={runway.monthsLeft}
        unit="months"
        source={{ trace: runway.monthsLeftTrace }}
      />
    );
  }
  return (
    <WhyButton
      label="Money a month at this rate"
      value={runway.monthlyNet}
      unit="money"
      source={{ trace: runway.monthlyNetTrace }}
    />
  );
}

export interface CashRunwayCardViewProps {
  readonly runway: CashRunwayView;
  /** Adds a link to Production (the Finances Overview's card). */
  readonly link?: 'production';
}

/**
 * "Cash runway": the months the cash lasts (or Growing / Out of cash / After a week), the sentence
 * that says it plainly, the month's net with its Why?, and the fixed spend a month, line by line.
 */
export function CashRunwayCardView({ runway, link }: CashRunwayCardViewProps) {
  const formatMoney = useMoneyFormatter();
  const moneyStyle = useSettingsStore((state) => state.settings.moneyStyle);
  const money = (amount: number) => formatMoney(cents(amount));
  const badge = statusBadge(runway);
  const { value, unit } = cardValue(runway);
  const spend = [
    ['Wages', runway.spend.wages],
    ['Medical', runway.spend.medical],
    ['Production overhead', runway.spend.overhead],
    ['Show production', runway.spend.showProduction],
  ] as const;
  return (
    <KpiCard
      label="Cash runway"
      icon="finance"
      value={value}
      {...(unit === undefined ? {} : { unit })}
      tone={cardTone(runway)}
      footer={
        <span className={styles['footer']}>
          {badge !== null && (
            <span>
              <Badge tone={badge.tone}>{badge.text}</Badge>
            </span>
          )}
          <span className={styles['headline']}>{runwayHeadline(runway, money)}</span>
          <span className={styles['line']}>
            <span>
              {runway.status === 'tooEarly' ? 'Fixed costs a month' : 'A month at this rate'}
            </span>
            <span className={styles['net']}>
              <span className="tabular">
                {formatSignedMoney(cents(runway.monthlyNet), { style: moneyStyle })}
              </span>
              <WhyButton
                label="Money a month at this rate"
                value={runway.monthlyNet}
                unit="money"
                source={{ trace: runway.monthlyNetTrace }}
              />
            </span>
          </span>
          <span className={styles['spend']} aria-label="Fixed spend a month">
            {spend.map(([label, amount]) => (
              <span key={label} className={styles['line']}>
                <span>{label}</span>
                <span className="tabular">{money(amount)}</span>
              </span>
            ))}
          </span>
          {link === 'production' && (
            <Link to={routes.game.production()} className={styles['link']}>
              Production
            </Link>
          )}
        </span>
      }
      why={<RunwayWhy runway={runway} />}
    />
  );
}

export interface CashRunwayBannerViewProps {
  readonly runway: CashRunwayView;
}

/**
 * The warning strip at the top of Production and the Finances Overview while money goes out
 * faster than it comes in: what is happening in words, and the Why?. Nothing otherwise.
 */
export function CashRunwayBannerView({ runway }: CashRunwayBannerViewProps) {
  const formatMoney = useMoneyFormatter();
  const badge = statusBadge(runway);
  if (!runwayWarns(runway) || badge === null) return null;
  const money = (amount: number) => formatMoney(cents(amount));
  const severe = badge.tone === 'negative';
  return (
    <section
      className={classNames(styles['banner'], severe && styles['severe'])}
      aria-label="Cash warning"
    >
      <p className={styles['kicker']}>
        <Icon name="warning" size="sm" decorative />
        {badge.text}
      </p>
      <p className={styles['bannerText']}>
        {runwayHeadline(runway, money)}{' '}
        {runway.status !== 'outOfCash' &&
          `You lose about ${money(Math.abs(runway.monthlyNet))} a month.`}
      </p>
      <RunwayWhy runway={runway} />
    </section>
  );
}

/** The runway for the seat's promotion; nothing while it loads or if it is refused. */
function useCashRunway(promotionId: PromotionId): CashRunwayView | undefined {
  return useEngineQuery('production.cashRunway', { promotionId }).data;
}

export function CashRunwayCard({
  promotionId,
  link,
}: {
  readonly promotionId: PromotionId;
  readonly link?: 'production';
}) {
  const runway = useCashRunway(promotionId);
  if (runway === undefined) return null;
  return <CashRunwayCardView runway={runway} {...(link === undefined ? {} : { link })} />;
}

export function CashRunwayBanner({ promotionId }: { readonly promotionId: PromotionId }) {
  const runway = useCashRunway(promotionId);
  if (runway === undefined) return null;
  return <CashRunwayBannerView runway={runway} />;
}

registerBuiltinProductionHeaderItem({
  id: 'production.cashRunway',
  order: CASH_RUNWAY_HEADER_ORDER,
  render: ({ promotionId }) => <CashRunwayCard promotionId={promotionId} />,
});
