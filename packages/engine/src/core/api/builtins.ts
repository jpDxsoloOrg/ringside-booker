/**
 * The engine's own system bundle, `simSystem`: the queries every screen and tool needs whatever
 * game systems are loaded, and the commands that change tunable overrides.
 *
 * Queries: `clock.get`, `sim.status`, `sim.pendingGates`, `sim.lastDayReport`, `sim.recentEvents`,
 * `sim.failures`, `sim.commandLog`, `trace.get`, `tunables.list`.
 * Commands: `tunables.setOverride`, `tunables.clearOverride`.
 *
 * `sim.status` and `sim.pendingGates` are what the top bar reads: the date, the season, the
 * viewer's promotion at a glance, and whether Next Day would stop right now ("Go to show",
 * "2 decisions waiting"). Later epics that add richer status (a population-weighted popularity
 * roll-up, morale) extend these queries or add their own.
 */

import { z } from 'zod';
import { ACTIVE_SEASON_KEY } from '../../model/entities/season';
import type { GameWorldView } from '../../model/tables';
import { ALL_TUNABLES, type TunableKey } from '../../systems/tunables';
import { diffDays, weekday, type GameDate, type Weekday } from '../date';
import type { AnyDomainEvent } from '../events/types';
import type { PromotionId, RegionId } from '../ids';
import type { Cents } from '../money';
import type { PipelineFailure } from '../pipeline/failureLog';
import type { GateHit } from '../pipeline/gates';
import type { DayReport } from '../pipeline/report';
import { startCalc } from '../trace/calc';
import { TRACE_REF_KIND_PATTERN, type StoredTraceEntry, type TraceRef } from '../trace/store';
import type { TraceNode } from '../trace/types';
import type { TunableRawValue } from '../tunables/define';
import { describeTunables, type TunableRow } from '../tunables/describe';
import { validateOverride } from '../tunables/validate';
import { defineCommand } from './command';
import type { CommandLogEntry } from './commandLog';
import { viewerPromotionIds, type Controller } from './controller';
import { defineQuery } from './query';
import type { Reason } from './result';
import { defineSystem } from './system';

/** The arguments of a query or command that takes none: always `{}`. */
export type NoArgs = Record<string, never>;

/** `clock.get`: today. */
export interface ClockView {
  date: GameDate;
  /** 0 = Monday .. 6 = Sunday. */
  weekday: Weekday;
  /** Day 1 is the world's start date. */
  dayNumber: number;
}

/**
 * The trace kind that explains a promotion's cash balance (id: the promotion id). The finance
 * system writes it; the core owns the string so `sim.status` never imports a system.
 */
export const CASH_TRACE_KIND = 'finance.cash';

/** The viewer's promotion at a glance, read straight from its row. */
export interface PromotionStatus {
  promotionId: PromotionId;
  name: string;
  /** Two to eight uppercase letters or digits, for the crest monogram and tight spaces. */
  shortName: string;
  cash: Cents;
  /**
   * The stored trace explaining the cash ("Cash on 1 January + this month's income and costs by
   * category = cash now"), or null before the finance system has recorded one.
   */
  cashTraceRef: TraceRef | null;
  popularity: {
    homeRegionId: RegionId;
    /** Popularity in the home region, 0-100 (0 when the region has none). */
    homeRegion: number;
    prestige: number;
    /** The stored trace behind the popularity figure, once a popularity system records one. */
    traceRef: TraceRef | null;
    /**
     * Built on the spot while no popularity system records a trace: where today's figure comes
     * from, so the top bar's Why? has something true to say (UI-19).
     */
    trace: TraceNode;
  };
}

/** `sim.status`: what the top bar shows. */
export interface SimStatus {
  date: GameDate;
  /** The active season, or null before the first season exists. */
  season: { number: number; endDate: GameDate } | null;
  /**
   * The first promotion the viewer runs, or null for the omniscient viewer, a computer
   * controller, or a human who runs no promotion.
   */
  promotion: PromotionStatus | null;
}

/** `sim.pendingGates`: why Next Day would stop today, if it would. */
export interface PendingGates {
  date: GameDate;
  /** Empty when Next Day would simulate today. */
  hits: GateHit[];
}

