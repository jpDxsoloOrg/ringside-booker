/**
 * Player-facing names of the ledger categories, and whether each is income or a cost.
 *
 * The web app shows these labels and never its own wording, so a category is named the same on
 * every screen. See docs/design/finances.md#categories.
 */

import { LEDGER_CATEGORY_SIGN, type LedgerCategory } from '../../model/entities/ledger-entry';

/** What the player reads for each ledger category. */
export const LEDGER_CATEGORY_LABELS: Readonly<Record<LedgerCategory, string>> = Object.freeze({
  tickets: 'Tickets',
  liveMerch: 'Live merchandise',
  merch: 'Merchandise',
  broadcast: 'TV rights',
  ppv: 'Pay-per-view',
  streaming: 'Streaming',
  sponsorship: 'Sponsorship',
  otherIncome: 'Other income',
  subsidyIncome: 'Subsidies received',
  wages: 'Wages',
  appearanceFees: 'Appearance fees',
  signingBonuses: 'Signing bonuses',
  severance: 'Severance',
  venueRent: 'Venue rent',
  production: 'Production',
  travel: 'Travel',
  marketing: 'Marketing',
  backOffice: 'Back office',
  medical: 'Medical',
  catering: 'Catering',
  charity: 'Charity',
  networkUpkeep: 'Network upkeep',
  buyout: 'Buyouts',
  subsidy: 'Subsidies paid',
  otherCost: 'Other costs',
});

/** Whether a category's amounts are income or costs, read from its sign. */
export type LedgerCategoryKind = 'income' | 'cost';

/** `income` for a category whose amounts are positive, `cost` for one whose amounts are negative. */
export function ledgerCategoryKind(category: LedgerCategory): LedgerCategoryKind {
  return LEDGER_CATEGORY_SIGN[category] > 0 ? 'income' : 'cost';
}
