/**
 * The negotiation system's queries (ECO5-02), the engine half of the Negotiation Sheet and the
 * Free agents tab.
 *
 * - `contracts.askingTerms { promotionId, personId, kind?, exclusive?, renewalOf? }`: everything a
 *   worker asks one of the viewer's promotions for, each number with its Why? inline (a query
 *   cannot record traces), plus who may be approached and from when.
 * - `contracts.freeAgents { promotionId, role?, gender?, situation?, search? }`: the workers the
 *   promotion may approach, with their ask as plain numbers (the Why? loads `contracts.askingTerms`
 *   for one row), sorted by market value, highest first.
 *
 * Both only ever answer for the viewer's own promotions (the omniscient viewer runs none, so it is
 * refused too). A rival's contract leaves nothing but its public facts: who it is with and when it
 * ends. Never its wage, a worker's morale there or hidden development (D-07).
 *
 * Design: docs/design/negotiation.md#asking-terms and #free-agents.
 */

import { z } from 'zod';
import { viewerPromotionIds } from '../../core/api/controller';
import { defineQuery, type QueryContext } from '../../core/api/query';
import { INVALID_ARGS, refuseQuery } from '../../core/api/result';
import { ageInYears, compareDates, type GameDate } from '../../core/date';
import type { EmploymentId, NegotiationId, PersonId, PromotionId } from '../../core/ids';
import {
  ContractKindSchema,
  EmploymentRoleSchema,
  type ContractKind,
  type EmploymentRole,
} from '../../model/entities/employment';
import { isOpenNegotiationStatus, personPromotionKey } from '../../model/entities/negotiation';
import {
  GenderSchema,
  type Gender,
  type Person,
  type PersonRole,
  type RingStyle,
} from '../../model/entities/person';
import type { Reaction } from '../../model/entities/negotiation';
import type { ImageRef } from '../../model/primitives';
import { zId } from '../../model/primitives';
import { compareIds } from '../../model/table';
import { gradeOf, type Grade } from '../workers/formulas/grade';
import { overallOf } from '../workers/formulas/roleRating';
import { primaryEmploymentOf } from '../workers/helpers/employment';
import { ratingRoleOfPersonRole } from '../workers/helpers/roles';
import type { TraceNode } from '../../core/trace/types';
import { askBasisWith, askedPay, askingContext, askingTermsWith, type AskingTerms } from './asking';
import { evaluateOffer, type OfferEvaluation } from './evaluate';
import { notEnforcedLine } from './formulas/contractValue';
import { OfferSchema, type Offer } from './offer';
import { ENFORCEABLE_TERMS, isTermEnforced } from './registries';
import {
  negotiationEligibility,
  OPEN_TO_OFFERS,
  type NegotiationEligibility,
  type NegotiationSituation,
} from './eligibility';

export const NOT_YOUR_PROMOTION_MESSAGE = 'Choose one of your own promotions';
export const NOT_YOUR_CONTRACT_MESSAGE = 'That is not one of your contracts with this worker';
export const UNKNOWN_PERSON_MESSAGE = 'That worker no longer exists';

/** `contracts.askingTerms`: the ask and who may be approached. */
export interface AskingTermsView extends AskingTerms {
  readonly eligibility: NegotiationEligibility;
}

/** One row of `contracts.freeAgents`. Money in whole cents. */
export interface FreeAgentRow {
  readonly personId: PersonId;
  readonly ringName: string;
  readonly imageRef: ImageRef;
  readonly roles: PersonRole[];
  readonly age: number;
  readonly gender: Gender;
  readonly style: RingStyle;
  /** Popularity in their best country, 0-100. */
  readonly peakPop: number;
  /** Rating in the role they would be hired for, 0-100. */
  readonly rating: number;
  readonly grade: Grade;
  readonly situation: NegotiationSituation;
  /** The promotion they work for now (public), or null. */
  readonly otherPromotionName: string | null;
  /** When that deal ends (public), or null. */
  readonly endsOn: GameDate | null;
  /** The monthly wage they ask on a written deal, or null when you may not offer one. */
  readonly askMonthly: number | null;
  /** The fee they ask per appearance, or null when you may not offer that kind. */
  readonly askPerAppearance: number | null;
  /** The first contract kind you may offer, or null. */
  readonly bestKind: ContractKind | null;
  /** The day they talk to you again after walking away, or null. */
  readonly cooldownUntil: GameDate | null;
  /** Your open negotiation with them, or null. */
  readonly openNegotiationId: NegotiationId | null;
  /** Other promotions talking to them now, by name only (never their terms). */
  readonly competingBidders: string[];
}

export type FreeAgentsSituationFilter = 'freeAgent' | 'all';

