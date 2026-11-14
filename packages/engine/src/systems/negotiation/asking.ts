/**
 * The asking-terms composer (ECO5-02): everything a worker asks one promotion for, each number
 * with its Why?. The Negotiation Sheet shows it (`contracts.askingTerms`), ECO5-03 weighs offers
 * against it and records it at `contracts.ask` when an offer is submitted.
 *
 * It reads the world and hands plain values to the formulas (`formulas/marketValue.ts`,
 * `askingWage.ts`, `askingFee.ts`, `startPatience.ts`):
 *
 * - popularity: the best country and the world value of the worker's regional popularity
 *   (WRK1's roll-up, untraced: the ask's trace names the two numbers instead of nesting a map);
 * - skill: the role rating in the role they would be hired for (their role with you on a renewal,
 *   else their main role);
 * - the promotion's reach (ECO1) and public image;
 * - the current-deal floor, only from a signed or active deal with this same promotion. A deal
 *   elsewhere is private (D-07): it only adds the under-contract premium.
 *
 * Design: docs/design/negotiation.md#asking-terms.
 */

import type { Reason } from '../../core/api/result';
import { ageInYears, type GameDate } from '../../core/date';
import type { EmploymentId, PersonId, PromotionId, RegionId } from '../../core/ids';
import { startCalc } from '../../core/trace/calc';
import { startDecision } from '../../core/trace/decision';
import type { Traced } from '../../core/trace/types';
import type {
  ContractKind,
  Employment,
  EmploymentRole,
  Push,
} from '../../model/entities/employment';
import type { Person } from '../../model/entities/person';
import type { Promotion } from '../../model/entities/promotion';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { reachOf } from '../finance/reach';
import type { EngineTunables } from '../tunables';
import { overallOf } from '../workers/formulas/roleRating';
import { expectedPushAt } from '../workers/helpers/expectedPushAt';
import { primaryEmploymentOf } from '../workers/helpers/employment';
import { mainRoleOf } from '../workers/helpers/roles';
import { createPopularityRoller, type PopularityRoller } from '../world/formulas/popularityRollup';
import { geographyOf, type Geography } from '../world/geography';
import { negotiationEligibility, type NegotiationEligibility } from './eligibility';
import { askingFee } from './formulas/askingFee';
import { askingWage } from './formulas/askingWage';
import { marketValue } from './formulas/marketValue';
import { exclusiveContractShortfall } from './formulas/reachGate';
import { ASKING_TERMS_DOC_REF, RENEWALS_DOC_REF, signedText, wholeText } from './formulas/shared';
import { startPatience } from './formulas/startPatience';
import {
  isTermEnforced,
  listAskModifiers,
  listOfferKinds,
  listPatienceModifiers,
  offerKind,
  type EnforceableTerm,
} from './registries';

export const REFUSES_RENEWAL_CODE = 'contracts.refusesRenewal';
export const REFUSES_RENEWAL_MESSAGE = "Won't renew while unhappy here";
export const ALREADY_WRITTEN_CODE = 'contracts.alreadyWritten';
export const ALREADY_WRITTEN_MESSAGE = 'Already on a written deal with you';

/** What to work out the ask for. */
export interface AskingTermsRequest {
  readonly personId: PersonId;
  readonly promotionId: PromotionId;
  readonly date: GameDate;
  /** The contract kind asked about. Left out: the current kind on a renewal, else the best kind. */
  readonly kind?: ContractKind | undefined;
  /** Left out: the current deal's on a renewal, else exclusive when written and allowed. */
  readonly exclusive?: boolean | undefined;
  /** The contract with this promotion being renewed. The caller checks it belongs to them. */
  readonly renewalOf?: EmploymentId | undefined;
}

/** A perk the worker insists on. Only perks the game honours are ever asked for. */
export interface AskedPerk {
  readonly term: EnforceableTerm;
  readonly label: string;
  /** Why they ask for it, in plain words. */
  readonly reason: string;
}

/** One contract kind and whether this promotion may offer it to this worker. */
export interface AllowedKind {
  readonly kind: ContractKind;
  readonly label: string;
  readonly allowed: boolean;
  /** Why not, when it is not allowed. */
  readonly reasons: Reason[];
}

