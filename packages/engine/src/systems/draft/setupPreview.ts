/**
 * The new-game wizard's previews for active promotions (DRF-06) and the draft (DRF-01, DRF-07),
 * before any game exists:
 *
 * - {@link previewPromotionPage}: the promotion picker's list, paged, searchable and filtered by
 *   country and size;
 * - {@link previewSetup}: the counts for a choice of active promotions ("12 active promotions, 380
 *   wrestlers") and, when "Start with a draft" is on, the draft's roster size, pool size, pool mix
 *   and level playing field, worked out by the same `planDraft` and `medianLevel` the new game uses.
 *
 * The packs are loaded once per pack set with the preview seed (like `previewWorld`) and the
 * per-person and per-promotion facts are memoised, so the wizard can ask on every change.
 *
 * Design: docs/design/draft.md#wizard-previews.
 */

import { z } from 'zod';
import type { PromotionId } from '../../core/ids';
import type { DraftLevel, DraftSettings } from '../../model/entities/draft';
import type { GameWorld, GameWorldView } from '../../model/tables';
import type { RawPack } from '../../persistence/packs/index';
import type { PackIssue, Result } from '../../persistence/packs/issues';
import { materialiseWorld } from '../../persistence/packs/materialise';
import { companySizeOf } from '../aip/companySize';
import { contentKeysById } from '../newgame/contentKeys';
import { mergePacks } from '../newgame/createNewGame';
import { PREVIEW_SEED } from '../newgame/preview';
import { resolveNewGameSettings } from '../newgame/settings';
import { createEngineTunables, type EngineTunables } from '../tunables';
import { geographyOf } from '../world/geography';
import { draftCandidates, type DraftCandidate } from './candidates';
import { EQUALISED, medianLevel, NOT_EQUALISED, withStartingCash } from './level';
import type { PoolMixLevel } from './pool';
import { draftOptionsFrom, startingCashOf, type DraftOptions } from './settings';
import { planDraft } from './setup';

/** One promotion in the picker. */
export interface PickerPromotion {
  key: string;
  name: string;
  shortName: string;
  color: string;
  logoRef: string | null;
  country: { key: string; name: string };
  region: { key: string; name: string };
  /** "Local" to "Global", or null when no size source is loaded. */
  size: string | null;
  /** 0-100, one decimal. */
  reach: number;
  prestige: number;
  /** Wrestlers under an active contract. */
  wrestlers: number;
  /** Staff under an active contract. */
  staff: number;
}

interface Basis {
  readonly world: GameWorld;
  readonly promotions: PickerPromotion[];
  readonly idByKey: ReadonlyMap<string, PromotionId>;
  readonly candidates: DraftCandidate[];
  readonly freeAgentWrestlers: number;
  readonly tunables: EngineTunables;
}

const BASIS_MEMO_SIZE = 2;
const memo = new Map<string, Basis>();

function memoKey(packs: readonly RawPack[], rootPackId: string): string {
  const versions = packs.map((pack) => `${pack.manifest.id}@${pack.manifest.version}`).sort();
  return `${rootPackId}|${versions.join(',')}`;
}

