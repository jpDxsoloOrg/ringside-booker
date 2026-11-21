/**
 * The draft's queries (DRF-01): `draft.state`, `draft.pool` and `draft.preview`. Public: a draft
 * is a public event, and every pick is seen by everyone. Money (DRF-10) is the viewer's own only:
 * their cash, and what each pool candidate's season contract would cost them.
 *
 * Design: docs/design/draft.md#queries.
 */

import { z } from 'zod';
import { defineQuery } from '../../core/api/query';
import { viewerPromotionIds } from '../../core/api/controller';
import { compareDates, type GameDate } from '../../core/date';
import { zId } from '../../model/primitives';
import type { PersonId, PromotionId } from '../../core/ids';
import {
  DraftCardLevelSchema,
  type Draft,
  type DraftCardLevel,
  type DraftCategory,
  type DraftLevel,
  type DraftPick,
  type DraftPickSource,
  type DraftPoolLevel,
  type DraftSettings,
} from '../../model/entities/draft';
import { promotionStatusKey, type EmploymentRole } from '../../model/entities/employment';
import type { Gender, RingStyle } from '../../model/entities/person';
import { GENDERS, RING_STYLES } from '../../model/entities/person';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import {
  DRAFT_STAFF_ROLES,
  DRAFT_WEIGHT_CLASSES,
  type DraftCandidate,
  type DraftWeightClass,
} from './candidates';
import { draftValueParts, draftValueWeights } from './draftValue';
import { needsFrom, rosterCounts, turnOf } from './flow';
import { EQUALISED, NOT_EQUALISED } from './level';
import { roundOrder } from './order';
import { CARD_LEVEL_LABELS } from './pool';
import { draftSettingsOf, type DraftOptions } from './settings';
import { DraftPricer } from './pricing';
import { runningCostsOf } from './reserve';
import { latestDraft, loadDraft, openDraft, picksOf } from './session';

/** How a pick's contract stands now. `lapsed`: unsigned and the rights ran out. */
export type PickContract = 'signed' | 'reserved' | 'released' | 'lapsed';

export interface DraftPickView {
  number: number;
  round: number;
  promotionId: PromotionId;
  promotionName: string;
  promotionShortName: string;
  personId: PersonId;
  name: string;
  gender: Gender;
  category: DraftCategory;
  role: EmploymentRole;
  value: number;
  source: DraftPickSource;
  contract: PickContract;
  /** The last day the rights are held, for an unsigned pick. */
  reservedUntil: GameDate | null;
  /** The season contract paid at the pick, in cents, for the viewer's own picks; else null. */
  cost: number | null;
}

export interface DraftClockView {
  promotionId: PromotionId;
  name: string;
  shortName: string;
  /** True when the viewer runs this promotion. */
  isYou: boolean;
  /** 1-based. */
  round: number;
  /** The pick number this turn will make, 1-based. */
  pick: number;
}

export interface DraftRosterSummary {
  promotionId: PromotionId;
  name: string;
  shortName: string;
  color: string;
  isYou: boolean;
  wrestlers: number;
  staff: number;
  /** True when it wants nobody more the pool has. */
  done: boolean;
  /** True when its turns ended because it could not afford anyone left (DRF-10). */
  outOfMoney: boolean;
}

/** The viewer's own money in the draft (DRF-10). */
export interface DraftYouView {
  promotionId: PromotionId;
  /** Cash now, in cents. */
  cash: number;
  /** Picks are paid up front (off under "Negotiate contracts after the draft"). */
  paysUpFront: boolean;
  /** True when your turns ended because you cannot afford anyone left in the pool. */
  outOfMoney: boolean;
  /** Wrestlers short of the roster target. */
  wrestlersShort: number;
}