/** The meter's band on the Negotiation Sheet. */
export type OfferBand = 'likely' | 'counter' | 'reject' | 'walkAway' | 'refuse';

export const OFFER_BANDS: Readonly<Record<Reaction, { band: OfferBand; label: string }>> = {
  accept: { band: 'likely', label: 'Likely to accept' },
  counter: { band: 'counter', label: 'Will counter' },
  reject: { band: 'reject', label: 'Will reject' },
  walkAway: { band: 'walkAway', label: 'Will walk away' },
  refuse: { band: 'refuse', label: "Won't sign" },
};

export const PART_OF_THE_WAY_NOTE = 'They will meet you part of the way';
export const LIKELY_NOTE = 'They think it over for a short while before signing';
export const REJECT_NOTE = 'A rejection uses up some of their patience';
export const WALK_AWAY_NOTE = "Talks would end, and they won't talk to you again for a while";
export const UNKNOWN_NEGOTIATION_MESSAGE = 'Those are not your open talks with this worker';

/** `contracts.offerPreview`: how the worker would react to an offer, without rolling anything. */
export interface OfferPreview {
  /** Contract value of the offer, cents a month. */
  readonly offerValue: number;
  /** Contract value of their ask, cents a month. */
  readonly askValue: number;
  /** The offer's value as a share of the ask's. */
  readonly ratio: number;
  readonly reaction: Reaction;
  readonly band: OfferBand;
  readonly label: string;
  /** Patience after this reaction. */
  readonly patienceLeft: number;
  /** The patience the worker started (or would start) these talks with. */
  readonly startPatience: number;
  readonly reactionTrace: TraceNode;
  readonly valueTrace: TraceNode;
  readonly askValueTrace: TraceNode;
  /** Plain lines the sheet shows under the meter. */
  readonly notes: string[];
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'contracts.askingTerms': {
      args: {
        promotionId: PromotionId;
        personId: PersonId;
        kind?: ContractKind | undefined;
        exclusive?: boolean | undefined;
        renewalOf?: EmploymentId | undefined;
      };
      result: AskingTermsView;
    };
    'contracts.offerPreview': {
      args: {
        promotionId: PromotionId;
        personId: PersonId;
        offer: Offer;
        negotiationId?: NegotiationId | undefined;
        renewalOf?: EmploymentId | undefined;
      };
      result: OfferPreview;
    };
    'contracts.freeAgents': {
      args: {
        promotionId: PromotionId;
        role?: EmploymentRole | undefined;
        gender?: Gender | undefined;
        situation?: FreeAgentsSituationFilter | undefined;
        search?: string | undefined;
      };
      result: FreeAgentRow[];
    };
  }
}

function ownPromotionOrRefuse(ctx: QueryContext, promotionId: PromotionId): void {
  if (!viewerPromotionIds(ctx.read, ctx.viewer).includes(promotionId)) {
    refuseQuery({ code: INVALID_ARGS, message: NOT_YOUR_PROMOTION_MESSAGE, field: 'promotionId' });
  }
}

export const askingTermsQuery = defineQuery('contracts.askingTerms', {
  args: z.strictObject({
    promotionId: zId('promotion'),
    personId: zId('person'),
    kind: ContractKindSchema.optional(),
    exclusive: z.boolean().optional(),
    renewalOf: zId('employment').optional(),
  }),
  run: (ctx, args): AskingTermsView => {
    ownPromotionOrRefuse(ctx, args.promotionId);
    if (ctx.read.tables.people.get(args.personId) === undefined) {
      refuseQuery({ code: INVALID_ARGS, message: UNKNOWN_PERSON_MESSAGE, field: 'personId' });
    }
    if (args.renewalOf !== undefined) {
      const contract = ctx.read.tables.employments.get(args.renewalOf);
      const renewable =
        contract?.promotionId === args.promotionId &&
        contract.personId === args.personId &&
        (contract.status === 'signed' || contract.status === 'active');
      if (!renewable) {
        refuseQuery({ code: INVALID_ARGS, message: NOT_YOUR_CONTRACT_MESSAGE, field: 'renewalOf' });
      }
    }
    const context = askingContext(ctx.read, ctx.tunables, args.promotionId, ctx.date);
    const eligibility = negotiationEligibility(
      ctx.read,
      ctx.tunables,
      args.personId,
      args.promotionId,
      ctx.date,
    );
    return { ...askingTermsWith(context, args, eligibility), eligibility };
  },
});

const PERK_WORDS = {
  'perk.ironClad': 'Iron-clad',
  'perk.travelCovered': 'Travel covered',
  'perk.noHouseShows': 'No house shows',
  'perk.creativeControl': 'Creative control',
  'share.gateBp': 'Share of the gate',
  'share.merchBp': 'Share of merch',
  'share.broadcastBp': 'Share of TV money',
} as const;

