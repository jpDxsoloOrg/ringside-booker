/**
 * What a trade reads about one worker in it: their contract, what they cost, who they are on the
 * card and in the ring, and the draft value (`systems/draft/draftValue.ts`, BRW1-01's shared
 * formula) the rival desk ranks them by. One pass, no traces; the traced value is built only for
 * the workers a screen or an answer explains.
 *
 * Design: docs/design/trades.md#valuation.
 */

import { addMonths, ageInYears, diffDays, type GameDate } from '../../core/date';
import type { EmploymentId, PersonId, PromotionId, TitleId } from '../../core/ids';
import type { Alignment, Employment, EmploymentRole, Push } from '../../model/entities/employment';
import type { Gender } from '../../model/entities/person';
import type { TradeAdjustment } from '../../model/entities/trade';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { draftValueParts, draftValueWeights } from '../draft/draftValue';
import { marketValue } from '../negotiation/formulas/marketValue';
import { titlesHeldBy } from '../titles/helpers/holders';
import type { EngineTunables } from '../tunables';
import { overallOf } from '../workers/formulas/roleRating';
import { availabilityOf } from '../workers/helpers/availability';
import { createPopularityRoller, type PopularityRoller } from '../world/formulas/popularityRollup';
import { geographyOf } from '../world/geography';

/** Days in a month, for months left on a contract. */
const DAYS_PER_MONTH = 30.44;

export interface TradeWorker {
  readonly employmentId: EmploymentId;
  readonly personId: PersonId;
  readonly name: string;
  readonly promotionId: PromotionId;
  readonly role: EmploymentRole;
  readonly push: Push;
  readonly alignment: Alignment;
  readonly gender: Gender;
  readonly available: boolean;
  readonly age: number;
  /** Role rating in their contract's role, 0-100. */
  readonly rating: number;
  readonly peakPop: number;
  readonly worldPop: number;
  /** Draft value, 0-100. */
  readonly value: number;
  /** What the contract costs a month (wage, or fee × appearances a month), after any change. */
  readonly monthlyCost: number;
  /** The main pay before any change: the wage, or the appearance fee. */
  readonly pay: number;
  /** The main pay after the deal's change, or the same as `pay`. */
  readonly payAfter: number;
  /** Market value a month, in cents. */
  readonly marketMonthly: number;
  /** Months left after the deal (null for an open-ended contract). */
  readonly monthsLeft: number | null;
  /** The contract's end after the deal, or null for open-ended. */
  readonly endsOn: GameDate | null;
  /** Titles they hold today. */
  readonly titleIds: readonly TitleId[];
  readonly employment: DeepReadonly<Employment>;
}

/** Reads the shared tables once for many workers. */
export class TradeWorkerReader {
  readonly #read: GameWorldView;
  readonly #tunables: EngineTunables;
  readonly #date: GameDate;
  #roller: PopularityRoller | null = null;

  constructor(read: GameWorldView, tunables: EngineTunables, date: GameDate) {
    this.#read = read;
    this.#tunables = tunables;
    this.#date = date;
  }

  #popularity(): PopularityRoller {
    this.#roller ??= createPopularityRoller(geographyOf(this.#read));
    return this.#roller;
  }

  /** The worker on this contract, or null when there is no such contract or person. */
  worker(
    employmentId: EmploymentId,
    adjustment: DeepReadonly<TradeAdjustment> | null = null,
  ): TradeWorker | null {
    const read = this.#read;
    const employment = read.tables.employments.get(employmentId);
    const person =
      employment === undefined ? undefined : read.tables.people.get(employment.personId);
    if (employment === undefined || person === undefined) {
      return null;
    }
    const tunables = this.#tunables;
    const date = this.#date;
    const rating = overallOf(person, employment.role, { tunables }).value;
    const popularity = this.#popularity().rollValues(person.regionalPop);
    const peakPop = popularity.top?.value ?? 0;
    const worldPop = popularity.world;
    const age = ageInYears(person.birthDate, date);
    const value = draftValueParts(
      { roleRating: rating, peakPop, worldPop, age },
      draftValueWeights(tunables),
    ).value;
    const perAppearance = employment.terms.kind === 'perAppearance';
    const pay = perAppearance ? employment.terms.perAppearanceFee : employment.terms.monthlyWage;
    const payAfter = adjustment?.pay ?? pay;
    const appearances = tunables.get('trades.value.appearancesPerMonth');
    const wage = perAppearance ? 0 : payAfter;
    const fee = perAppearance ? payAfter : employment.terms.perAppearanceFee;
    const monthlyCost = wage + fee * appearances;
    const endsOn =
      adjustment?.lengthMonths !== null && adjustment?.lengthMonths !== undefined
        ? addMonths(date, adjustment.lengthMonths)
        : employment.endsOn;
    const monthsLeft =
      endsOn === null ? null : Math.max(0, diffDays(date, endsOn) / DAYS_PER_MONTH);
    const market = marketValue(
      { peakPop, worldPop, roleRating: rating, role: employment.role, starMerchMonthly: null },
      { tunables },
    ).value;
    return {
      employmentId: employment.id,
      personId: person.id,
      name: employment.ringName,
      promotionId: employment.promotionId,
      role: employment.role,
      push: employment.push,
      alignment: employment.alignment,
      gender: person.gender,
      available: availabilityOf(person, employment, date).status === 'available',
      age,
      rating,
      peakPop,
      worldPop,
      value,
      monthlyCost,
      pay,
      payAfter,
      marketMonthly: market,
      monthsLeft,
      endsOn,
      titleIds: titlesHeldBy(read, person.id),
      employment,
    };
  }
}