export interface DraftStateView {
  draftId: Draft['id'];
  kind: Draft['kind'];
  status: Draft['status'];
  createdOn: GameDate;
  finishedOn: GameDate | null;
  settings: DraftSettings;
  level: DraftLevel;
  poolMix: (DraftPoolLevel & { label: string })[];
  /** Promotions drafting, in round one's order. */
  promotions: number;
  picksMade: number;
  poolLeft: { wrestlers: number; staff: number };
  onTheClock: DraftClockView | null;
  /** The viewer's next turn: its round and how many picks come before it. Null: none. */
  yourNextTurn: { round: number; picksAway: number } | null;
  /** The newest picks, newest first. */
  recentPicks: DraftPickView[];
  /** Every drafting promotion's roster so far, in round one's order. */
  rosters: DraftRosterSummary[];
  /** The picks of one roster (`rosterOf`, default the viewer's), in pick order. */
  roster: { promotionId: PromotionId; picks: DraftPickView[] } | null;
  /** The viewer's cash and whether they can still pay (DRF-10); null for a spectator. */
  you: DraftYouView | null;
}

export const POOL_SORTS = [
  'value',
  'fit',
  'rating',
  'popularity',
  'age',
  'name',
  'level',
  'cost',
] as const;

/** Card levels top down, for sorting: main event first. */
const LEVEL_RANK: Readonly<Record<DraftCardLevel, number>> = {
  mainEvent: 5,
  upperCard: 4,
  midCard: 3,
  lowerCard: 2,
  enhancement: 1,
};
export type PoolSort = (typeof POOL_SORTS)[number];

export interface DraftPoolRow {
  personId: PersonId;
  name: string;
  gender: Gender;
  age: number;
  category: DraftCategory;
  role: EmploymentRole;
  style: RingStyle;
  weightClass: DraftWeightClass;
  weightKg: number;
  alignment: 'face' | 'heel';
  /** Role rating in the drafted role, one decimal. */
  rating: number;
  /** Best country and world-wide popularity, one decimal. */
  popularity: { best: number; world: number };
  /** Draft value, 0-100, one decimal. */
  value: number;
  /** Card level when the draft began (DRF-08); null for staff. */
  level: DraftCardLevel | null;
  /** The draft value's Why?, one line per part. */
  why: string[];
  /** How well they fit the viewer's roster (value plus needs), one decimal; null without one. */
  fit: number | null;
  /** The fit's Why?, one line per part. */
  fitWhy: string[];
  /**
   * What their season contract at the pick would cost the viewer, in cents (DRF-10): taken off
   * cash at the pick by default, an estimate under "Negotiate contracts after the draft". Null for
   * a spectator.
   */
  cost: number | null;
  /** The cost's parts: wages, expected appearances and their fees, in cents. Null with `cost`. */
  costParts: { wages: number; appearances: number; fees: number; days: number } | null;
  /** False when the viewer cannot pay for them now (only when picks are paid up front). */
  affordable: boolean;
}

export interface DraftPoolView {
  rows: DraftPoolRow[];
  /** Rows matching the filters. */
  total: number;
  offset: number;
  limit: number;
  poolLeft: { wrestlers: number; staff: number };
  /** The viewer's cash in cents, or null for a spectator (DRF-10). */
  cash: number | null;
  /** Picks are paid up front; false under "Negotiate contracts after the draft". */
  paysUpFront: boolean;
  /**
   * The viewer's running costs a month in cents (DRF-11: overhead, medical, venue rent, travel,
   * catering and show production for a full roster), or null for a spectator. The draft room hints
   * when a pick would leave less than `reserveMonths` of it.
   */
  runningCostMonthly: number | null;
  /** `draft.ai.reserveMonths`: the months of running costs rivals keep. */
  reserveMonths: number;
}