/** Everything a worker asks one promotion for. Money in whole cents. */
export interface AskingTerms {
  readonly personId: PersonId;
  readonly promotionId: PromotionId;
  /** The role they would work in. */
  readonly role: EmploymentRole;
  /** The kind the ask is for. */
  readonly kind: ContractKind;
  readonly exclusive: boolean;
  /** The contract being renewed, or null for a signing. */
  readonly renewalOf: EmploymentId | null;
  readonly marketValue: Traced<number>;
  /**
   * The monthly wage they ask on a written deal. On a per-appearance deal it is only the base of
   * the fee.
   */
  readonly monthlyWage: Traced<number>;
  readonly perAppearanceFee: Traced<number>;
  readonly signingBonus: Traced<number>;
  readonly perks: AskedPerk[];
  /** The most appearances a year they agree to, or null for no cap. */
  readonly appearanceCap: Traced<number> | null;
  readonly preferredLengthMonths: Traced<number>;
  readonly expectedPush: Traced<Push>;
  /** Every registered offer kind, in order. */
  readonly allowedKinds: AllowedKind[];
  /** The first allowed kind, or null when none is. */
  readonly bestKind: ContractKind | null;
  readonly exclusiveAllowed: boolean;
  /** Why an exclusive deal may not be offered, else empty. */
  readonly exclusiveReasons: Reason[];
  readonly startPatience: Traced<number>;
  /** Why the worker will not negotiate at all (an unhappy renewal), or null. */
  readonly refusal: Reason | null;
  /** On a renewal, the decision whether they are willing to renew at all; else null. */
  readonly renewalDecision: Traced<boolean> | null;
}

/** What the composer reads once per promotion and date, so a list can share it across rows. */
export interface AskingContext {
  readonly read: GameWorldView;
  readonly tunables: EngineTunables;
  readonly promotion: DeepReadonly<Promotion>;
  readonly date: GameDate;
  readonly reach: number;
  readonly geography: Geography;
  readonly roller: PopularityRoller;
  /** The country of the promotion's home region. */
  readonly homeCountryId: string | null;
  /** Why this promotion may not offer exclusive deals, else empty. */
  readonly exclusiveReasons: Reason[];
}

/** Reads the promotion's side of every ask once. */
export function askingContext(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
  date: GameDate,
): AskingContext {
  const promotion = read.tables.promotions.require(promotionId);
  const geography = geographyOf(read);
  return {
    read,
    tunables,
    promotion,
    date,
    reach: reachOf(read, promotionId, tunables).reach.value,
    geography,
    roller: createPopularityRoller(geography),
    homeCountryId: countryIdOf(geography, promotion.homeRegionId),
    exclusiveReasons: exclusiveContractShortfall(read, promotionId, tunables),
  };
}

function countryIdOf(geography: Geography, regionId: RegionId): string | null {
  return geography.regions.some((region) => region.id === regionId)
    ? geography.countryOf(regionId).id
    : null;
}

function countryNameOf(geography: Geography, regionId: RegionId): string {
  return geography.regions.some((region) => region.id === regionId)
    ? geography.countryOf(regionId).name
    : 'another country';
}

/**
 * Peak (best country) and world popularity, untraced. The best country, not the best continent:
 * a continent is a population-weighted mean, so a star of Japan (56 there) reads 8 across Asia
 * and would be worth less than an American lower-carder.
 */
export function popularityOf(
  context: AskingContext,
  person: Person,
): { peak: number; world: number } {
  const values = context.roller.rollValues(person.regionalPop);
  return { peak: values.top?.value ?? 0, world: values.world };
}

type Row = DeepReadonly<Employment>;

function liveDealWith(context: AskingContext, personId: PersonId): Row | null {
  const deal = context.read.tables.employments
    .lookup('byPerson', personId)
    .find(
      (employment) =>
        employment.promotionId === context.promotion.id &&
        (employment.status === 'signed' || employment.status === 'active'),
    );
  return deal ?? null;
}

