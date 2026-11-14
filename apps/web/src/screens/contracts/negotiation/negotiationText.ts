/**
 * The words of the Free agents and Offers tabs and the Negotiation Sheet (ECO5-06), kept apart from
 * the components so tests, the gallery and the Next Day summary say exactly the same thing.
 */
import { PUSH_LABELS } from '@ringside/engine';
import type {
  FreeAgentRow,
  GameDate,
  NegotiationSituation,
  NegotiationStatus,
  Offer,
  OfferRow,
  OfferSummary,
  OfferUpdates,
} from '@ringside/engine';
import { formatGameDate, formatNumber } from '@/components/format';
import type { ContractMoney } from '../useContractMoney';

/** "Free agent", "Per appearance at Crown Pro", "Free from Sep 30, 2026". */
export function situationText(
  row: Pick<FreeAgentRow, 'situation' | 'otherPromotionName' | 'endsOn'>,
): string {
  return situationWords(row.situation, row.otherPromotionName, row.endsOn);
}

export function situationWords(
  situation: NegotiationSituation,
  otherPromotionName: string | null,
  endsOn: GameDate | null,
): string {
  switch (situation) {
    case 'freeAgent':
      return 'Free agent';
    case 'perAppearanceElsewhere':
      return otherPromotionName === null
        ? 'Per appearance elsewhere'
        : `Per appearance at ${otherPromotionName}`;
    case 'endingSoonElsewhere':
      return endsOn === null ? 'Free soon' : `Free from ${formatGameDate(endsOn)}`;
    case 'underContract':
      return otherPromotionName === null
        ? 'Under contract elsewhere'
        : `Under contract at ${otherPromotionName}`;
    case 'yours':
      return 'Under contract with you';
    case 'unavailable':
      return 'Not available';
  }
}

/** "2 other bidders", "1 other bidder", or null with none. Names only: never their terms. */
export function biddersCountText(count: number): string | null {
  if (count === 0) return null;
  return `${formatNumber(count)} other ${count === 1 ? 'bidder' : 'bidders'}`;
}

/** "Also talking to: Crown Pro, Lakeshore", or null with nobody else. */
export function alsoTalkingText(names: readonly string[]): string | null {
  return names.length === 0 ? null : `Also talking to: ${names.join(', ')}`;
}

/** The talks column of Free agents: "Talking", "Cooldown until Feb 3, 2027", "2 other bidders". */
export function talksStateText(
  row: Pick<FreeAgentRow, 'openNegotiationId' | 'cooldownUntil' | 'competingBidders'>,
): string {
  const parts: string[] = [];
  if (row.openNegotiationId !== null) parts.push('Talking');
  else if (row.cooldownUntil !== null)
    parts.push(`Cooldown until ${formatGameDate(row.cooldownUntil)}`);
  const bidders = biddersCountText(row.competingBidders.length);
  if (bidders !== null) parts.push(bidders);
  return parts.length === 0 ? 'No talks yet' : parts.join(' · ');
}

/** "Walked away from talks with you: try again after Feb 3, 2027". */
export function cooldownReason(until: GameDate): string {
  return `Walked away from talks with you: try again after ${formatGameDate(until)}`;
}

/** An offer's status in plain words, as the Offers tab and the sheet show it. */
export function offerStatusText(
  row: Pick<OfferRow, 'status' | 'reviewOn' | 'counterExpiresOn' | 'cooldownUntil' | 'outcome'>,
): string {
  switch (row.status) {
    case 'submitted':
      return 'Considering your offer: they answer after the next day';
    case 'awaitingReview':
      return row.reviewOn === null
        ? 'Considering your offer'
        : `Considering your offer: decides on ${formatGameDate(row.reviewOn)}`;
    case 'countered':
      return row.counterExpiresOn === null
        ? 'Countered: waiting for your answer'
        : `Countered: answer by ${formatGameDate(row.counterExpiresOn)}`;
    case 'signed':
      return 'Signed';
    case 'walkedAway':
      return row.cooldownUntil === null
        ? 'Walked away'
        : `Walked away: try again after ${formatGameDate(row.cooldownUntil)}`;
    case 'declined':
    case 'lapsed':
    case 'withdrawn':
      return row.outcome?.message ?? closedWords(row.status);
  }
}

