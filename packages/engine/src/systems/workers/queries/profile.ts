/**
 * `workers.profile`: everything the worker profile screen shows about one person, for one viewer.
 *
 * Every derived number comes with its trace inline: nothing here is stored, so there is nothing in
 * the trace store to point at. The viewer rules live in this file and nowhere else:
 *
 * - the development fields (potential and ceilings) are never returned, to anyone;
 * - a vice is listed only once it is known or the person is recovering from it;
 * - a contract's terms and morale are returned only for a promotion the viewer runs (or to the
 *   all-seeing viewer); for anyone else they are `null` and named in `hidden`;
 * - an offer that never became a contract is only listed for the promotion that made it.
 *
 * Design: docs/design/workers.md#the-profile-query.
 */

import { z } from 'zod';
import { viewerPromotionIds, type Viewer } from '../../../core/api/controller';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import { refuseQuery } from '../../../core/api/result';
import { compareDates, diffDays, type GameDate } from '../../../core/date';
import type {
  ContinentId,
  CountryId,
  EmploymentId,
  PersonId,
  PromotionId,
  RegionId,
  TeamId,
  TitleId,
  TitleReignId,
} from '../../../core/ids';
import type { TraceNode } from '../../../core/trace';
import type {
  Alignment,
  ContractTerms,
  Employment,
  EmploymentRole,
  EmploymentStatus,
  Push,
} from '../../../model/entities/employment';
import {
  ATTRIBUTE_GROUPS,
  type AttributeGroup,
  type AttributeKey,
  type Gender,
  type Person,
  type PersonRole,
  type PersonStatus,
  type RingStyle,
  type TraitKey,
  type ViceState,
} from '../../../model/entities/person';
import type { TeamKind, TeamStatus } from '../../../model/entities/team';
import type { ReignEndReason } from '../../../model/entities/title-reign';
import { zId } from '../../../model/primitives';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import {
  createPopularityRoller,
  popularityRollup,
  popularityRollupView,
  type PopularityRollupView,
} from '../../world/formulas/popularityRollup';
import { geographyOf, type Geography } from '../../world/geography';
import { ATTRIBUTE_LABELS } from '../../world/people/labels';
import { gradeOf, type Grade } from '../formulas/grade';
import { overallByRole } from '../formulas/roleRating';
import { weightClass, type WeightClass } from '../formulas/weightClass';
import { ageOn, experienceYears } from '../helpers/age';
import { availabilityOf, type Availability } from '../helpers/availability';
import { primaryEmploymentOf } from '../helpers/employment';
import { expectedPushAt } from '../helpers/expectedPushAt';
import { mainRoleOf, RATING_ROLES, type RatingRole } from '../helpers/roles';
import { TRAIT_LABELS, VICE_KINDS, VICE_LABELS, type ViceKind } from '../labels';

// ---------------------------------------------------------------------------------------------
// The result

/** A region with the country it is in, as a profile names a place. */
export interface WorkerProfilePlace {
  regionId: RegionId;
  regionName: string;
  countryName: string;
}

/** The promotion a person mainly works for. */
export interface WorkerProfileEmployer {
  promotionId: PromotionId;
  name: string;
  shortName: string;
  /** True when the viewer runs this promotion. */
  isViewers: boolean;
}

export interface WorkerProfileHeader {
  personId: PersonId;
  /** The ring name at their main employer, or their own default for a free agent. */
  ringName: string;
  legalName: string;
  /** The stored image reference, or null for none. */
  imageRef: string | null;
  masked: boolean;
  gender: Gender;
  /** Whole years on the world's current date. */
  age: number;
  heightCm: number;
  weightKg: number;
  weightClass: { value: WeightClass; trace: TraceNode };
  style: RingStyle;
  basedIn: WorkerProfilePlace;
  born: WorkerProfilePlace;
  roles: PersonRole[];
  status: PersonStatus;
  mainRole: RatingRole;
  debutDate: GameDate | null;
  /** Years since the debut, with a fraction; 0 before it. */
  experienceYears: number;
  /** Null for a free agent. */
  employer: WorkerProfileEmployer | null;
  /** The card position at the main employer; null for a free agent. */
  push: Push | null;
  /** The alignment at the main employer; null for a free agent. */
  alignment: Alignment | null;
  availability: Availability;
}

export interface WorkerProfileAttribute {
  key: AttributeKey;
  label: string;
  /** 0 to 100, not rounded. */
  value: number;
  grade: Grade;
  /** Why that grade: "72 is in the B+ band, 72 to 77". */
  gradeReason: string;
}