function roleFor(context: AskingContext, person: Person, deal: Row | null): EmploymentRole {
  if (deal !== null) {
    return deal.role;
  }
  return mainRoleOf(person, primaryEmploymentOf(context.read, person.id, context.date));
}

function allowedKindsFor(
  context: AskingContext,
  personId: PersonId,
  renewing: Row | null,
): AllowedKind[] {
  const kinds = listOfferKinds().map((spec) => {
    const reasons = spec.available(
      context.read,
      context.promotion.id,
      personId,
      context.date,
      context.tunables,
    );
    return { kind: spec.key, label: spec.label, allowed: reasons.length === 0, reasons };
  });
  const writtenAllowed = kinds.some((entry) => entry.kind === 'written' && entry.allowed);
  if (renewing?.terms.kind !== 'written' || !writtenAllowed) {
    return kinds;
  }
  return kinds.map((entry) =>
    entry.kind === 'written'
      ? entry
      : {
          ...entry,
          allowed: false,
          reasons: [
            ...entry.reasons,
            {
              code: ALREADY_WRITTEN_CODE,
              message: ALREADY_WRITTEN_MESSAGE,
              subject: { kind: 'employment', id: renewing.id },
            },
          ],
        },
  );
}

function signingBonus(
  monthly: Traced<number>,
  kind: ContractKind,
  tunables: EngineTunables,
): Traced<number> {
  if (kind === 'perAppearance') {
    return startCalc('Signing bonus', 0, {
      unit: 'money',
      docRef: ASKING_TERMS_DOC_REF,
      startLabel: 'Per-appearance deals have no signing bonus',
    }).done();
  }
  const calc = startCalc('Signing bonus', monthly, {
    unit: 'money',
    docRef: ASKING_TERMS_DOC_REF,
  });
  calc.multiply('Months of wage', calc.tunable(tunables, 'contracts.ask.signingBonusMonths'));
  return calc.round('round', 'To whole cents').done();
}

function perksFor(context: AskingContext, person: Person, age: number): AskedPerk[] {
  const perks: AskedPerk[] = [];
  const livesIn = countryIdOf(context.geography, person.basedInRegionId);
  if (
    isTermEnforced('perk.travelCovered') &&
    livesIn !== null &&
    context.homeCountryId !== null &&
    livesIn !== context.homeCountryId
  ) {
    perks.push({
      term: 'perk.travelCovered',
      label: 'Travel covered',
      reason: `Lives in ${countryNameOf(context.geography, person.basedInRegionId)}, outside your home country`,
    });
  }
  if (
    isTermEnforced('perk.noHouseShows') &&
    age >= context.tunables.get('contracts.ask.noHouseShowsAge')
  ) {
    perks.push({
      term: 'perk.noHouseShows',
      label: 'No house shows',
      reason: `Aged ${String(age)}: wants to skip house shows`,
    });
  }
  return perks;
}

function appearanceCapFor(
  context: AskingContext,
  age: number,
  peak: number,
): Traced<number> | null {
  const { tunables } = context;
  const cap = tunables.get('contracts.ask.veteranAppearanceCap');
  const veteran =
    age >= tunables.get('contracts.ask.veteranAge') &&
    peak >= tunables.get('contracts.ask.veteranPeakPop');
  if (!veteran || cap <= 0) {
    return null;
  }
  const calc = startCalc('Appearance cap', 0, {
    unit: 'count',
    docRef: ASKING_TERMS_DOC_REF,
    startLabel: 'No cap yet',
  });
  calc.branch(`A popular veteran (aged ${String(age)}, popularity ${wholeText(peak)})`, true);
  return calc
    .add(
      'Most appearances a year a popular veteran agrees to',
      calc.tunable(tunables, 'contracts.ask.veteranAppearanceCap'),
    )
    .done();
}