export interface DraftPreviewView {
  /** The draft settings this game was started with. */
  options: DraftOptions;
  /** The draft, or null in a game without one. */
  draft: {
    draftId: Draft['id'];
    status: Draft['status'];
    settings: DraftSettings;
    level: DraftLevel;
    promotions: number;
    poolMix: (DraftPoolLevel & { label: string })[];
    /** Wrestlers in the pool when the draft began. */
    poolAtStart: number;
    sittingOut: number;
  } | null;
  /** What the draft start made equal. */
  equalised: string[];
  /** What still differs between promotions. */
  notEqualised: string[];
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'draft.state': {
      args: { recent?: number | undefined; rosterOf?: PromotionId | undefined };
      result: { draft: DraftStateView | null };
    };
    'draft.pool': {
      args: {
        offset?: number | undefined;
        limit?: number | undefined;
        sort?: PoolSort | undefined;
        descending?: boolean | undefined;
        category?: DraftCategory | undefined;
        gender?: Gender | undefined;
        role?: EmploymentRole | undefined;
        weightClass?: DraftWeightClass | undefined;
        style?: RingStyle | undefined;
        level?: DraftCardLevel | undefined;
        search?: string | undefined;
      };
      result: DraftPoolView;
    };
    'draft.preview': { args: Record<string, never>; result: DraftPreviewView };
  }
}

function one(value: number): number {
  return Math.round(value * 10) / 10;
}

function mixView(draft: DeepReadonly<Draft>): (DraftPoolLevel & { label: string })[] {
  return draft.poolMix.map((entry) => ({
    ...entry,
    label: CARD_LEVEL_LABELS[entry.level],
  }));
}

function nameOf(read: GameWorldView, personId: PersonId, promotionId: PromotionId): string {
  const employment = read.tables.employments
    .lookup('byPerson', personId)
    .find((row) => row.promotionId === promotionId && row.status === 'active');
  return employment?.ringName ?? read.tables.people.get(personId)?.defaultRingName ?? personId;
}

function contractOf(
  read: GameWorldView,
  pick: DeepReadonly<DraftPick>,
  date: GameDate,
): PickContract {
  if (pick.status !== 'reserved') {
    return pick.status;
  }
  const signed = read.tables.employments
    .lookup('byPerson', pick.personId)
    .some(
      (row) =>
        row.promotionId === pick.promotionId &&
        (row.status === 'active' || row.status === 'signed'),
    );
  if (signed) {
    return 'signed';
  }
  return pick.reservedUntil !== null && compareDates(date, pick.reservedUntil) > 0
    ? 'lapsed'
    : 'reserved';
}

export function pickView(
  read: GameWorldView,
  pick: DeepReadonly<DraftPick>,
  date: GameDate,
  yours: ReadonlySet<PromotionId> = new Set(),
): DraftPickView {
  const promotion = read.tables.promotions.get(pick.promotionId);
  return {
    number: pick.number,
    round: pick.round,
    promotionId: pick.promotionId,
    promotionName: promotion?.name ?? pick.promotionId,
    promotionShortName: promotion?.shortName ?? '',
    personId: pick.personId,
    name: nameOf(read, pick.personId, pick.promotionId),
    gender: read.tables.people.get(pick.personId)?.gender ?? 'male',
    category: pick.category,
    role: pick.role,
    value: pick.value,
    source: pick.source,
    contract: contractOf(read, pick, date),
    reservedUntil: pick.reservedUntil,
    cost: yours.has(pick.promotionId) ? pick.cost : null,
  };
}

/** The viewer's next turn from the current one, assuming the rosters that need picks keep needing them. */
function yourNextTurn(
  read: GameWorldView,
  draft: DeepReadonly<Draft>,
  yours: ReadonlySet<PromotionId>,
  needs: (promotionId: PromotionId) => boolean,
): { round: number; picksAway: number } | null {
  if (draft.status !== 'running' || ![...yours].some((id) => needs(id))) {
    return null;
  }
  const count = draft.order.length;
  let picksAway = 0;
  for (let turn = draft.turn; turn < draft.turn + count * 2 + 1; turn += 1) {
    const round = Math.floor(turn / count);
    const promotionId = roundOrder(draft, round, read.meta.seed)[turn % count];
    if (promotionId === undefined || !needs(promotionId)) {
      continue;
    }
    if (yours.has(promotionId)) {
      return { round: round + 1, picksAway };
    }
    picksAway += 1;
  }
  return null;
}