/** What the tunable commands return: the key and its override (null when back to the default). */
export interface TunableChange {
  key: string;
  value: TunableRawValue | null;
}

declare module './maps' {
  interface QueryMap {
    'clock.get': { args: NoArgs; result: ClockView };
    'sim.status': { args: NoArgs; result: SimStatus };
    'sim.pendingGates': { args: NoArgs; result: PendingGates };
    'sim.lastDayReport': { args: NoArgs; result: DayReport | null };
    'sim.recentEvents': { args: { limit: number; types?: string[] }; result: AnyDomainEvent[] };
    'sim.failures': { args: { limit: number }; result: PipelineFailure[] };
    'sim.commandLog': { args: { limit: number }; result: CommandLogEntry[] };
    'trace.get': { args: { ref: TraceRef }; result: StoredTraceEntry | null };
    'tunables.list': { args: { category?: string }; result: TunableRow[] };
  }
  interface CommandMap {
    'tunables.setOverride': {
      args: { key: string; value: TunableRawValue };
      result: TunableChange;
    };
    'tunables.clearOverride': { args: { key: string }; result: TunableChange };
  }
}

/** The most entries a list query returns in one call. */
export const MAX_LIST_LIMIT = 10_000;

const noArgs: z.ZodType<NoArgs> = z.strictObject({});
const limitSchema = z.number().int().min(0).max(MAX_LIST_LIMIT);

function isTunableKey(key: string): key is TunableKey {
  return Object.hasOwn(ALL_TUNABLES, key);
}

/**
 * Who may change tunables. In a world with players, only a human listed in `meta.players`; a world
 * with no players (a headless run, a sandbox being set up) lets any controller. This is the
 * single-player rule; the modding and multiplayer epics can tighten it (for example to the host
 * of an online game).
 */
function tunablePermission(read: GameWorldView, issuedBy: Controller): Reason[] {
  if (read.meta.players.length === 0) {
    return [];
  }
  if (
    issuedBy.kind === 'human' &&
    read.meta.players.some((player) => player.playerId === issuedBy.playerId)
  ) {
    return [];
  }
  return [{ code: 'notAllowed', message: 'Only a player in this game can change tunables.' }];
}

const clockGet = defineQuery('clock.get', {
  args: noArgs,
  run: (ctx) => ({
    date: ctx.date,
    weekday: weekday(ctx.date),
    dayNumber: diffDays(ctx.read.meta.startDate, ctx.date) + 1,
  }),
});

/** Why the home-region popularity reads what it does, before any system moves it. */
function homePopularityTrace(value: number, regionName: string | undefined): TraceNode {
  const where = regionName ?? 'your home region';
  return startCalc(`Popularity in ${where}`, value, {
    startLabel: 'Starting popularity from the world you began in',
  })
    .note('Nothing moves popularity yet. Shows, results and news will once those systems exist.')
    .done().trace;
}

const simStatus = defineQuery('sim.status', {
  args: noArgs,
  run: (ctx) => {
    const season = ctx.read.tables.seasons.lookupOne('activeSeason', ACTIVE_SEASON_KEY);
    const [promotionId] = viewerPromotionIds(ctx.read, ctx.viewer);
    const promotion =
      promotionId === undefined ? undefined : ctx.read.tables.promotions.get(promotionId);
    const homeRegion =
      promotion === undefined ? undefined : ctx.read.tables.regions.get(promotion.homeRegionId);
    const homePopularity =
      promotion === undefined ? 0 : (promotion.regionalPop[promotion.homeRegionId] ?? 0);
    const cashRef: TraceRef | null =
      promotion === undefined ? null : { kind: CASH_TRACE_KIND, id: promotion.id };
    return {
      date: ctx.date,
      season: season === undefined ? null : { number: season.number, endDate: season.endDate },
      promotion:
        promotion === undefined
          ? null
          : {
              promotionId: promotion.id,
              name: promotion.name,
              shortName: promotion.shortName,
              cash: promotion.cash,
              cashTraceRef: cashRef !== null && ctx.traces.has(cashRef) ? cashRef : null,
              popularity: {
                homeRegionId: promotion.homeRegionId,
                homeRegion: homePopularity,
                prestige: promotion.prestige,
                traceRef: null,
                trace: homePopularityTrace(homePopularity, homeRegion?.name),
              },
            },
    };
  },
});