function termIsSet(offer: Offer, term: (typeof ENFORCEABLE_TERMS)[number]): boolean {
  switch (term) {
    case 'perk.ironClad':
      return offer.terms.perks.ironClad;
    case 'perk.travelCovered':
      return offer.terms.perks.travelCovered;
    case 'perk.noHouseShows':
      return offer.terms.perks.noHouseShows;
    case 'perk.creativeControl':
      return offer.terms.perks.creativeControl;
    case 'share.gateBp':
      return offer.terms.shares.gateBp > 0;
    case 'share.merchBp':
      return offer.terms.shares.merchBp > 0;
    case 'share.broadcastBp':
      return offer.terms.shares.broadcastBp > 0;
  }
}

function previewNotes(offer: Offer, evaluation: OfferEvaluation): string[] {
  const notes: string[] = [];
  const { ask } = evaluation;
  if (evaluation.refusal !== null) {
    notes.push(evaluation.refusal.message);
  }
  if (evaluation.roleMismatch !== null) {
    notes.push(evaluation.roleMismatch);
  }
  const kind = ask.allowedKinds.find((entry) => entry.kind === offer.terms.kind);
  for (const reason of kind?.reasons ?? []) {
    notes.push(reason.message);
  }
  if (offer.terms.exclusive) {
    for (const reason of ask.exclusiveReasons) {
      notes.push(reason.message);
    }
  }
  for (const term of ENFORCEABLE_TERMS) {
    if (termIsSet(offer, term) && !isTermEnforced(term)) {
      notes.push(notEnforcedLine(PERK_WORDS[term]));
    }
  }
  switch (evaluation.reaction.value) {
    case 'accept':
      notes.push(LIKELY_NOTE);
      break;
    case 'counter':
      notes.push(PART_OF_THE_WAY_NOTE);
      break;
    case 'reject':
      notes.push(REJECT_NOTE);
      break;
    case 'walkAway':
      notes.push(WALK_AWAY_NOTE);
      break;
    case 'refuse':
      break;
  }
  return notes;
}

export const offerPreviewQuery = defineQuery('contracts.offerPreview', {
  args: z.strictObject({
    promotionId: zId('promotion'),
    personId: zId('person'),
    offer: OfferSchema,
    negotiationId: zId('negotiation').optional(),
    renewalOf: zId('employment').optional(),
  }),
  run: (ctx, args): OfferPreview => {
    ownPromotionOrRefuse(ctx, args.promotionId);
    if (ctx.read.tables.people.get(args.personId) === undefined) {
      refuseQuery({ code: INVALID_ARGS, message: UNKNOWN_PERSON_MESSAGE, field: 'personId' });
    }
    const negotiation =
      args.negotiationId === undefined
        ? null
        : (ctx.read.tables.negotiations.get(args.negotiationId) ?? null);
    if (
      args.negotiationId !== undefined &&
      (negotiation === null ||
        negotiation.personId !== args.personId ||
        negotiation.promotionId !== args.promotionId ||
        !isOpenNegotiationStatus(negotiation.status))
    ) {
      refuseQuery({
        code: INVALID_ARGS,
        message: UNKNOWN_NEGOTIATION_MESSAGE,
        field: 'negotiationId',
      });
    }
    if (args.renewalOf !== undefined) {
      const contract = ctx.read.tables.employments.get(args.renewalOf);
      const renewable =
        contract?.promotionId === args.promotionId &&
        contract.personId === args.personId &&
        (contract.status === 'signed' || contract.status === 'active');
      if (!renewable) {
        refuseQuery({ code: INVALID_ARGS, message: NOT_YOUR_CONTRACT_MESSAGE, field: 'renewalOf' });
      }
    }
    const evaluation = evaluateOffer(ctx.read, ctx.tunables, {
      promotionId: args.promotionId,
      personId: args.personId,
      offer: args.offer,
      negotiation,
      date: ctx.date,
      renewalOf: args.renewalOf,
    });
    const { band, label } = OFFER_BANDS[evaluation.reaction.value];
    return {
      offerValue: evaluation.offerValue.value,
      askValue: evaluation.askValue.value,
      ratio: evaluation.ratio,
      reaction: evaluation.reaction.value,
      band,
      label,
      patienceLeft: evaluation.patienceLeft,
      startPatience: negotiation?.startPatience ?? evaluation.ask.startPatience.value,
      reactionTrace: evaluation.reaction.trace,
      valueTrace: evaluation.offerValue.trace,
      askValueTrace: evaluation.askValue.trace,
      notes: previewNotes(args.offer, evaluation),
    };
  },
});

