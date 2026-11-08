/**
 * Organisation records: promotions, brands, titles, venues, networks, TV deals and event
 * definitions.
 *
 * Field names follow the engine entities (FND-07, FND-08, FND-09) with each `<thing>Id` written as
 * `<thing>Key`. Differences from the entities, all filled in by the loader (WLD-02):
 *
 * - Money is in whole currency units; the loader converts to cents.
 * - No `controller` field anywhere: who runs a promotion or brand is a new-game choice, not content.
 *   The loader writes a computer controller on every promotion and a null controller on every
 *   brand, and new-game setup (WLD-10) hands the player's promotion to the human.
 * - Optional fields with an obvious default (no image, no closing date, no preferred venue) may be
 *   left out. `docs/design/data-packs.md` lists every default.
 * - Cards are built from segment slots (design decision D-10), so no record has a length or a
 *   running time. A `lengthMinutes` field is an unknown key and fails.
 */

import { z } from 'zod';
import { zWeekday } from '../../../core/date';
import { DealTimeslotSchema } from '../../../model/entities/deal';
import { isOpenOrOnOrAfter, isPresentIff } from '../../../model/entities/entity-refinements';
import {
  RecurrenceSchema,
  ShowFormatSchema,
  zEventImportance,
} from '../../../model/entities/event-definition';
import {
  NETWORK_REACH_TIER_MAX,
  NetworkKindSchema,
  NetworkStatusSchema,
} from '../../../model/entities/network';
import {
  PoliciesSchema,
  ProductionSchema,
  PromotionStatusSchema,
  SHORT_NAME_PATTERN,
} from '../../../model/entities/promotion';
import { PromotionStyleSchema } from '../../../model/entities/promotion-style';
import {
  TITLE_HOLDER_COUNTS,
  TITLE_STATUSES,
  TitleDivisionSchema,
} from '../../../model/entities/title';
import { VENUE_CAPACITY_MAX, VenueKindSchema } from '../../../model/entities/venue';
import { compareDates } from '../../../core/date';
import { zImageRef, zNonNegativeInt } from '../../../model/primitives';
import {
  defineRecordKind,
  hexColorSchema,
  isoDateSchema,
  nonNegativeWholeMoneySchema,
  percentSchema,
  regionalPopSchema,
  wholeMoneySchema,
} from '../fields';
import { keySchema, parseRef, refListSchema, refSchema, type RecordReference } from '../keys';

// ---------------------------------------------------------------------------------------------
// Promotions and brands

export const promotionRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    name: z.string().min(1).max(60),
    /** Two to eight uppercase letters or digits. */
    shortName: z.string().regex(SHORT_NAME_PATTERN, 'Expected 2-8 uppercase letters or digits'),
    /** Null or left out = a generated placeholder logo. */
    logoRef: zImageRef.optional(),
    foundedOn: isoDateSchema,
    status: PromotionStatusSchema,
    homeRegionKey: refSchema,
    /** Popularity per region, 1-100; regions left out are 0. */
    regionalPop: regionalPopSchema,
    prestige: percentSchema,
    /** Whole currency units; may be negative (in debt). */
    cash: wholeMoneySchema,
    style: PromotionStyleSchema,
    ownerPersonKey: refSchema.nullable().optional(),
    bookerPersonKey: refSchema.nullable().optional(),
    /** The parent of a developmental promotion. */
    parentPromotionKey: refSchema.nullable().optional(),
    /** A level of 0-10 for every production area. */
    production: ProductionSchema,
    /** A tier of 0-3 for every staff policy area. */
    policies: PoliciesSchema,
    color: hexColorSchema,
  }),
  (promotion, context) => {
    const parentKey = promotion.parentPromotionKey;
    if (
      parentKey !== undefined &&
      parentKey !== null &&
      parseRef(parentKey).key === promotion.key
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A promotion cannot be its own parent',
        path: ['parentPromotionKey'],
      });
    }
  },
);

export const brandRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    promotionKey: refSchema,
    name: z.string().min(1).max(40),
    logoRef: zImageRef.optional(),
    /** Display and booking order inside the promotion; 0 = flagship. */
    priority: zNonNegativeInt,
    active: z.boolean(),
  }),
);

// ---------------------------------------------------------------------------------------------
// Titles and venues