function youView(
  read: GameWorldView,
  draft: DeepReadonly<Draft>,
  counts: ReadonlyMap<PromotionId, Record<DraftCategory, number>>,
  yours: ReadonlySet<PromotionId>,
): DraftYouView | null {
  const promotionId = draft.order.find((id) => yours.has(id));
  if (promotionId === undefined) {
    return null;
  }
  return {
    promotionId,
    cash: read.tables.promotions.require(promotionId).cash,
    paysUpFront: !draft.settings.negotiateAfter,
    outOfMoney: draft.outOfMoney.includes(promotionId),
    wrestlersShort: Math.max(
      0,
      draft.settings.rosterTarget - (counts.get(promotionId)?.wrestler ?? 0),
    ),
  };
}

export const draftStateQuery = defineQuery('draft.state', {
  args: z.strictObject({
    recent: z.number().int().min(0).max(200).optional(),
    rosterOf: zId('promotion').optional(),
  }),
  run: (ctx, args) => {
    const { read, date } = ctx;
    const draft = openDraft(read) ?? latestDraft(read);
    if (draft === null) {
      return { draft: null };
    }
    const yours = new Set(viewerPromotionIds(read, ctx.viewer));
    const picks = picksOf(read, draft.id);
    const counts = rosterCounts(picks);
    const needs = needsFrom(draft, counts);
    const broke = new Set<string>(draft.outOfMoney);
    const turn = turnOf(read, draft);
    const clockPromotion = turn === null ? undefined : read.tables.promotions.get(turn.promotionId);
    const recent = args.recent ?? 12;
    const rosterOf = args.rosterOf ?? draft.order.find((id) => yours.has(id)) ?? null;
    const view: DraftStateView = {
      draftId: draft.id,
      kind: draft.kind,
      status: draft.status,
      createdOn: draft.createdOn,
      finishedOn: draft.finishedOn,
      settings: { ...draft.settings },
      level: { ...draft.level },
      poolMix: mixView(draft),
      promotions: draft.order.length,
      picksMade: draft.picks,
      poolLeft: { ...draft.poolLeft },
      onTheClock:
        turn === null || clockPromotion === undefined
          ? null
          : {
              promotionId: turn.promotionId,
              name: clockPromotion.name,
              shortName: clockPromotion.shortName,
              isYou: yours.has(turn.promotionId),
              round: turn.round + 1,
              pick: draft.picks + 1,
            },
      yourNextTurn: yourNextTurn(read, draft, yours, needs),
      recentPicks: picks
        .slice(Math.max(0, picks.length - recent))
        .reverse()
        .map((pick) => pickView(read, pick, date, yours)),
      rosters: draft.order.map((promotionId) => {
        const promotion = read.tables.promotions.require(promotionId);
        const count = counts.get(promotionId);
        return {
          promotionId,
          name: promotion.name,
          shortName: promotion.shortName,
          color: promotion.color,
          isYou: yours.has(promotionId),
          wrestlers: count?.wrestler ?? 0,
          staff: count?.staff ?? 0,
          done: draft.status !== 'running' || !needs(promotionId),
          outOfMoney: broke.has(promotionId),
        };
      }),
      roster:
        rosterOf === null
          ? null
          : {
              promotionId: rosterOf,
              picks: picks
                .filter((pick) => pick.promotionId === rosterOf && pick.status !== 'released')
                .map((pick) => pickView(read, pick, date, yours)),
            },
      you: youView(read, draft, counts, yours),
    };
    return { draft: view };
  },
});