const pendingGates = defineQuery('sim.pendingGates', {
  args: noArgs,
  run: (ctx) => ({ date: ctx.date, hits: ctx.gates(ctx.date) }),
});

const lastDayReport = defineQuery('sim.lastDayReport', {
  args: noArgs,
  run: (ctx) => ctx.lastDayReport,
});

const recentEvents = defineQuery('sim.recentEvents', {
  args: z.strictObject({
    limit: limitSchema,
    types: z.array(z.string()).exactOptional(),
  }),
  run: (ctx, args) => {
    if (args.limit === 0) {
      return [];
    }
    const wanted = args.types === undefined ? null : new Set(args.types);
    return ctx.events
      .recent()
      .filter((event) => wanted === null || wanted.has(event.type))
      .slice(-args.limit);
  },
});

const failures = defineQuery('sim.failures', {
  args: z.strictObject({ limit: limitSchema }),
  run: (ctx, args) => ctx.failures(args.limit),
});

const commandLogQuery = defineQuery('sim.commandLog', {
  args: z.strictObject({ limit: limitSchema }),
  run: (ctx, args) => ctx.commands(args.limit),
});

const traceGet = defineQuery('trace.get', {
  args: z.strictObject({
    ref: z.strictObject({
      kind: z.string().regex(TRACE_REF_KIND_PATTERN, {
        error: 'must be a trace kind such as "segment.rating"',
      }),
      id: z.string().min(1),
    }),
  }),
  run: (ctx, args) => ctx.traces.get(args.ref) ?? null,
});

const tunablesList = defineQuery('tunables.list', {
  args: z.strictObject({ category: z.string().exactOptional() }),
  run: (ctx, args) =>
    describeTunables(ctx.tunables, args.category === undefined ? {} : { category: args.category }),
});

const setOverride = defineCommand('tunables.setOverride', {
  args: z.strictObject({
    key: z.string().min(1),
    value: z.union([z.number(), z.boolean(), z.string()]),
  }),
  validate: (read, args, issuedBy) => {
    const denied = tunablePermission(read, issuedBy);
    if (denied.length > 0) {
      return denied;
    }
    const issue = validateOverride(ALL_TUNABLES, args.key, args.value);
    if (issue === null) {
      return [];
    }
    return [
      {
        code: issue.problem,
        message: issue.message,
        field: issue.problem === 'unknownKey' ? 'key' : 'value',
      },
    ];
  },
  apply: (ctx, args) => {
    ctx.tunableOverrides.set(args.key, args.value);
    ctx.publish('tunables.changed', { key: args.key, value: args.value });
    return { key: args.key, value: args.value };
  },
});

const clearOverride = defineCommand('tunables.clearOverride', {
  args: z.strictObject({ key: z.string().min(1) }),
  validate: (read, args, issuedBy) => {
    const denied = tunablePermission(read, issuedBy);
    if (denied.length > 0) {
      return denied;
    }
    if (!isTunableKey(args.key)) {
      return [
        {
          code: 'unknownKey',
          message: `There is no tunable called "${args.key}".`,
          field: 'key',
        },
      ];
    }
    return [];
  },
  apply: (ctx, args) => {
    if (isTunableKey(args.key) && ctx.tunables.isOverridden(args.key)) {
      ctx.tunableOverrides.clear(args.key);
      ctx.publish('tunables.changed', { key: args.key, value: null });
    }
    return { key: args.key, value: null };
  },
});

/** The engine's own bundle. Always pass it to `createEngine` (it is first in `defaultSystems`). */
export const simSystem = defineSystem({
  id: 'sim',
  queries: [
    clockGet,
    simStatus,
    pendingGates,
    lastDayReport,
    recentEvents,
    failures,
    commandLogQuery,
    traceGet,
    tunablesList,
  ],
  commands: [setOverride, clearOverride],
});