export const titleRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    promotionKey: refSchema,
    /** Left out or null = a promotion-wide title. */
    brandKey: refSchema.nullable().optional(),
    name: z.string().min(1).max(60),
    holderCount: z.literal(TITLE_HOLDER_COUNTS),
    division: TitleDivisionSchema,
    prestige: percentSchema,
    status: z.enum(TITLE_STATUSES),
    introducedOn: isoDateSchema,
    /** Required exactly when the status is `retired`. */
    retiredOn: isoDateSchema.nullable().optional(),
    imageRef: zImageRef.optional(),
    color: hexColorSchema,
  }),
  (title, context) => {
    const retiredOn = title.retiredOn ?? null;
    if (!isPresentIff(retiredOn, title.status === 'retired')) {
      context.addIssue({
        code: 'custom',
        message: 'retiredOn is set exactly when status is retired',
        path: ['retiredOn'],
      });
    }
    if (!isOpenOrOnOrAfter(retiredOn, title.introducedOn)) {
      context.addIssue({
        code: 'custom',
        message: 'retiredOn must not be before introducedOn',
        path: ['retiredOn'],
      });
    }
  },
);

export const venueRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    regionKey: refSchema,
    name: z.string().min(1).max(80),
    capacity: z.number().int().min(1).max(VENUE_CAPACITY_MAX),
    kind: VenueKindSchema,
    openedOn: isoDateSchema.nullable().optional(),
    closedOn: isoDateSchema.nullable().optional(),
    /** The only promotion allowed to book the venue; left out or null = anyone. */
    exclusivePromotionKey: refSchema.nullable().optional(),
    imageRef: zImageRef.optional(),
  }),
  (venue, context) => {
    const { openedOn, closedOn } = venue;
    if (
      openedOn !== undefined &&
      openedOn !== null &&
      closedOn !== undefined &&
      closedOn !== null &&
      compareDates(closedOn, openedOn) <= 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'closedOn must be after openedOn',
        path: ['closedOn'],
      });
    }
  },
);

// ---------------------------------------------------------------------------------------------
// Networks and deals

export const networkCoverageSchema = z
  .strictObject({
    continentKeys: refListSchema,
    countryKeys: refListSchema,
    regionKeys: refListSchema,
  })
  .refine(
    (coverage) =>
      coverage.continentKeys.length + coverage.countryKeys.length + coverage.regionKeys.length > 0,
    { message: 'A network must cover at least one continent, country or region' },
  );

export const networkRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    name: z.string().min(1).max(60),
    kind: NetworkKindSchema,
    reachTier: z.number().int().min(0).max(NETWORK_REACH_TIER_MAX),
    coverage: networkCoverageSchema,
    /** The promotion that owns the network; left out or null = independent. */
    ownerPromotionKey: refSchema.nullable().optional(),
    /** Left out = `active`. */
    status: NetworkStatusSchema.optional(),
    launchedOn: isoDateSchema,
    closedOn: isoDateSchema.nullable().optional(),
    logoRef: zImageRef.optional(),
  }),
  (network, context) => {
    const closedOn = network.closedOn ?? null;
    if (closedOn !== null && compareDates(closedOn, network.launchedOn) <= 0) {
      context.addIssue({
        code: 'custom',
        message: 'closedOn must be after launchedOn',
        path: ['closedOn'],
      });
    }
  },
);

/** Deal money, in whole currency units. */
export const dealTermsSchema = z.strictObject({
  /** Paid by the network for each show aired. */
  feePerShow: nonNegativeWholeMoneySchema,
  /** Paid by the network per thousand viewers of each show. */
  perThousandViewers: nonNegativeWholeMoneySchema,
  /** Charged to the promotion for each show aired. */
  costPerShow: nonNegativeWholeMoneySchema,
});

/** A deal running when the world starts. The loader stores it as `active`, offered on `startsOn`. */
export const dealRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    promotionKey: refSchema,
    networkKey: refSchema,
    /** The show the deal airs; left out or null = every televised show of the promotion. */
    eventDefinitionKey: refSchema.nullable().optional(),
    startsOn: isoDateSchema,
    /** The first day the deal no longer runs. */
    endsOn: isoDateSchema,
    timeslot: DealTimeslotSchema,
    /** 0 = Monday ... 6 = Sunday, or null when the show is not tied to a weekday. */
    weekday: zWeekday.nullable(),
    live: z.boolean(),
    terms: dealTermsSchema,
  }),
  (deal, context) => {
    if (compareDates(deal.endsOn, deal.startsOn) <= 0) {
      context.addIssue({
        code: 'custom',
        message: 'endsOn must be after startsOn',
        path: ['endsOn'],
      });
    }
  },
);

