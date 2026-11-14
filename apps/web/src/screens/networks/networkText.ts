import { cents, NETWORK_REACH_TIER_MAX } from '@ringside/engine';
import type {
  AiringRow,
  DealEndReason,
  DealRisk,
  DealTimeslot,
  NetworkKind,
  Weekday,
} from '@ringside/engine';
import { formatMoney } from '@/components/format';
import type { RoleTone } from '@/components/tone';

/**
 * The words the Networks screen uses for slots, kinds, risks and endings, in one place so the
 * table, the cards, the sheets and the gallery all say the same thing. Never minutes or hours:
 * a timeslot is a part of the evening, not a clock time.
 */

export const TIMESLOT_LABELS: Readonly<Record<DealTimeslot, string>> = {
  daytime: 'Daytime',
  evening: 'Evening',
  primeTime: 'Prime time',
  lateNight: 'Late night',
};

/** The timeslots in the order of a day. */
export const TIMESLOTS: readonly DealTimeslot[] = ['daytime', 'evening', 'primeTime', 'lateNight'];

/** Weekdays as the engine numbers them (0 is Monday), short. */
export const WEEKDAY_SHORT: Readonly<Record<Weekday, string>> = {
  0: 'Mon',
  1: 'Tue',
  2: 'Wed',
  3: 'Thu',
  4: 'Fri',
  5: 'Sat',
  6: 'Sun',
};

export const NETWORK_KIND_LABELS: Readonly<Record<NetworkKind, string>> = {
  tv: 'TV network',
  streaming: 'Streaming service',
  ppv: 'Pay-per-view',
};

export interface SlotParts {
  readonly weekday: Weekday | null;
  readonly timeslot: DealTimeslot;
  readonly live: boolean;
  readonly kind: NetworkKind;
}

/**
 * "Mon · Prime time · Live", "Thu · Evening · Taped", "Pay-per-view · Live". Pay-per-view is not
 * tied to a timeslot, so it says so instead; a deal not tied to one weekday leaves the day out.
 */
export function formatSlot({ weekday, timeslot, live, kind }: SlotParts): string {
  const parts: string[] = [];
  if (weekday !== null) parts.push(WEEKDAY_SHORT[weekday]);
  parts.push(kind === 'ppv' ? 'Pay-per-view' : TIMESLOT_LABELS[timeslot]);
  parts.push(live ? 'Live' : 'Taped');
  return parts.join(' · ');
}

/** "Tier 2 of 4": how far a network reaches. */
export function tierText(reachTier: number): string {
  return `Tier ${String(reachTier)} of ${String(NETWORK_REACH_TIER_MAX)}`;
}

/** Why an ended deal ended, as the row says it. */
export const END_REASON_TEXT: Readonly<Record<DealEndReason, string>> = {
  expired: 'Ran to its end date',
  lowViewers: 'Cancelled by the network: low viewers',
  missedAirings: 'Cancelled by the network: too many missed airings',
  byPromotion: 'You cancelled it',
  networkClosed: 'The network closed down',
};

export const RISK_LABELS: Readonly<Record<DealRisk, string>> = {
  safe: 'Safe',
  watch: 'Watch',
  atRisk: 'At risk',
  cancelling: 'Cancelling',
};

/** The colour role of each risk (docs/design/visual-identity.md). */
export const RISK_TONES: Readonly<Record<DealRisk, RoleTone>> = {
  safe: 'positive',
  watch: 'neutral',
  atRisk: 'action',
  cancelling: 'negative',
};

export const MISSED_AIRING_LABEL = 'Missed airing';

/** True when the worst reason behind a risk is a missed airing (past or coming). */
export function firstReasonIsMissedAiring(reasons: readonly string[]): boolean {
  const first = reasons[0];
  return first !== undefined && /missed airing/i.test(first);
}

/** The badge's words: the risk, or "Missed airing" when that is the worst reason. */
export function riskLabel(risk: DealRisk, reasons: readonly string[]): string {
  return firstReasonIsMissedAiring(reasons) ? MISSED_AIRING_LABEL : RISK_LABELS[risk];
}

/** "Aired", "Missed: show cancelled", "Aired without a show result". */
export function airingStatusText(
  airing: Pick<AiringRow, 'status' | 'missReason' | 'qualitySource'>,
): string {
  if (airing.status === 'missed') {
    return airing.missReason === 'notRun' ? 'Missed: show not run' : 'Missed: show cancelled';
  }
  return airing.qualitySource === 'neutral' ? 'Aired without a show result' : 'Aired';
}

/**
 * A pay-per-view rate per thousand buys as a per-buy price, with its cents: 180000 cents per
 * thousand buys is "$1.80 per buy".
 */
export function perBuyText(perThousandBuys: number): string {
  return `${formatMoney(cents(Math.round(perThousandBuys / 1000)), { style: 'full', showCents: true })} per buy`;
}

/** The label of the per-thousand term for a kind of network. */
export function perThousandLabel(kind: NetworkKind): string {
  return kind === 'ppv' ? 'Per buy' : 'Per 1,000 viewers';
}

/** The months a deal may run, for the length pickers. */
export const DEAL_LENGTH_MONTHS: readonly number[] = [6, 12, 24, 36, 48];

/** "24 months", "1 year" would hide the number the network reads: always months. */
export function monthsText(months: number): string {
  return `${String(months)} ${months === 1 ? 'month' : 'months'}`;
}

/** The tunable that holds the usual deal length. */
export const DEFAULT_MONTHS_KEY = 'broadcast.deal.defaultMonths';
export const BROADCAST_CATEGORY = 'Broadcast';
/** The engine's default for `broadcast.deal.defaultMonths`, until the rules arrive. */
export const FALLBACK_DEFAULT_MONTHS = 24;

/** What a deal that loses money every airing says, plainly. */
export const LOSES_MONEY_TEXT =
  'This deal loses money every airing: the airtime costs more than the network pays.';

/** The owner's trade-off on pay-per-view airtime, said before signing. */
export const PPV_AIRTIME_TEXT =
  'Pay-per-view airtime is expensive. You pay it on every show the deal carries, in return for the money from each buy.';

/** The link after the camera refusal in the Propose sheet: the camera is raised in Production. */
export const OPEN_PRODUCTION_TEXT = 'Open Production';