function matchesSearch(person: Person, ringName: string, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === '') {
    return true;
  }
  return [ringName, person.defaultRingName, `${person.givenName} ${person.familyName}`].some(
    (name) => name.toLowerCase().includes(needle),
  );
}

function holdsRole(person: Person, role: EmploymentRole): boolean {
  return person.roles.some((held) => ratingRoleOfPersonRole(held) === role);
}

export const freeAgentsQuery = defineQuery('contracts.freeAgents', {
  args: z.strictObject({
    promotionId: zId('promotion'),
    role: EmploymentRoleSchema.optional(),
    gender: GenderSchema.optional(),
    situation: z.enum(['freeAgent', 'all']).optional(),
    search: z.string().max(60).optional(),
  }),
  run: (ctx, args): FreeAgentRow[] => {
    ownPromotionOrRefuse(ctx, args.promotionId);
    const { read, tunables, date } = ctx;
    const context = askingContext(read, tunables, args.promotionId, date);
    const situations: readonly NegotiationSituation[] =
      args.situation === 'freeAgent' ? ['freeAgent'] : OPEN_TO_OFFERS;

    const rows: { row: FreeAgentRow; value: number }[] = [];
    for (const person of read.tables.people.values()) {
      if (args.gender !== undefined && person.gender !== args.gender) {
        continue;
      }
      if (args.role !== undefined && !holdsRole(person, args.role)) {
        continue;
      }
      const primary = primaryEmploymentOf(read, person.id, date);
      const ringName = primary?.ringName ?? person.defaultRingName;
      if (args.search !== undefined && !matchesSearch(person, ringName, args.search)) {
        continue;
      }
      const eligibility = negotiationEligibility(read, tunables, person.id, args.promotionId, date);
      if (!situations.includes(eligibility.situation)) {
        continue;
      }
      const basis = askBasisWith(context, person, undefined, eligibility);
      const allowed = (kind: ContractKind): boolean =>
        basis.allowedKinds.some((entry) => entry.kind === kind && entry.allowed);
      const elsewhere = read.tables.employments
        .lookup('byPerson', person.id)
        .filter(
          (employment) =>
            employment.promotionId !== args.promotionId &&
            (employment.status === 'signed' || employment.status === 'active'),
        )
        .sort((left, right) => Number(right.terms.exclusive) - Number(left.terms.exclusive));
      const [other] = elsewhere;
      const negotiations = read.tables.negotiations.lookup('byPerson', person.id);
      const mine = read.tables.negotiations.lookup(
        'byPersonPromotion',
        personPromotionKey(person.id, args.promotionId),
      );
      let cooldownUntil: GameDate | null = null;
      for (const negotiation of mine) {
        const until = negotiation.cooldownUntil;
        if (
          until !== null &&
          compareDates(until, date) > 0 &&
          (cooldownUntil === null || compareDates(until, cooldownUntil) > 0)
        ) {
          cooldownUntil = until;
        }
      }
      const bidders = negotiations
        .filter(
          (negotiation) =>
            negotiation.promotionId !== args.promotionId &&
            isOpenNegotiationStatus(negotiation.status),
        )
        .map((negotiation) => read.tables.promotions.get(negotiation.promotionId)?.name ?? '')
        .filter((name) => name !== '');
      const rating = overallOf(person, basis.role, { tunables }).value;
      rows.push({
        value: basis.marketValue.value,
        row: {
          personId: person.id,
          ringName,
          imageRef: person.imageRef,
          roles: [...person.roles],
          age: ageInYears(person.birthDate, date),
          gender: person.gender,
          style: person.style,
          peakPop: basis.peak,
          rating,
          grade: gradeOf(rating).grade,
          situation: eligibility.situation,
          otherPromotionName:
            other === undefined
              ? null
              : (read.tables.promotions.get(other.promotionId)?.name ?? null),
          endsOn: other?.endsOn ?? null,
          askMonthly: allowed('written')
            ? askedPay(context, basis, 'written', context.exclusiveReasons.length === 0).monthlyWage
                .value
            : null,
          askPerAppearance: allowed('perAppearance')
            ? askedPay(context, basis, 'perAppearance', false).perAppearanceFee.value
            : null,
          bestKind: basis.bestKind,
          cooldownUntil,
          openNegotiationId:
            mine.find((negotiation) => isOpenNegotiationStatus(negotiation.status))?.id ?? null,
          competingBidders: [...new Set(bidders)].sort(),
        },
      });
    }
    return rows
      .sort(
        (left, right) =>
          right.value - left.value || compareIds(left.row.personId, right.row.personId),
      )
      .map((entry) => entry.row);
  },
});

export const negotiationQueries = [askingTermsQuery, freeAgentsQuery, offerPreviewQuery];