// ---------------------------------------------------------------------------------------------
// Event definitions

export const eventDefinitionRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    promotionKey: refSchema,
    /** Left out or null = a promotion-wide (supershow) event. */
    brandKey: refSchema.nullable().optional(),
    name: z.string().min(1).max(60),
    importance: zEventImportance,
    /**
     * The engine's own recurrence schema (weekly, everyNWeeks, monthly, annual or dates), so a pack
     * can never describe a schedule the engine cannot run.
     */
    recurrence: RecurrenceSchema,
    /** Main-card slots (3-12) and pre-show slots (0-3). There is no length field. */
    format: ShowFormatSchema,
    televised: z.boolean(),
    preferredRegionKey: refSchema.nullable().optional(),
    preferredVenueKey: refSchema.nullable().optional(),
    activeFrom: isoDateSchema,
    activeUntil: isoDateSchema.nullable().optional(),
    logoRef: zImageRef.optional(),
  }),
  (definition, context) => {
    if (!isOpenOrOnOrAfter(definition.activeUntil ?? null, definition.activeFrom)) {
      context.addIssue({
        code: 'custom',
        message: 'activeUntil must not be before activeFrom',
        path: ['activeUntil'],
      });
    }
  },
);

export type PromotionRecord = z.output<typeof promotionRecord.full>;
export type BrandRecord = z.output<typeof brandRecord.full>;
export type TitleRecord = z.output<typeof titleRecord.full>;
export type VenueRecord = z.output<typeof venueRecord.full>;
export type NetworkCoverageRecord = z.output<typeof networkCoverageSchema>;
export type NetworkRecord = z.output<typeof networkRecord.full>;
export type DealTermsRecord = z.output<typeof dealTermsSchema>;
export type DealRecord = z.output<typeof dealRecord.full>;
export type EventDefinitionRecord = z.output<typeof eventDefinitionRecord.full>;

// ---------------------------------------------------------------------------------------------
// Reference fields, checked by the loader (WLD-02)

export const promotionReferences = [
  { path: ['homeRegionKey'], target: 'region' },
  { path: ['regionalPop', '{}'], target: 'region' },
  { path: ['ownerPersonKey'], target: 'person' },
  { path: ['bookerPersonKey'], target: 'person' },
  { path: ['parentPromotionKey'], target: 'promotion' },
] as const satisfies readonly RecordReference[];

export const brandReferences = [
  { path: ['promotionKey'], target: 'promotion' },
] as const satisfies readonly RecordReference[];

export const titleReferences = [
  { path: ['promotionKey'], target: 'promotion' },
  { path: ['brandKey'], target: 'brand' },
] as const satisfies readonly RecordReference[];

export const venueReferences = [
  { path: ['regionKey'], target: 'region' },
  { path: ['exclusivePromotionKey'], target: 'promotion' },
] as const satisfies readonly RecordReference[];

export const networkReferences = [
  { path: ['coverage', 'continentKeys', '[]'], target: 'continent' },
  { path: ['coverage', 'countryKeys', '[]'], target: 'country' },
  { path: ['coverage', 'regionKeys', '[]'], target: 'region' },
  { path: ['ownerPromotionKey'], target: 'promotion' },
] as const satisfies readonly RecordReference[];

export const dealReferences = [
  { path: ['promotionKey'], target: 'promotion' },
  { path: ['networkKey'], target: 'network' },
  { path: ['eventDefinitionKey'], target: 'eventDefinition' },
] as const satisfies readonly RecordReference[];

export const eventDefinitionReferences = [
  { path: ['promotionKey'], target: 'promotion' },
  { path: ['brandKey'], target: 'brand' },
  { path: ['preferredRegionKey'], target: 'region' },
  { path: ['preferredVenueKey'], target: 'venue' },
] as const satisfies readonly RecordReference[];