function closedWords(status: NegotiationStatus): string {
  if (status === 'lapsed') return 'They stopped waiting for your answer';
  if (status === 'withdrawn') return 'You withdrew the offer';
  return 'Talks closed';
}

/** "Decides on Jan 8, 2027" / "Answer by Jan 14, 2027" / null: the Offers tab's date column. */
export function offerDueText(
  row: Pick<OfferRow, 'status' | 'reviewOn' | 'counterExpiresOn'>,
): string | null {
  if (row.status === 'awaitingReview' && row.reviewOn !== null) {
    return `Decides on ${formatGameDate(row.reviewOn)}`;
  }
  if (row.status === 'countered' && row.counterExpiresOn !== null) {
    return `Answer by ${formatGameDate(row.counterExpiresOn)}`;
  }
  return null;
}

/** "$24,000 a month, $2,000 to sign, 24 months, exclusive", in the player's money style. */
export function offerSummaryText(
  offer: {
    readonly lengthMonths: number;
    readonly terms: Pick<
      OfferSummary,
      'kind' | 'monthlyWage' | 'perAppearanceFee' | 'signingBonus' | 'exclusive'
    >;
  },
  money: ContractMoney,
): string {
  const { terms } = offer;
  const parts = [
    terms.kind === 'perAppearance'
      ? `${money(terms.perAppearanceFee)} an appearance`
      : `${money(terms.monthlyWage)} a month`,
  ];
  if (terms.signingBonus > 0) parts.push(`${money(terms.signingBonus)} to sign`);
  parts.push(
    `${formatNumber(offer.lengthMonths)} ${offer.lengthMonths === 1 ? 'month' : 'months'}`,
  );
  if (terms.exclusive) parts.push('exclusive');
  return parts.join(', ');
}

/** "They countered $34,200 a month, 24 months, Upper card". */
export function counterLineText(offer: Offer, money: ContractMoney): string {
  const push = offer.push === 'none' ? '' : `, ${PUSH_LABELS[offer.push]}`;
  return `They countered ${offerSummaryText(offer, money)}${push}`;
}

/** "You offered $24,000 a month, 24 months". */
export function offeredLineText(offer: Offer, money: ContractMoney): string {
  return `You offered ${offerSummaryText(offer, money)}`;
}

/** "Patience: 2 of 3 rounds left". */
export function patienceText(left: number, start: number): string {
  return `Patience: ${formatNumber(left)} of ${formatNumber(start)} ${start === 1 ? 'round' : 'rounds'} left`;
}

/** What the sheet says once an offer is on its way. */
export function offerSentText(reviewOn: GameDate | null): string {
  return reviewOn === null
    ? "Offer sent. They'll answer after the next day."
    : `Offer accepted. They'll decide on ${formatGameDate(reviewOn)}.`;
}

/** The Next Day summary's negotiation lines: "Rhea Vance countered", "Signed Kade Moreno", ... */
export function offerUpdateLines(updates: OfferUpdates): string[] {
  return [
    ...updates.countered.map((update) => `${update.ringName} countered`),
    ...updates.signed.map((update) => `Signed ${update.ringName}`),
    ...updates.walkedAway.map((update) => `${update.ringName} walked away`),
    ...updates.declined.map((update) => `${update.ringName}: ${lowerFirst(update.outcomeMessage)}`),
    ...updates.lapsed.map((update) => `${update.ringName} stopped waiting for your answer`),
  ];
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/** True when the advance brought negotiation news worth the banner on a one-day Next Day. */
export function offerUpdatesNeedBanner(updates: OfferUpdates | undefined): boolean {
  if (updates === undefined) return false;
  return offerUpdateLines(updates).length > 0;
}