function sortValue(row: DraftPoolRow, sort: PoolSort): number | string {
  switch (sort) {
    case 'value':
      return row.value;
    case 'fit':
      return row.fit ?? row.value;
    case 'rating':
      return row.rating;
    case 'popularity':
      return row.popularity.best;
    case 'age':
      return row.age;
    case 'name':
      return row.name.toLowerCase();
    case 'level':
      return row.level === null ? 0 : LEVEL_RANK[row.level];
    case 'cost':
      return row.cost ?? 0;
  }
}

function valueWhy(
  candidate: DraftCandidate,
  weights: ReturnType<typeof draftValueWeights>,
): string[] {
  const parts = draftValueParts(
    {
      roleRating: candidate.rating,
      peakPop: candidate.peakPop,
      worldPop: candidate.worldPop,
      age: candidate.age,
    },
    weights,
  );
  const lines = [
    `Skill: ${String(one(parts.skill))} (rating ${String(one(candidate.rating))})`,
    `Popularity: ${String(one(parts.popularity))} (best country ${String(one(candidate.peakPop))}, world ${String(one(candidate.worldPop))})`,
  ];
  if (parts.age !== 0) {
    lines.push(
      `Age ${String(candidate.age)}: ${parts.age > 0 ? '+' : ''}${String(one(parts.age))}`,
    );
  }
  return lines;
}

