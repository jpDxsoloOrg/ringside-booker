/**
 * The words for one show's airings (ECO8-07), shared by the calendar sheet's "On TV" section and
 * the results page's "On TV" section, so both say the same thing. Viewers are public for any
 * promotion; money only ever comes in for the viewer's own shows (the engine leaves it null).
 */
import { shortViewers } from '@ringside/engine';
import type { AiringMissReason, AiringRow, NetworkKind } from '@ringside/engine';

/** What a deal on each kind of network is called after its network: "(TV deal)". */
export const DEAL_KIND_TEXT: Readonly<Record<NetworkKind, string>> = {
  tv: 'TV deal',
  ppv: 'pay-per-view deal',
  streaming: 'streaming deal',
};

/** What an airing's money is called, as on the ledger: "TV rights $1.6M". */
export const AIRING_MONEY_LABELS: Readonly<Record<NetworkKind, string>> = {
  tv: 'TV rights',
  ppv: 'Pay-per-view',
  streaming: 'Streaming',
};

/** Why nothing aired, after "Missed airing: ". */
export const MISSED_REASON_TEXT: Readonly<Record<AiringMissReason, string>> = {
  showCancelled: 'show cancelled',
  notRun: "the show didn't run",
};

/** The section's other states. */
export const ON_TV_TEXT = {
  title: 'On TV',
  loading: 'Checking the TV deals…',
  error: "The show's airing can't be shown.",
  noDeal: 'No TV deal carries this show.',
} as const;

/** "2.4M viewers", or "152K buys" on pay-per-view. */
export function viewersText(viewers: number, kind: NetworkKind): string {
  return `${shortViewers(viewers)} ${kind === 'ppv' ? 'buys' : 'viewers'}`;
}

/** "Airs on National Signal Network (TV deal)": one of your shows still to air. */
export function airsOnText(networkName: string, kind: NetworkKind): string {
  return `Airs on ${networkName} (${DEAL_KIND_TEXT[kind]})`;
}

/** "On National Signal Network": a rival's show still to air (who carries it is public). */
export function onNetworkText(networkName: string): string {
  return `On ${networkName}`;
}

/** "Missed airing: show cancelled". */
export function missedText(reason: AiringMissReason | null): string {
  return reason === null ? 'Missed airing' : `Missed airing: ${MISSED_REASON_TEXT[reason]}`;
}

/** The network kind of an airing's deal, from the show's deal list (TV when not listed). */
export function kindOfRow(
  row: Pick<AiringRow, 'dealId'>,
  deals: readonly { readonly dealId: string; readonly kind: NetworkKind }[],
): NetworkKind {
  return deals.find((deal) => deal.dealId === row.dealId)?.kind ?? 'tv';
}