function preferredLength(person: Person, tunables: EngineTunables): Traced<number> {
  const calc = startCalc('Preferred length', 0, {
    unit: 'months',
    docRef: ASKING_TERMS_DOC_REF,
    startLabel: 'Nothing yet',
  });
  const journeyman = person.traits.includes('journeyman');
  const loyal = person.traits.includes('loyal');
  calc.branch('Journeyman', journeyman);
  calc.branch('Loyal', loyal);
  if (journeyman) {
    return calc
      .add(
        'A journeyman likes short deals',
        calc.tunable(tunables, 'contracts.ask.lengthMonths.journeyman'),
      )
      .done();
  }
  if (loyal) {
    return calc
      .add(
        'A loyal worker likes long deals',
        calc.tunable(tunables, 'contracts.ask.lengthMonths.loyal'),
      )
      .done();
  }
  return calc.add('Usual length', calc.tunable(tunables, 'contracts.ask.lengthMonths')).done();
}

function renewalDecisionFor(
  morale: number,
  tunables: EngineTunables,
): { decision: Traced<boolean>; refusal: Reason | null } {
  const decision = startDecision<boolean>('Willing to renew', { docRef: RENEWALS_DOC_REF });
  const refuseAt = decision.tunable(
    tunables,
    'contracts.renewal.refuseMorale',
    'Will not renew at or below this morale',
  );
  const refuses = morale <= refuseAt;
  decision.rule(`Morale ${signedText(morale)} is at or below ${signedText(refuseAt)}`, refuses);
  if (refuses) {
    return {
      decision: decision.choose(false, REFUSES_RENEWAL_MESSAGE),
      refusal: { code: REFUSES_RENEWAL_CODE, message: REFUSES_RENEWAL_MESSAGE },
    };
  }
  return {
    decision: decision.choose(
      true,
      `Morale ${signedText(morale)} is above ${signedText(refuseAt)}`,
    ),
    refusal: null,
  };
}

function nonNull<T>(value: T | null): value is T {
  return value !== null;
}

/** What every ask for one worker starts from: who they are, what they are worth, what you may offer. */
export interface AskBasis {
  readonly person: Person;
  readonly role: EmploymentRole;
  readonly peak: number;
  readonly world: number;
  readonly age: number;
  /** Their signed or active deal with this promotion, or null. */
  readonly deal: Row | null;
  /** The contract being renewed, or null. */
  readonly renewing: Row | null;
  readonly underContractElsewhere: boolean;
  readonly marketValue: Traced<number>;
  readonly allowedKinds: AllowedKind[];
  readonly bestKind: ContractKind | null;
}

/** The parts of an ask that do not depend on the contract kind. */
export function askBasisWith(
  context: AskingContext,
  person: Person,
  renewalOf: EmploymentId | undefined,
  eligibility: NegotiationEligibility,
): AskBasis {
  const { read, tunables, date } = context;
  const deal = liveDealWith(context, person.id);
  const renewing = renewalOf === undefined ? null : read.tables.employments.require(renewalOf);
  const role = roleFor(context, person, renewing ?? deal);
  const { peak, world } = popularityOf(context, person);
  const allowedKinds = allowedKindsFor(context, person.id, renewing);
  const value = marketValue(
    {
      peakPop: peak,
      worldPop: world,
      roleRating: overallOf(person, role, { tunables }).value,
      role,
      starMerchMonthly: null,
    },
    { tunables },
  );
  return {
    person,
    role,
    peak,
    world,
    age: ageInYears(person.birthDate, date),
    deal,
    renewing,
    underContractElsewhere: eligibility.otherPromotionIds.length > 0,
    marketValue: value,
    allowedKinds,
    bestKind: allowedKinds.find((entry) => entry.allowed)?.kind ?? null,
  };
}

