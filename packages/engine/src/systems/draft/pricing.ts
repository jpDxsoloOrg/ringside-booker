/**
 * What a draft pick costs a promotion (DRF-10): the contract the pick signs at their ask (the
 * existing contract code prices it for this promotion, as {@link signAtAsk} signs it) and that
 * contract's cost for the season, from the pick to {@link seasonContractEnd}.
 *
 * Asks depend on the promotion (its reach, image and the kinds it may offer), so prices are worked
 * out per promotion, lazily, and kept for the rest of the command: a rival's pick prices only the
 * few candidates it looks at, and the draft room prices one page of the pool.
 *
 * Design: docs/design/draft.md#season-cost.
 */

import { addDays, diffDays, type GameDate } from '../../core/date';
import { cents } from '../../core/money';
import type { PersonId, PromotionId } from '../../core/ids';
import type { ContractTerms, Push } from '../../model/entities/employment';
import type { GameWorldView } from '../../model/tables';
import { askingContext, askingTermsWith, type AskingContext } from '../negotiation/asking';
import { negotiationEligibility } from '../negotiation/eligibility';
import { askTermsOf } from '../negotiation/evaluate';
import type { EngineTunables } from '../tunables';
import { seasonCost, type SeasonCost, type SeasonCostInputs } from './seasonCost';

/** The first day after the season the draft starts in: when a contract signed at the pick ends. */
export function seasonContractEnd(read: GameWorldView, date: GameDate): GameDate {
  const season = read.tables.seasons.lookup('activeSeason', 'active')[0];
  if (season !== undefined && season.endDate >= date) {
    return addDays(season.endDate, 1);
  }
  return addDays(date, read.meta.settings.season.lengthDays);
}

/** One candidate's contract at the pick and what it costs for the season. */
export interface PickPrice {
  readonly terms: ContractTerms;
  readonly expectedPush: Push;
  readonly inputs: SeasonCostInputs;
  readonly cost: SeasonCost;
}

/** Prices picks for any promotion on one date; every price is kept for the pricer's lifetime. */
export class DraftPricer {
  readonly #read: GameWorldView;
  readonly #tunables: EngineTunables;
  readonly #contexts = new Map<PromotionId, AskingContext>();
  readonly #prices = new Map<string, PickPrice>();
  readonly date: GameDate;
  /** When contracts signed at the pick end (the first day they do not cover). */
  readonly endsOn: GameDate;

  constructor(read: GameWorldView, tunables: EngineTunables, date: GameDate) {
    this.#read = read;
    this.#tunables = tunables;
    this.date = date;
    this.endsOn = seasonContractEnd(read, date);
  }

  /** The asking context of a promotion, read once. */
  context(promotionId: PromotionId): AskingContext {
    let context = this.#contexts.get(promotionId);
    if (context === undefined) {
      context = askingContext(this.#read, this.#tunables, promotionId, this.date);
      this.#contexts.set(promotionId, context);
    }
    return context;
  }

  /** The contract `personId` asks `promotionId` for at the pick, and its season cost. */
  price(promotionId: PromotionId, personId: PersonId): PickPrice {
    const key = `${promotionId}|${personId}`;
    const known = this.#prices.get(key);
    if (known !== undefined) {
      return known;
    }
    const eligibility = negotiationEligibility(
      this.#read,
      this.#tunables,
      personId,
      promotionId,
      this.date,
    );
    const ask = askingTermsWith(this.context(promotionId), { personId }, eligibility);
    const terms = { ...askTermsOf(ask), signingBonus: cents(0) };
    const inputs: SeasonCostInputs = {
      monthlyWage: terms.monthlyWage,
      perAppearanceFee: terms.perAppearanceFee,
      appearanceCap: terms.appearanceCap,
      days: diffDays(this.date, this.endsOn),
      appearancesPerWeek: this.#tunables.get('draft.cost.appearancesPerWeek'),
      wageMultiplier: this.#tunables.get('finance.wages.multiplier'),
    };
    const price: PickPrice = {
      terms,
      expectedPush: ask.expectedPush.value,
      inputs,
      cost: seasonCost(inputs),
    };
    this.#prices.set(key, price);
    return price;
  }

  /**
   * A per-appearance deal at `personId`'s ask to `promotionId` (no wage, no bonus), or null when
   * this promotion may not offer them one. For rivals filling a short roster after the draft.
   */
  perAppearance(
    promotionId: PromotionId,
    personId: PersonId,
  ): { terms: ContractTerms; expectedPush: Push } | null {
    const eligibility = negotiationEligibility(
      this.#read,
      this.#tunables,
      personId,
      promotionId,
      this.date,
    );
    const ask = askingTermsWith(
      this.context(promotionId),
      { personId, kind: 'perAppearance' },
      eligibility,
    );
    const allowed = ask.allowedKinds.some(
      (entry) => entry.kind === 'perAppearance' && entry.allowed,
    );
    if (!allowed || ask.refusal !== null) {
      return null;
    }
    return {
      terms: {
        ...askTermsOf(ask),
        kind: 'perAppearance',
        monthlyWage: cents(0),
        signingBonus: cents(0),
      },
      expectedPush: ask.expectedPush.value,
    };
  }
}