export const draftPoolQuery = defineQuery('draft.pool', {
  args: z.strictObject({
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    sort: z.enum(POOL_SORTS).optional(),
    descending: z.boolean().optional(),
    category: z.enum(['wrestler', 'staff']).optional(),
    gender: z.enum(GENDERS).optional(),
    role: z.enum(['wrestler', ...DRAFT_STAFF_ROLES]).optional(),
    weightClass: z.enum(DRAFT_WEIGHT_CLASSES).optional(),
    style: z.enum(RING_STYLES).optional(),
    level: DraftCardLevelSchema.optional(),
    search: z.string().max(60).optional(),
  }),
  run: (ctx, args) => {
    const { read, tunables, date } = ctx;
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 50;
    const draft = openDraft(read);
    if (draft === null) {
      return {
        rows: [],
        total: 0,
        offset,
        limit,
        poolLeft: { wrestlers: 0, staff: 0 },
        cash: null,
        paysUpFront: false,
        runningCostMonthly: null,
        reserveMonths: tunables.get('draft.ai.reserveMonths'),
      };
    }
    const loaded = loadDraft(read, tunables, draft, date);
    const yours = viewerPromotionIds(read, ctx.viewer).find((id) => draft.order.includes(id));
    const roster = yours === undefined ? undefined : loaded.board.roster(yours);
    const search = args.search?.trim().toLowerCase() ?? '';
    const weights = draftValueWeights(tunables);
    const sort = args.sort ?? 'value';
    const levels = new Map<string, DraftCardLevel>(
      draft.cardLevels.map((entry) => [entry.personId, entry.level]),
    );
    const levelOf = (personId: string): DraftCardLevel | null => levels.get(personId) ?? null;
    const descending = args.descending ?? sort !== 'name';
    const matching = loaded.board
      .poolMembers()
      .filter(
        (candidate) =>
          (args.category === undefined || candidate.category === args.category) &&
          (args.gender === undefined || candidate.gender === args.gender) &&
          (args.role === undefined || candidate.role === args.role) &&
          (args.weightClass === undefined || candidate.weightClass === args.weightClass) &&
          (args.style === undefined || candidate.style === args.style) &&
          (args.level === undefined || levelOf(candidate.personId) === args.level) &&
          (search === '' || candidate.name.toLowerCase().includes(search)),
      );
    const rows = matching.map((candidate): DraftPoolRow => {
      const fitWhy: string[] = [];
      const fit = roster === undefined ? null : loaded.board.score(roster, candidate, fitWhy);
      return {
        personId: candidate.personId,
        name: candidate.name,
        gender: candidate.gender,
        age: candidate.age,
        category: candidate.category,
        role: candidate.role,
        style: candidate.style,
        weightClass: candidate.weightClass,
        weightKg: candidate.weightKg,
        alignment: candidate.heel ? 'heel' : 'face',
        rating: one(candidate.rating),
        popularity: { best: one(candidate.peakPop), world: one(candidate.worldPop) },
        value: one(candidate.value),
        level: candidate.category === 'staff' ? null : levelOf(candidate.personId),
        why: [],
        fit: fit === null ? null : one(fit),
        fitWhy: roster === undefined ? [] : fitWhy,
        cost: null,
        costParts: null,
        affordable: true,
      };
    });
    // DRF-10: what each would cost the viewer. Priced for the page only, or every match when
    // sorting by cost (about 0.2 ms a person).
    const paysUpFront = !draft.settings.negotiateAfter;
    const cash = yours === undefined ? null : read.tables.promotions.require(yours).cash;
    const pricer = yours === undefined ? null : new DraftPricer(read, tunables, date);
    const priceRow = (row: DraftPoolRow): void => {
      if (pricer === null || yours === undefined || cash === null) {
        return;
      }
      const { cost } = pricer.price(yours, row.personId);
      row.cost = cost.total;
      row.costParts = {
        wages: cost.wages,
        appearances: cost.appearances,
        fees: cost.fees,
        days: cost.days,
      };
      row.affordable = !paysUpFront || cost.total <= cash;
    };
    if (sort === 'cost') {
      rows.forEach(priceRow);
    }
    const direction = descending ? -1 : 1;
    rows.sort((left, right) => {
      const leftValue = sortValue(left, sort);
      const rightValue = sortValue(right, sort);
      if (leftValue !== rightValue) {
        return (leftValue < rightValue ? -1 : 1) * direction;
      }
      return left.personId < right.personId ? -1 : left.personId > right.personId ? 1 : 0;
    });
    const page = rows.slice(offset, offset + limit);
    if (sort !== 'cost') {
      page.forEach(priceRow);
    }
    for (const row of page) {
      const candidate = loaded.board.candidate(row.personId);
      if (candidate !== undefined) {
        row.why = valueWhy(candidate, weights);
      }
    }
    return {
      rows: page,
      total: rows.length,
      offset,
      limit,
      poolLeft: { wrestlers: loaded.board.wrestlersLeft, staff: loaded.board.staffLeft },
      cash,
      paysUpFront,
      runningCostMonthly:
        yours === undefined || roster === undefined
          ? null
          : runningCostsOf(
              read,
              tunables,
              yours,
              date,
              read.tables.employments.lookup(
                'byPromotionStatus',
                promotionStatusKey(yours, 'active'),
              ).length +
                Math.max(0, draft.settings.rosterTarget - roster.wrestlers) +
                Math.max(0, draft.settings.staffTarget - roster.staff),
            ).total,
      reserveMonths: tunables.get('draft.ai.reserveMonths'),
    };
  },
});

export const draftPreviewQuery = defineQuery('draft.preview', {
  args: z.strictObject({}),
  run: (ctx) => {
    const { read } = ctx;
    const draft = latestDraft(read);
    return {
      options: draftSettingsOf(read),
      draft:
        draft === null
          ? null
          : {
              draftId: draft.id,
              status: draft.status,
              settings: { ...draft.settings },
              level: { ...draft.level },
              promotions: draft.order.length,
              poolMix: mixView(draft),
              poolAtStart: draft.poolMix.reduce((sum, entry) => sum + entry.inPool, 0),
              sittingOut: draft.sitOut.length,
            },
      equalised: [...EQUALISED],
      notEqualised: [...NOT_EQUALISED],
    };
  },
});

export const draftQueries = [draftStateQuery, draftPoolQuery, draftPreviewQuery];