export interface WorkerProfileRoleRating {
  role: RatingRole;
  /** 0 to 100, not rounded. */
  value: number;
  grade: Grade;
  trace: TraceNode;
}

export interface WorkerProfileExpectedPush {
  promotionId: PromotionId;
  promotionName: string;
  push: Push;
  trace: TraceNode;
}

/** The roll-up of the person's regional popularity, plus where they are best known. */
export interface WorkerProfilePopularity extends PopularityRollupView {
  /** The country they are best known in, or null for someone unknown everywhere. */
  top: { countryId: CountryId; countryName: string; value: number } | null;
  /** The continent they are best known in, or null for someone unknown everywhere. */
  topContinentId: ContinentId | null;
}

export interface WorkerProfileTrait {
  key: TraitKey;
  label: string;
}

/** A vice the viewer may know about: only `known` and `recovering` ones are ever listed. */
export interface WorkerProfileVice {
  kind: ViceKind;
  label: string;
  state: Extract<ViceState, 'known' | 'recovering'>;
}

export interface WorkerProfileContract {
  employmentId: EmploymentId;
  promotionId: PromotionId;
  promotionName: string;
  role: EmploymentRole;
  ringName: string;
  status: EmploymentStatus;
  startsOn: GameDate;
  /** Null for an open-ended contract. */
  endsOn: GameDate | null;
  /** The day it ended, or null while it has not. */
  endedOn: GameDate | null;
  push: Push;
  alignment: Alignment;
  /** Null when the viewer may not see this promotion's contract terms. */
  terms: ContractTerms | null;
  /** -100 to 100. Null when the viewer may not see this promotion's morale. */
  morale: number | null;
  /** -100 to 100, or null before the first appearance. On-screen form, so every viewer sees it. */
  momentum: number | null;
}

/** Someone a reign or a team was shared with. */
export interface WorkerProfilePartner {
  personId: PersonId;
  name: string;
}

export interface WorkerProfileReign {
  reignId: TitleReignId;
  titleId: TitleId;
  titleName: string;
  promotionId: PromotionId;
  promotionName: string;
  wonOn: GameDate;
  /** Null while they still hold it. */
  lostOn: GameDate | null;
  /** Days from the win to the loss, or to today for a current reign. */
  daysHeld: number;
  defences: number;
  /** Null while they still hold it. */
  endReason: ReignEndReason | null;
  /** The co-holders of a tag or trios title, by the ring names they used when they won. */
  partners: WorkerProfilePartner[];
}

export interface WorkerProfileTeam {
  teamId: TeamId;
  name: string;
  kind: TeamKind;
  status: TeamStatus;
  partners: WorkerProfilePartner[];
  formedOn: GameDate;
  splitOn: GameDate | null;
}

/** What a viewer can be refused on a profile. */
export const WORKER_PROFILE_HIDDEN_FIELDS = ['contractTerms', 'morale'] as const;
export type WorkerProfileHiddenField = (typeof WORKER_PROFILE_HIDDEN_FIELDS)[number];

/** `workers.profile`: one person, as one viewer may see them. Plain JSON. */
export interface WorkerProfile {
  header: WorkerProfileHeader;
  attributes: Record<AttributeGroup, WorkerProfileAttribute[]>;
  overall: { mainRole: RatingRole; byRole: WorkerProfileRoleRating[] };
  /** Where on the card they would expect to be at the viewer's promotion; null with no promotion. */
  expectedPush: WorkerProfileExpectedPush | null;
  popularity: WorkerProfilePopularity;
  traits: WorkerProfileTrait[];
  vices: WorkerProfileVice[];
  career: {
    /** Newest first. */
    contracts: WorkerProfileContract[];
    /** Newest first. */
    reigns: WorkerProfileReign[];
    /** Newest first. */
    teams: WorkerProfileTeam[];
  };
  /** What this viewer was not shown, so the screen can say "Private" instead of a blank. */
  hidden: WorkerProfileHiddenField[];
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'workers.profile': { args: { personId: PersonId }; result: WorkerProfile };
  }
}

/** The reason code for a person that does not exist. */
export const WORKER_NOT_FOUND = 'notFound';

// ---------------------------------------------------------------------------------------------
// Building it

/** The statuses of an offer that never became a contract: the business of the two sides only. */
const PRIVATE_OFFER_STATUSES: readonly EmploymentStatus[] = ['offered', 'declined', 'withdrawn'];

function placeOf(geography: Geography, regionId: RegionId): WorkerProfilePlace {
  return {
    regionId,
    regionName: geography.region(regionId).name,
    countryName: geography.countryOf(regionId).name,
  };
}

