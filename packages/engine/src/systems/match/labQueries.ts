/**
 * The Match lab's setup queries (MTCH1-06), so the lab stands on its own:
 *
 * - `match.labOptions`: the regions, event sizes, the viewer's promotion and the lab's defaults;
 * - `match.labWorkers`: a picker list of people with their popularity in a region and whether
 *   they can work today.
 *
 * Neither leaks anything hidden: a picker row has no development, vices, morale or contract
 * terms, for any viewer. Availability is WRK1's `availabilityOf`, the same rule the workers screens
 * use. Design: docs/design/match-rating.md#previews.
 */

import { z } from 'zod';
import { viewerPromotionIds } from '../../core/api/controller';
import { defineQuery, type QueryDefinition } from '../../core/api/query';
import { INVALID_ARGS, refuseQuery } from '../../core/api/result';
import type { ContentKey } from '../../core/content-key';
import type { PersonId, PromotionId, RegionId } from '../../core/ids';
import { matchTypesOf } from '../../model/catalogs';
import { EVENT_IMPORTANCES, type EventImportance } from '../../model/entities/event-definition';
import { promotionStatusKey, type Employment } from '../../model/entities/employment';
import type { Person, PersonRole, RingStyle } from '../../model/entities/person';
import type { PromotionStyle } from '../../model/entities/promotion-style';
import { zId } from '../../model/primitives';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import { geographyOf } from '../world/geography';
import { availabilityOf } from '../workers/helpers/availability';
import { primaryEmploymentOf } from '../workers/helpers/employment';
import { EVENT_IMPORTANCE_LABELS } from './formulas/crowdExpectation';
import { labPromotionOf, requireRegion } from './previewArgs';
import type { SegmentKind } from './rating/types';
import type { SlotRole } from './slots';

/** The viewer's promotion, as the lab shows it. */
export interface LabPromotion {
  id: PromotionId;
  name: string;
  style: PromotionStyle;
  homeRegionId: RegionId;
}

/** A region the show can be in. */
export interface LabRegion {
  id: RegionId;
  name: string;
  countryName: string;
  continentName: string;
}

/** An event size. */
export interface LabImportance {
  key: EventImportance;
  label: string;
}

/** What the lab starts with. */
export interface LabDefaults {
  slotRole: SlotRole;
  importance: EventImportance;
  /** The promotion's home region, else the first region; null on a world with no regions. */
  regionId: RegionId | null;
  televised: boolean;
  kind: SegmentKind;
  /** The first visible match type for two sides of one; null without a match type catalog. */
  typeKey: ContentKey | null;
}

/** `match.labOptions`. */
export interface LabOptions {
  /** False when the world has no match types (a save from before catalogs). */
  available: boolean;
  /** The viewer's first promotion, or null for a viewer who runs none. */
  promotion: LabPromotion | null;
  /** Sorted by continent, then country, then region name. */
  regions: LabRegion[];
  /** House show to Flagship. */
  importances: LabImportance[];
  defaults: LabDefaults;
}

/** Who the picker lists. */
export const LAB_WORKER_SCOPES = ['mine', 'everyone'] as const;
export type LabWorkerScope = (typeof LAB_WORKER_SCOPES)[number];

/** The longest search text and the largest list. */
export const LAB_WORKERS_MAX_SEARCH = 40;
export const LAB_WORKERS_MAX_LIMIT = 500;
export const LAB_WORKERS_DEFAULT_LIMIT = 300;

/** `match.labWorkers` arguments. */
export interface LabWorkersArgs {
  /** `mine`: the promotion's active roster. `everyone`: every person still in the business. */
  scope: LabWorkerScope;
  /** Popularity is read in this region. */
  regionId: RegionId;
  /** Case-insensitive text in the name or default ring name. Up to 40 characters. */
  search?: string | undefined;
  /** 1 to 500; 300 when left out. */
  limit?: number | undefined;
  /** The promotion the lab books for; left out, the viewer's first. Needed by the all-seeing viewer. */
  promotionId?: PromotionId | undefined;
}

/** One person in the picker. Nothing hidden: no development, vices, morale or contract terms. */
export interface LabWorkerRow {
  personId: PersonId;
  /** The ring name with the lab's promotion, else the person's default ring name. */
  name: string;
  /** The short name of the person's main employer, or null for a free agent. */
  promotionShortName: string | null;
  /** `nonWrestler` flags someone who talks rather than wrestles. */
  style: RingStyle;
  roles: PersonRole[];
  /** Popularity in the asked region, 0 to 100 (0 when unknown there). */
  popularity: number;
  available: boolean;
  /** Why not, written for the player ("Injured (back injury)"); null when available. */
  unavailableReason: string | null;
}

/** `match.labWorkers`. */
export interface LabWorkers {
  /** Popularity descending, then name; at most `limit`. */
  rows: LabWorkerRow[];
  /** How many people matched before the limit. */
  total: number;
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'match.labOptions': { args: Record<string, never>; result: LabOptions };
    'match.labWorkers': { args: LabWorkersArgs; result: LabWorkers };
  }
}

/** Lower-cased code-unit order: the same on every machine. */
function compareNames(left: string, right: string): number {
  const leftName = left.toLowerCase();
  const rightName = right.toLowerCase();
  return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
}

function labRegionsOf(read: GameWorldView): LabRegion[] {
  const geography = geographyOf(read);
  return geography.regions
    .map((region) => {
      const country = geography.country(region.countryId);
      return {
        id: region.id,
        name: region.name,
        countryName: country.name,
        continentName: geography.continent(country.continentId).name,
      };
    })
    .sort(
      (left, right) =>
        compareNames(left.continentName, right.continentName) ||
        compareNames(left.countryName, right.countryName) ||
        compareNames(left.name, right.name) ||
        compareIds(left.id, right.id),
    );
}