/** The monthly wage and the per-appearance fee asked for one contract kind. */
export function askedPay(
  context: AskingContext,
  basis: AskBasis,
  kind: ContractKind,
  exclusive: boolean,
): { monthlyWage: Traced<number>; perAppearanceFee: Traced<number> } {
  const { read, tunables, promotion, date } = context;
  const { person, deal, renewing } = basis;
  const modifiers = listAskModifiers()
    .map((modifier) => modifier.compute(read, person.id, promotion.id, date, tunables))
    .filter(nonNull);
  const kindMultiplier = offerKind(kind)?.askMultiplier?.(read, promotion.id, person.id, tunables);
  if (kindMultiplier !== undefined) {
    modifiers.push(kindMultiplier);
  }
  const monthlyWage = askingWage(
    {
      marketValue: basis.marketValue,
      reach: context.reach,
      prestige: promotion.prestige,
      motivation: person.motivation,
      traits: person.traits,
      charisma: person.attributes.charisma,
      presence: person.attributes.presence,
      role: basis.role,
      exclusive,
      underContractElsewhere: basis.underContractElsewhere,
      renewal:
        renewing === null
          ? null
          : { morale: renewing.morale, loyalToYou: person.traits.includes('loyal') },
      modifiers,
      currentDealFloor:
        deal !== null && deal.terms.kind !== 'perAppearance' ? deal.terms.monthlyWage : null,
    },
    { tunables },
  );
  const perAppearanceFee = askingFee(
    {
      monthlyAsk: monthlyWage,
      currentFeeFloor:
        deal !== null && deal.terms.kind === 'perAppearance' ? deal.terms.perAppearanceFee : null,
    },
    { tunables },
  );
  return { monthlyWage, perAppearanceFee };
}

/** The kind and exclusivity an ask is for when the request leaves them out. */
export function askedKind(
  context: AskingContext,
  basis: AskBasis,
  request: { readonly kind?: ContractKind | undefined; readonly exclusive?: boolean | undefined },
): { kind: ContractKind; exclusive: boolean } {
  const kind = request.kind ?? basis.renewing?.terms.kind ?? basis.bestKind ?? 'perAppearance';
  const exclusive =
    request.exclusive ??
    basis.renewing?.terms.exclusive ??
    (kind === 'written' && context.exclusiveReasons.length === 0);
  return { kind, exclusive };
}

/**
 * The full ask with a shared context and the worker's eligibility already known (the queries work
 * these out once).
 */
export function askingTermsWith(
  context: AskingContext,
  request: Omit<AskingTermsRequest, 'promotionId' | 'date'>,
  eligibility: NegotiationEligibility,
): AskingTerms {
  const { read, tunables, promotion, date } = context;
  const person = read.tables.people.require(request.personId);
  const basis = askBasisWith(context, person, request.renewalOf, eligibility);
  const { renewing } = basis;
  const { kind, exclusive } = askedKind(context, basis, request);
  const { monthlyWage, perAppearanceFee } = askedPay(context, basis, kind, exclusive);
  const patienceModifiers = listPatienceModifiers()
    .map((modifier) => modifier.compute(read, person.id, promotion.id, date, tunables))
    .filter(nonNull);
  const renewalCheck = renewing === null ? null : renewalDecisionFor(renewing.morale, tunables);

  return {
    personId: person.id,
    promotionId: promotion.id,
    role: basis.role,
    kind,
    exclusive,
    renewalOf: renewing?.id ?? null,
    marketValue: basis.marketValue,
    monthlyWage,
    perAppearanceFee,
    signingBonus: signingBonus(monthlyWage, kind, tunables),
    perks: perksFor(context, person, basis.age),
    appearanceCap: appearanceCapFor(context, basis.age, basis.peak),
    preferredLengthMonths: preferredLength(person, tunables),
    expectedPush: expectedPushAt(read, person.id, promotion.id, tunables),
    allowedKinds: basis.allowedKinds,
    bestKind: basis.bestKind,
    exclusiveAllowed: context.exclusiveReasons.length === 0,
    exclusiveReasons: context.exclusiveReasons,
    startPatience: startPatience(
      {
        traits: person.traits,
        renewalMorale: renewing?.morale ?? null,
        modifiers: patienceModifiers,
      },
      { tunables },
    ),
    refusal: renewalCheck?.refusal ?? null,
    renewalDecision: renewalCheck?.decision ?? null,
  };
}

/** Everything `personId` asks `promotionId` for on `date`. */
export function askingTermsFor(
  read: GameWorldView,
  tunables: EngineTunables,
  request: AskingTermsRequest,
): AskingTerms {
  const context = askingContext(read, tunables, request.promotionId, request.date);
  const eligibility = negotiationEligibility(
    read,
    tunables,
    request.personId,
    request.promotionId,
    request.date,
  );
  return askingTermsWith(context, request, eligibility);
}