function legalNameOf(person: Pick<Person, 'givenName' | 'familyName'>): string {
  return person.familyName === '' ? person.givenName : `${person.givenName} ${person.familyName}`;
}

/** The name a person goes by today: at their main employer, or their own default. */
function ringNameOf(read: GameWorldView, person: Person): string {
  const primary = primaryEmploymentOf(read, person.id, read.meta.currentDate);
  return primary?.ringName ?? person.defaultRingName;
}

function attributesOf(person: Person): Record<AttributeGroup, WorkerProfileAttribute[]> {
  const group = (keys: readonly AttributeKey[]): WorkerProfileAttribute[] =>
    keys.map((key) => {
      const value = person.attributes[key];
      const { grade, reason } = gradeOf(value);
      return { key, label: ATTRIBUTE_LABELS[key], value, grade, gradeReason: reason };
    });
  return {
    inRing: group(ATTRIBUTE_GROUPS.inRing),
    character: group(ATTRIBUTE_GROUPS.character),
    crew: group(ATTRIBUTE_GROUPS.crew),
  };
}

function roleRatingsOf(person: Person, tunables: EngineTunables): WorkerProfileRoleRating[] {
  const ratings = overallByRole(person, { tunables });
  return RATING_ROLES.map((role) => {
    const rating = ratings[role];
    return { role, value: rating.value, grade: gradeOf(rating.value).grade, trace: rating.trace };
  });
}

function popularityOf(person: Person, geography: Geography): WorkerProfilePopularity {
  const view = popularityRollupView(popularityRollup(person.regionalPop, geography), geography);
  const { top, topContinent } = createPopularityRoller(geography).rollValues(person.regionalPop);
  return {
    ...view,
    top:
      top === null
        ? null
        : {
            countryId: top.countryId,
            countryName: geography.country(top.countryId).name,
            value: top.value,
          },
    topContinentId: topContinent?.continentId ?? null,
  };
}

function vicesOf(person: Person): WorkerProfileVice[] {
  const vices: WorkerProfileVice[] = [];
  for (const kind of VICE_KINDS) {
    const state = person.vices[kind];
    if (state === 'known' || state === 'recovering') {
      vices.push({ kind, label: VICE_LABELS[kind], state });
    }
  }
  return vices;
}

/** Newest first; on the same day, the higher ID first so the order never depends on storage. */
function newestFirst<Row extends { readonly id: string }>(
  rows: readonly Row[],
  dateOf: (row: Row) => GameDate,
): Row[] {
  return [...rows].sort((left, right) => {
    const order = compareDates(dateOf(right), dateOf(left));
    return order !== 0 ? order : compareIds(right.id, left.id);
  });
}

interface ContractList {
  contracts: WorkerProfileContract[];
  hidden: WorkerProfileHiddenField[];
}

function contractsOf(
  read: GameWorldView,
  employments: readonly Employment[],
  viewer: Viewer,
  ownPromotionIds: readonly PromotionId[],
): ContractList {
  const seesAll = viewer.kind === 'omniscient';
  let anyHidden = false;
  const contracts: WorkerProfileContract[] = [];
  for (const employment of newestFirst(employments, (row) => row.startsOn)) {
    const mayRead = seesAll || ownPromotionIds.includes(employment.promotionId);
    if (!mayRead && PRIVATE_OFFER_STATUSES.includes(employment.status)) {
      continue;
    }
    if (!mayRead) {
      anyHidden = true;
    }
    contracts.push({
      employmentId: employment.id,
      promotionId: employment.promotionId,
      promotionName: read.tables.promotions.require(employment.promotionId).name,
      role: employment.role,
      ringName: employment.ringName,
      status: employment.status,
      startsOn: employment.startsOn,
      endsOn: employment.endsOn,
      endedOn: employment.endedOn,
      push: employment.push,
      alignment: employment.alignment,
      terms: mayRead ? structuredTerms(employment.terms) : null,
      morale: mayRead ? employment.morale : null,
      momentum: employment.momentum,
    });
  }
  return { contracts, hidden: anyHidden ? [...WORKER_PROFILE_HIDDEN_FIELDS] : [] };
}

/** A copy of the terms, so the result never shares objects with the stored row. */
function structuredTerms(terms: ContractTerms): ContractTerms {
  return { ...terms, shares: { ...terms.shares }, perks: { ...terms.perks } };
}