/** The first visible match type that takes two sides of one person. */
function defaultTypeKey(read: GameWorldView): ContentKey | null {
  const twoOfOne = matchTypesOf(read).find(
    (type) =>
      type.sides.min <= 2 &&
      type.sides.max >= 2 &&
      type.sideSize.min <= 1 &&
      type.sideSize.max >= 1,
  );
  return twoOfOne?.key ?? null;
}

export const labOptionsQuery: QueryDefinition<'match.labOptions'> = defineQuery(
  'match.labOptions',
  {
    args: z.strictObject({}),
    run: (ctx) => {
      const { read } = ctx;
      const [promotionId] = viewerPromotionIds(read, ctx.viewer);
      const row = promotionId === undefined ? undefined : read.tables.promotions.get(promotionId);
      const promotion: LabPromotion | null =
        row === undefined
          ? null
          : { id: row.id, name: row.name, style: row.style, homeRegionId: row.homeRegionId };
      const regions = labRegionsOf(read);
      return {
        available: matchTypesOf(read, { includeHidden: true }).length > 0,
        promotion,
        regions,
        importances: EVENT_IMPORTANCES.map((key) => ({
          key,
          label: EVENT_IMPORTANCE_LABELS[key],
        })),
        defaults: {
          slotRole: 'midcard',
          importance: 'regular',
          regionId: promotion?.homeRegionId ?? regions[0]?.id ?? null,
          televised: true,
          kind: 'match',
          typeKey: defaultTypeKey(read),
        },
      };
    },
  },
);

const labWorkersArgs = z.strictObject({
  scope: z.enum(LAB_WORKER_SCOPES),
  regionId: zId('region'),
  search: z.string().max(LAB_WORKERS_MAX_SEARCH).optional(),
  limit: z.number().int().min(1).max(LAB_WORKERS_MAX_LIMIT).optional(),
  promotionId: zId('promotion').optional(),
});

/** Still in the business: not retired, dead or gone. Someone on hiatus is listed, unavailable. */
function inTheBusiness(person: Person): boolean {
  return (
    person.status === 'active' || person.status === 'semiRetired' || person.status === 'hiatus'
  );
}

/** The people a scope lists, in ID order, with their contract with the lab's promotion if any. */
function candidatesOf(
  read: GameWorldView,
  scope: LabWorkerScope,
  promotionId: PromotionId | null,
): { person: Person; contract: Employment | null }[] {
  const contracts = new Map<PersonId, Employment>();
  if (promotionId !== null) {
    for (const employment of read.tables.employments.lookup(
      'byPromotionStatus',
      promotionStatusKey(promotionId, 'active'),
    )) {
      contracts.set(employment.personId, employment);
    }
  }
  const people =
    scope === 'mine'
      ? [...contracts.keys()].map((personId) => read.tables.people.require(personId))
      : read.tables.people.values();
  return people
    .filter(inTheBusiness)
    .sort((left, right) => compareIds(left.id, right.id))
    .map((person) => ({ person, contract: contracts.get(person.id) ?? null }));
}

/**
 * `match.labWorkers`. `mine` needs a promotion (the viewer's, or `promotionId`); `everyone` uses
 * one only for ring names and leaves when there is one. Availability is judged on today's date.
 */
export const labWorkersQuery: QueryDefinition<'match.labWorkers'> = defineQuery(
  'match.labWorkers',
  {
    args: labWorkersArgs,
    run: (ctx, args) => {
      const { read } = ctx;
      requireRegion(read, args.regionId);
      const promotionId =
        args.scope === 'mine' || args.promotionId !== undefined
          ? labPromotionOf(read, ctx.viewer, args.promotionId)
          : (viewerPromotionIds(read, ctx.viewer)[0] ?? null);
      if (args.scope === 'mine' && promotionId === null) {
        return refuseQuery({
          code: INVALID_ARGS,
          message: 'promotionId: pick the promotion whose roster to list',
          field: 'promotionId',
        });
      }
      const search = (args.search ?? '').trim().toLowerCase();
      const shortNames = new Map<PromotionId, string>();
      const shortNameOf = (id: PromotionId): string => {
        let shortName = shortNames.get(id);
        if (shortName === undefined) {
          shortName = read.tables.promotions.require(id).shortName;
          shortNames.set(id, shortName);
        }
        return shortName;
      };

      const rows: LabWorkerRow[] = [];
      for (const { person, contract } of candidatesOf(read, args.scope, promotionId)) {
        const name = contract?.ringName ?? person.defaultRingName;
        if (
          search !== '' &&
          !name.toLowerCase().includes(search) &&
          !person.defaultRingName.toLowerCase().includes(search)
        ) {
          continue;
        }
        const primary = primaryEmploymentOf(read, person.id, ctx.date);
        const availability = availabilityOf(person, contract ?? primary, ctx.date);
        const available = availability.status === 'available';
        rows.push({
          personId: person.id,
          name,
          promotionShortName: primary === null ? null : shortNameOf(primary.promotionId),
          style: person.style,
          roles: [...person.roles],
          popularity: person.regionalPop[args.regionId] ?? 0,
          available,
          unavailableReason: available ? null : availability.reason,
        });
      }
      rows.sort(
        (left, right) =>
          right.popularity - left.popularity ||
          compareNames(left.name, right.name) ||
          compareIds(left.personId, right.personId),
      );
      return {
        rows: rows.slice(0, args.limit ?? LAB_WORKERS_DEFAULT_LIMIT),
        total: rows.length,
      };
    },
  },
);

export const labQueries: readonly QueryDefinition[] = [labOptionsQuery, labWorkersQuery];