function one(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildBasis(packs: readonly RawPack[], rootPackId: string): Result<Basis> {
  const merged = mergePacks(packs, rootPackId);
  if (!merged.ok) {
    return { ok: false, issues: merged.issues };
  }
  const { content } = merged;
  if (content.startDate === null) {
    const issue: PackIssue = {
      severity: 'error',
      code: 'missing-start-date',
      packId: rootPackId,
      path: ['startDate'],
      message: `Pack "${rootPackId}" is not a world pack, so it has no start date`,
    };
    return { ok: false, issues: [issue] };
  }
  const materialised = materialiseWorld(content, {
    seed: PREVIEW_SEED,
    startDate: content.startDate,
  });
  if (!materialised.ok) {
    return { ok: false, issues: materialised.issues };
  }
  const { world } = materialised.value;
  const read: GameWorldView = world;
  const tunables = createEngineTunables();
  const geography = geographyOf(read);
  const promotionKeys = contentKeysById(world.meta, 'promotion');
  const regionKeys = contentKeysById(world.meta, 'region');
  const countryKeys = contentKeysById(world.meta, 'country');
  const idByKey = new Map<string, PromotionId>();
  const wrestlersOf = new Map<string, number>();
  const staffOf = new Map<string, number>();
  const employed = new Set<string>();
  for (const employment of read.tables.employments.values()) {
    if (employment.status !== 'active') {
      continue;
    }
    employed.add(employment.personId);
    const counter = employment.role === 'wrestler' ? wrestlersOf : staffOf;
    counter.set(employment.promotionId, (counter.get(employment.promotionId) ?? 0) + 1);
  }
  const promotions = read.tables.promotions
    .values()
    .filter((promotion) => promotion.status === 'active')
    .map((promotion): PickerPromotion => {
      const key = promotionKeys.get(promotion.id) ?? promotion.id;
      idByKey.set(key, promotion.id);
      const region = geography.region(promotion.homeRegionId);
      const country = geography.countryOf(promotion.homeRegionId);
      const size = companySizeOf(read, tunables, promotion.id);
      return {
        key,
        name: promotion.name,
        shortName: promotion.shortName,
        color: promotion.color,
        logoRef: promotion.logoRef ?? null,
        country: { key: countryKeys.get(country.id) ?? country.id, name: country.name },
        region: { key: regionKeys.get(region.id) ?? region.id, name: region.name },
        size: size?.label ?? null,
        reach: one(size?.reach ?? 0),
        prestige: promotion.prestige,
        wrestlers: wrestlersOf.get(promotion.id) ?? 0,
        staff: staffOf.get(promotion.id) ?? 0,
      };
    });
  const candidates = draftCandidates(read, tunables, {
    date: world.meta.startDate,
    draftStaff: true,
    onlyUnsigned: false,
  });
  const freeAgentWrestlers = candidates.filter(
    (candidate) => candidate.category === 'wrestler' && !employed.has(candidate.personId),
  ).length;
  return {
    ok: true,
    value: { world, promotions, idByKey, candidates, freeAgentWrestlers, tunables },
    issues: materialised.issues,
  };
}

function basisFor(packs: readonly RawPack[], rootPackId: string): Result<Basis> {
  const key = memoKey(packs, rootPackId);
  const cached = memo.get(key);
  if (cached !== undefined) {
    return { ok: true, value: cached, issues: [] };
  }
  const built = buildBasis(packs, rootPackId);
  if (built.ok) {
    memo.set(key, built.value);
    while (memo.size > BASIS_MEMO_SIZE) {
      const oldest = memo.keys().next();
      if (oldest.done === true) {
        break;
      }
      memo.delete(oldest.value);
    }
  }
  return built;
}

export const PICKER_SORTS = ['wrestlers', 'reach', 'prestige', 'name'] as const;
export type PickerSort = (typeof PICKER_SORTS)[number];

/**
 * The picker's arguments. `size` is a size label ("Local" to "Global"); `sort` defaults to
 * `wrestlers`, biggest first; `limit` defaults to 50, at most 500.
 */
export const PromotionPageArgsSchema = z.strictObject({
  search: z.string().max(60).optional(),
  countryKey: z.string().min(1).optional(),
  size: z.string().min(1).optional(),
  sort: z.enum(PICKER_SORTS).optional(),
  descending: z.boolean().optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export type PromotionPageArgs = z.output<typeof PromotionPageArgsSchema>;

export interface PromotionPage {
  rows: PickerPromotion[];
  /** Rows matching the filters. */
  total: number;
  offset: number;
  limit: number;
  /** Every country with a promotion, by name, with how many. For the filter. */
  countries: { key: string; name: string; count: number }[];
  /** Every size label present, smallest first, with how many. For the filter. */
  sizes: { label: string; count: number }[];
  /** Every promotion key, biggest first by wrestlers: "Only the biggest N" takes the first N. */
  biggestFirst: string[];
}

const SIZE_ORDER = ['Local', 'Regional', 'National', 'Continental', 'Global'];

function compareBy(sort: PickerSort): (a: PickerPromotion, b: PickerPromotion) => number {
  switch (sort) {
    case 'wrestlers':
      return (left, right) => left.wrestlers - right.wrestlers;
    case 'reach':
      return (left, right) => left.reach - right.reach;
    case 'prestige':
      return (left, right) => left.prestige - right.prestige;
    case 'name':
      return (left, right) =>
        left.name.toLowerCase() < right.name.toLowerCase()
          ? -1
          : left.name.toLowerCase() > right.name.toLowerCase()
            ? 1
            : 0;
  }
}

function byKey(left: PickerPromotion, right: PickerPromotion): number {
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

/** The promotion picker's page. */
export function previewPromotionPage(
  packs: readonly RawPack[],
  rootPackId: string,
  args: PromotionPageArgs = {},
): Result<PromotionPage> {
  const basis = basisFor(packs, rootPackId);
  if (!basis.ok) {
    return basis;
  }
  const { promotions } = basis.value;
  const search = args.search?.trim().toLowerCase() ?? '';
  const sort = args.sort ?? 'wrestlers';
  const descending = args.descending ?? sort !== 'name';
  const compare = compareBy(sort);
  const matching = promotions
    .filter(
      (row) =>
        (search === '' ||
          row.name.toLowerCase().includes(search) ||
          row.shortName.toLowerCase().includes(search)) &&
        (args.countryKey === undefined || row.country.key === args.countryKey) &&
        (args.size === undefined || row.size === args.size),
    )
    .sort(
      (left, right) =>
        (descending ? compare(right, left) : compare(left, right)) || byKey(left, right),
    );
  const offset = args.offset ?? 0;
  const limit = Math.min(500, Math.max(1, args.limit ?? 50));
  const countries = new Map<string, { key: string; name: string; count: number }>();
  const sizes = new Map<string, number>();
  for (const row of promotions) {
    const country = countries.get(row.country.key) ?? { ...row.country, count: 0 };
    country.count += 1;
    countries.set(row.country.key, country);
    if (row.size !== null) {
      sizes.set(row.size, (sizes.get(row.size) ?? 0) + 1);
    }
  }
  const biggest = [...promotions].sort(
    (left, right) =>
      right.wrestlers - left.wrestlers || right.reach - left.reach || byKey(left, right),
  );
  return {
    ok: true,
    value: {
      rows: matching.slice(offset, offset + limit).map((row) => ({ ...row })),
      total: matching.length,
      offset,
      limit,
      countries: [...countries.values()].sort((left, right) => (left.name < right.name ? -1 : 1)),
      sizes: [...sizes.entries()]
        .sort(([left], [right]) => SIZE_ORDER.indexOf(left) - SIZE_ORDER.indexOf(right))
        .map(([label, count]) => ({ label, count })),
      biggestFirst: biggest.map((row) => row.key),
    },
    issues: basis.issues,
  };
}

/**
 * The setup preview's arguments: `activePromotionKeys` (left out: every promotion),
 * `playerPromotionKey` (the promotion you take over, always active), `founding` (true when you
 * found a promotion, which drafts too) and `settings` (the new-game settings chosen so far).
 */
export const SetupPreviewArgsSchema = z.strictObject({
  activePromotionKeys: z.array(z.string().min(1)).optional(),
  playerPromotionKey: z.string().min(1).nullable().optional(),
  founding: z.boolean().optional(),
  settings: z.record(z.string(), z.union([z.boolean(), z.string()])).optional(),
});
export type SetupPreviewArgs = z.output<typeof SetupPreviewArgsSchema>;

export interface DraftSetupPreview {
  options: DraftOptions;
  settings: DraftSettings;
  /** Promotions drafting. */
  promotions: number;
  /** Wrestlers who can be drafted at all. */
  wrestlersAvailable: number;
  /** Wrestlers in the pool. */
  poolWrestlers: number;
  /** Wrestlers left out, who sit out. */
  sittingOut: number;
  /** Staff in the pool (0 unless staff are drafted). */
  poolStaff: number;
  mix: PoolMixLevel[];
  /** The level every promotion starts at. Cash in cents: the Starting cash setting's (DRF-10). */
  level: DraftLevel;
  /** The world median cash of the active promotions, in cents, whatever the setting says. */
  medianCash: number;
  /** The Starting cash setting: `median`, or the preset that set `level.cash`. */
  startingCash: DraftOptions['startingCash'];
  equalised: string[];
  notEqualised: string[];
}

export interface SetupPreview {
  promotions: { total: number; active: number; inactive: number };
  /** Your own promotion's key, always active; null when founding. */
  alwaysActive: string | null;
  wrestlers: {
    /** On the rosters of active promotions. */
    onActiveRosters: number;
    /** Free agents, including everyone from an inactive promotion. */
    freeAgents: number;
    total: number;
  };
  /** Keys in `activePromotionKeys` that are not in the world. */
  unknownKeys: string[];
  /** The draft, when "Start with a draft" is on. */
  draft: DraftSetupPreview | null;
}

/** Counts for a choice of active promotions, and the draft's plan when the draft is on. */
export function previewSetup(
  packs: readonly RawPack[],
  rootPackId: string,
  args: SetupPreviewArgs = {},
): Result<SetupPreview> {
  const basis = basisFor(packs, rootPackId);
  if (!basis.ok) {
    return basis;
  }
  const { world, promotions, idByKey, candidates, freeAgentWrestlers, tunables } = basis.value;
  const allKeys = promotions.map((row) => row.key);
  const chosen = new Set(args.activePromotionKeys ?? allKeys);
  const alwaysActive = args.founding === true ? null : (args.playerPromotionKey ?? null);
  if (alwaysActive !== null) {
    chosen.add(alwaysActive);
  }
  const unknownKeys = [...chosen].filter((key) => !idByKey.has(key)).sort();
  const active = promotions.filter((row) => chosen.has(row.key));
  const onActiveRosters = active.reduce((sum, row) => sum + row.wrestlers, 0);
  const totalWrestlers =
    promotions.reduce((sum, row) => sum + row.wrestlers, 0) + freeAgentWrestlers;
  const drafting = active.length + (args.founding === true ? 1 : 0);
  const options = draftOptionsFrom(resolveNewGameSettings(args.settings ?? {}));
  let draft: DraftSetupPreview | null = null;
  if (options.enabled && drafting > 0) {
    const pool = candidates.filter(
      (candidate) => options.draftStaff || candidate.category === 'wrestler',
    );
    const plan = planDraft(options, pool, drafting, tunables);
    const activeIds = new Set(active.map((row) => idByKey.get(row.key)));
    const median = medianLevel(
      world.tables.promotions.values().filter((promotion) => activeIds.has(promotion.id)),
      geographyOf(world),
    );
    const level = withStartingCash(median, startingCashOf(options.startingCash));
    draft = {
      options,
      settings: plan.settings,
      promotions: drafting,
      wrestlersAvailable: plan.wrestlers.length,
      poolWrestlers: plan.pool.pool.length,
      sittingOut: plan.pool.sitOut.length,
      poolStaff: plan.staff.length,
      mix: plan.pool.mix,
      level,
      medianCash: median.cash,
      startingCash: options.startingCash,
      equalised: [...EQUALISED],
      notEqualised: [...NOT_EQUALISED],
    };
  }
  return {
    ok: true,
    value: {
      promotions: {
        total: promotions.length,
        active: active.length + (args.founding === true ? 1 : 0),
        inactive: promotions.length - active.length,
      },
      alwaysActive,
      wrestlers: {
        onActiveRosters,
        freeAgents: totalWrestlers - onActiveRosters,
        total: totalWrestlers,
      },
      unknownKeys,
      draft,
    },
    issues: basis.issues,
  };
}