function reignsOf(read: GameWorldView, personId: PersonId, today: GameDate): WorkerProfileReign[] {
  const reigns = read.tables.titleReigns.lookup('byHolder', personId);
  return newestFirst(reigns, (reign) => reign.wonOn).map((reign) => {
    const title = read.tables.titles.require(reign.titleId);
    const partners: WorkerProfilePartner[] = [];
    reign.holderIds.forEach((holderId, holderIndex) => {
      if (holderId !== personId) {
        partners.push({ personId: holderId, name: reign.holderNamesAtTime[holderIndex] ?? '' });
      }
    });
    return {
      reignId: reign.id,
      titleId: title.id,
      titleName: title.name,
      promotionId: title.promotionId,
      promotionName: read.tables.promotions.require(title.promotionId).name,
      wonOn: reign.wonOn,
      lostOn: reign.lostOn,
      daysHeld: Math.max(0, diffDays(reign.wonOn, reign.lostOn ?? today)),
      defences: reign.defences,
      endReason: reign.endReason,
      partners,
    };
  });
}

function teamsOf(read: GameWorldView, personId: PersonId): WorkerProfileTeam[] {
  const teams = read.tables.teams.lookup('byMember', personId);
  return newestFirst(teams, (team) => team.formedOn).map((team) => ({
    teamId: team.id,
    name: team.name,
    kind: team.kind,
    status: team.status,
    partners: team.memberIds
      .filter((memberId) => memberId !== personId)
      .map((memberId) => ({
        personId: memberId,
        name: ringNameOf(read, read.tables.people.require(memberId)),
      })),
    formedOn: team.formedOn,
    splitOn: team.splitOn,
  }));
}

/** The profile of `personId` as `viewer` may see it, or null when there is no such person. */
export function workerProfileOf(
  read: GameWorldView,
  personId: PersonId,
  viewer: Viewer,
  tunables: EngineTunables,
): WorkerProfile | null {
  const person = read.tables.people.get(personId);
  if (person === undefined) {
    return null;
  }
  const today = read.meta.currentDate;
  const geography = geographyOf(read);
  const ownPromotionIds = viewerPromotionIds(read, viewer);
  const primary = primaryEmploymentOf(read, personId, today);
  const mainRole = mainRoleOf(person, primary);
  const employerRow = primary === null ? null : read.tables.promotions.require(primary.promotionId);
  const weight = weightClass({ weightKg: person.weightKg }, { tunables });

  const [viewerPromotionId] = ownPromotionIds;
  let expectedPush: WorkerProfileExpectedPush | null = null;
  if (viewerPromotionId !== undefined) {
    const expected = expectedPushAt(read, personId, viewerPromotionId, tunables);
    expectedPush = {
      promotionId: viewerPromotionId,
      promotionName: read.tables.promotions.require(viewerPromotionId).name,
      push: expected.value,
      trace: expected.trace,
    };
  }

  const { contracts, hidden } = contractsOf(
    read,
    read.tables.employments.lookup('byPerson', personId),
    viewer,
    ownPromotionIds,
  );

  return {
    header: {
      personId,
      ringName: primary?.ringName ?? person.defaultRingName,
      legalName: legalNameOf(person),
      imageRef: person.imageRef,
      masked: person.masked,
      gender: person.gender,
      age: ageOn(person, today),
      heightCm: person.heightCm,
      weightKg: person.weightKg,
      weightClass: { value: weight.value, trace: weight.trace },
      style: person.style,
      basedIn: placeOf(geography, person.basedInRegionId),
      born: placeOf(geography, person.birthRegionId),
      roles: [...person.roles],
      status: person.status,
      mainRole,
      debutDate: person.debutDate,
      experienceYears: experienceYears(person, today),
      employer:
        employerRow === null
          ? null
          : {
              promotionId: employerRow.id,
              name: employerRow.name,
              shortName: employerRow.shortName,
              isViewers: ownPromotionIds.includes(employerRow.id),
            },
      push: primary?.push ?? null,
      alignment: primary?.alignment ?? null,
      availability: availabilityOf(person, primary, today),
    },
    attributes: attributesOf(person),
    overall: { mainRole, byRole: roleRatingsOf(person, tunables) },
    expectedPush,
    popularity: popularityOf(person, geography),
    traits: person.traits.map((key) => ({ key, label: TRAIT_LABELS[key] })),
    vices: vicesOf(person),
    career: {
      contracts,
      reigns: reignsOf(read, personId, today),
      teams: teamsOf(read, personId),
    },
    hidden,
  };
}

export const profileQuery: QueryDefinition<'workers.profile'> = defineQuery('workers.profile', {
  args: z.strictObject({ personId: zId('person') }),
  run: (ctx, args) =>
    workerProfileOf(ctx.read, args.personId, ctx.viewer, ctx.tunables) ??
    refuseQuery({ code: WORKER_NOT_FOUND, message: 'No such worker' }),
});

export const workersQueries: readonly QueryDefinition[] = [profileQuery];
