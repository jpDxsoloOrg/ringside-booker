/**
 * `createNewGame`: the player's choices in, a ready engine state out.
 *
 * 1. Parse the input (`newGameInputSchema`) and check the parts that need no world: setting keys
 *    and values, custom season weeks and tunable overrides.
 * 2. Resolve and merge the packs, materialise the world (WLD-02) with the seed, the start date and
 *    the chosen settings, season length included, so the world already holds season 1.
 * 3. Check the choices that need the world: the promotion to take over, or the name, short name
 *    and home region of the one to found, and the start date against the pack's.
 * 4. Run every registered setup step in order (`steps.ts`); the first failure stops everything.
 * 5. Publish `world.created`, check the finished world, and build the SIM-10 `EngineState` with
 *    the RNG, tunable overrides, event log and traces as the setup left them.
 *
 * Nothing is thrown for bad input or bad packs: every refusal is a `Reason`. The function runs
 * before any engine exists, so it is a plain function rather than an engine command, but it keeps
 * the same rules: zod-parsed arguments, `Reason` failures and plain-JSON results. It never touches
 * storage: the host builds and stores the save from the returned state.
 *
 * See docs/design/new-game.md.
 */

import { invalidArgsReasons, type Reason } from '../../core/api/result';
import { assertSerialisable } from '../../core/api/serialisable';
import { initialEngineState, type EngineState } from '../../core/api/state';
import { addDays, compareDates, type GameDate } from '../../core/date';
import type { PromotionId } from '../../core/ids';
import type { StepReport } from '../../core/pipeline/report';
import { runStep } from '../../core/pipeline/runStep';
import { createRuntime, type SimRuntime } from '../../core/pipeline/runtime';
import { validateOverride } from '../../core/tunables/validate';
import { checkWorld } from '../../model/integrity';
import { TABLES, type GameWorld } from '../../model/tables';
import { WorldMetaSchema, type ContentPackRef } from '../../model/world-meta';
import type { RawPack } from '../../persistence/packs/index';
import { formatPackIssue, isError, type PackIssue } from '../../persistence/packs/issues';
import { buildContentLibrary } from '../../persistence/packs/library';
import { DEFAULT_SEASON_LENGTH_DAYS, materialiseWorld } from '../../persistence/packs/materialise';
import { mergeRecords, type MergedContent } from '../../persistence/packs/merge';
import { resolvePacks } from '../../persistence/packs/resolve';
import { ALL_TUNABLES, createEngineTunables } from '../tunables';
import './builtinSteps';
import './events';
import { contentIdOf } from './contentKeys';
import { newGameInputSchema, type NewGameInput } from './input';
import { resolveSeasonLength, seasonLengthReasons } from './season';
import {
  resolveNewGameSettings,
  settingReasons,
  worldSettingsFrom,
  type NewGameSettingValue,
} from './settings';
import { runSetupSteps, type NewGameSession } from './steps';

/** What the wizard shows once the game is ready. Plain JSON. */
export interface NewGameSummary {
  saveName: string;
  playerName: string;
  playerId: string;
  startDate: GameDate;
  season: { number: 1; startDate: GameDate; endDate: GameDate; lengthDays: number };
  /**
   * The promotion the player runs. The host passes `id` to `createSaveDocument` as
   * `headerPromotionId`.
   */
  promotion: { id: PromotionId; name: string; shortName: string; cash: number };
  counts: { promotions: number; people: number; freeAgents: number; titles: number };
  /** Every registered setting's value. */
  settings: Record<string, NewGameSettingValue>;
  /** The packs (and versions) the world was built from, in load order. */
  packVersions: ContentPackRef[];
}

/** The outcome of {@link createNewGame}. */
export type NewGameResult =
  | { ok: true; state: EngineState; summary: NewGameSummary }
  | {
      ok: false;
      reasons: Reason[];
      /** The report of the setup step that failed, when a step stopped new game. */
      report?: StepReport;
    };

/** The step id `world.created` is published from. */
export const WORLD_CREATED_STEP_ID = 'wld.worldCreated';

/** Reason codes `createNewGame` uses besides `invalidArgs` and the settings and season codes. */
export const NEW_GAME_REASON_CODES = {
  packIssue: 'packIssue',
  startDateBeforePack: 'startDateBeforePack',
  unknownPromotion: 'unknownPromotion',
  promotionInactive: 'promotionInactive',
  nameTaken: 'nameTaken',
  shortNameTaken: 'shortNameTaken',
  unknownRegion: 'unknownRegion',
  invalidTunableOverride: 'invalidTunableOverride',
  invalidWorld: 'invalidWorld',
} as const;

function packReasons(issues: readonly PackIssue[]): Reason[] {
  return issues.filter(isError).map((issue) => ({
    code: NEW_GAME_REASON_CODES.packIssue,
    message: formatPackIssue(issue),
  }));
}

function tunableOverrideReasons(overrides: Readonly<Record<string, number>> = {}): Reason[] {
  const reasons: Reason[] = [];
  for (const key of Object.keys(overrides).sort()) {
    const issue = validateOverride(ALL_TUNABLES, key, overrides[key]);
    if (issue !== null) {
      reasons.push({
        code: NEW_GAME_REASON_CODES.invalidTunableOverride,
        message: issue.message,
        field: `tunableOverrides.${key}`,
      });
    }
  }
  return reasons;
}

/** Resolves and merges the root pack and its dependencies. */
export function mergePacks(
  packs: readonly RawPack[],
  rootPackId: string,
): { ok: true; content: MergedContent } | { ok: false; issues: readonly PackIssue[] } {
  const resolved = resolvePacks(packs, [rootPackId]);
  if (!resolved.ok) {
    return { ok: false, issues: resolved.issues };
  }
  const merged = mergeRecords(resolved.value);
  if (!merged.ok) {
    return { ok: false, issues: [...resolved.issues, ...merged.issues] };
  }
  return { ok: true, content: merged.value };
}

function sameName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Checks the player's promotion choice against the loaded world. Returns the reasons and, in
 * `existing` mode, the chosen promotion's ID.
 */
function playerChoiceReasons(
  world: GameWorld,
  input: NewGameInput,
): { reasons: Reason[]; promotionId: PromotionId | null } {
  const choice = input.player;
  const promotions = world.tables.promotions;
  if (choice.mode === 'existing') {
    const promotionId = contentIdOf(world.meta, 'promotion', choice.promotionKey);
    const promotion = promotionId === null ? undefined : promotions.get(promotionId);
    if (promotion === undefined) {
      return {
        promotionId: null,
        reasons: [
          {
            code: NEW_GAME_REASON_CODES.unknownPromotion,
            message: `There is no promotion "${choice.promotionKey}" in this world.`,
            field: 'player.promotionKey',
          },
        ],
      };
    }
    if (promotion.status !== 'active') {
      return {
        promotionId: null,
        reasons: [
          {
            code: NEW_GAME_REASON_CODES.promotionInactive,
            message: `${promotion.name} is ${promotion.status}, so it cannot be chosen.`,
            field: 'player.promotionKey',
            subject: { kind: 'promotion', id: promotion.id },
          },
        ],
      };
    }
    return { reasons: [], promotionId: promotion.id };
  }

  const reasons: Reason[] = [];
  for (const promotion of promotions.values()) {
    if (sameName(promotion.name, choice.name)) {
      reasons.push({
        code: NEW_GAME_REASON_CODES.nameTaken,
        message: `The name "${choice.name}" is already used by ${promotion.name} (${promotion.shortName}).`,
        field: 'player.name',
        subject: { kind: 'promotion', id: promotion.id },
      });
    }
    if (sameName(promotion.shortName, choice.shortName)) {
      reasons.push({
        code: NEW_GAME_REASON_CODES.shortNameTaken,
        message: `The short name "${choice.shortName}" is already used by ${promotion.name}.`,
        field: 'player.shortName',
        subject: { kind: 'promotion', id: promotion.id },
      });
    }
  }
  if (contentIdOf(world.meta, 'region', choice.homeRegionKey) === null) {
    reasons.push({
      code: NEW_GAME_REASON_CODES.unknownRegion,
      message: `There is no region "${choice.homeRegionKey}" in this world.`,
      field: 'player.homeRegionKey',
    });
  }
  return { reasons, promotionId: null };
}

/** The setup runtime: the tunables are read from the session, so step 100 can replace them. */
function setupRuntime(
  loadedWorld: GameWorld,
  base: SimRuntime,
  session: NewGameSession,
): SimRuntime {
  return {
    world: loadedWorld,
    rng: base.rng,
    get tunables() {
      return session.tunables;
    },
    bus: base.bus,
    traces: base.traces,
    phases: base.phases,
    gates: base.gates,
    failureLog: base.failureLog,
    host: base.host,
    lastDayReport: null,
  };
}

function countFreeAgents(world: GameWorld): number {
  const employed = new Set<string>();
  for (const employment of world.tables.employments.values()) {
    if (employment.status === 'active' || employment.status === 'signed') {
      employed.add(employment.personId);
    }
  }
  return world.tables.people
    .values()
    .filter((person) => person.status === 'active' && !employed.has(person.id)).length;
}

/**
 * Starts a new game from `packs` and the wizard's `input`. Deterministic: the same packs and input
 * give the same state. Returns the engine state and a summary, or every reason the input was
 * refused; never a partial world.
 */
export function createNewGame(packs: readonly RawPack[], input: unknown): NewGameResult {
  const parsed = newGameInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reasons: invalidArgsReasons(parsed.error) };
  }
  const choices = parsed.data;

  const seasonReasons = seasonLengthReasons(choices.seasonLength);
  const reasons: Reason[] = [
    ...seasonReasons,
    ...settingReasons(choices.settings),
    ...tunableOverrideReasons(choices.tunableOverrides),
  ];
  const settings = resolveNewGameSettings(choices.settings);
  const seasonLengthDays =
    seasonReasons.length === 0
      ? resolveSeasonLength(choices.seasonLength)
      : DEFAULT_SEASON_LENGTH_DAYS;

  const merged = mergePacks(packs, choices.rootPackId);
  if (!merged.ok) {
    return { ok: false, reasons: [...reasons, ...packReasons(merged.issues)] };
  }
  const { content } = merged;
  const packStartDate = content.startDate;
  if (packStartDate === null) {
    return {
      ok: false,
      reasons: [
        ...reasons,
        {
          code: NEW_GAME_REASON_CODES.packIssue,
          message: `Pack "${choices.rootPackId}" is not a world pack, so it has no start date.`,
          field: 'rootPackId',
        },
      ],
    };
  }
  let startDate = choices.startDate ?? packStartDate;
  if (compareDates(startDate, packStartDate) < 0) {
    reasons.push({
      code: NEW_GAME_REASON_CODES.startDateBeforePack,
      message: `The game cannot start before the world's start date, ${packStartDate}.`,
      field: 'startDate',
    });
    // Keep checking the other choices against a world that does load.
    startDate = packStartDate;
  }

  const materialised = materialiseWorld(content, {
    seed: choices.seed,
    startDate,
    settings: worldSettingsFrom(settings, seasonLengthDays),
    worldName: choices.saveName,
  });
  if (!materialised.ok) {
    return { ok: false, reasons: [...reasons, ...packReasons(materialised.issues)] };
  }
  const { world, rng } = materialised.value;

  const choice = playerChoiceReasons(world, choices);
  reasons.push(...choice.reasons);
  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  const session: NewGameSession = {
    humanPromotionId: choice.promotionId,
    tunables: createEngineTunables(),
  };
  const runtime = setupRuntime(world, createRuntime({ world, rng }), session);
  const library = buildContentLibrary(content);
  const outcome = runSetupSteps(runtime, {
    input: choices,
    settings,
    startDate,
    seasonLengthDays,
    library,
    session,
  });
  if (!outcome.ok) {
    return { ok: false, reasons: outcome.reasons, report: outcome.report };
  }

  const humanPromotionId = session.humanPromotionId;
  if (humanPromotionId === null) {
    return {
      ok: false,
      reasons: [
        {
          code: NEW_GAME_REASON_CODES.invalidWorld,
          message: 'Setup finished without a promotion for the player.',
        },
      ],
    };
  }

  const announced = runStep(
    runtime,
    WORLD_CREATED_STEP_ID,
    { kind: 'phase', id: WORLD_CREATED_STEP_ID },
    (ctx) => {
      ctx.publish('world.created', {
        startDate,
        seasonLengthDays,
        promotionId: humanPromotionId,
        playerId: choices.playerId,
      });
    },
    { date: startDate, announceFailure: false },
  );
  if (announced.status === 'failed') {
    return {
      ok: false,
      reasons: [
        {
          code: NEW_GAME_REASON_CODES.invalidWorld,
          message: `Announcing the new world failed: ${announced.error?.message ?? 'unknown error'}`,
        },
      ],
      report: announced,
    };
  }

  const worldReasons = finishedWorldReasons(world);
  if (worldReasons.length > 0) {
    return { ok: false, reasons: worldReasons };
  }

  const state: EngineState = {
    ...initialEngineState(world),
    rng: runtime.rng.toState(),
    tunableOverrides: { ...session.tunables.overrides },
    traces: runtime.traces.toState(),
    events: runtime.bus.toState(),
    failureLog: runtime.failureLog.toState(),
  };
  const summary = summarise(world, choices, humanPromotionId, settings, seasonLengthDays);
  assertSerialisable(summary, 'createNewGame.summary');
  assertSerialisable(state, 'createNewGame.state');
  return { ok: true, state, summary };
}

/** Problems with the finished world: bad metadata or a failed integrity check. */
function finishedWorldReasons(world: GameWorld): Reason[] {
  const reasons: Reason[] = [];
  const meta = WorldMetaSchema.safeParse(world.meta);
  if (!meta.success) {
    for (const issue of meta.error.issues) {
      reasons.push({
        code: NEW_GAME_REASON_CODES.invalidWorld,
        message: `World metadata ${issue.path.join('.')}: ${issue.message}`,
      });
    }
  }
  const report = checkWorld(world, TABLES);
  if (!report.ok) {
    for (const issue of report.issues) {
      if (issue.severity !== 'warning') {
        reasons.push({
          code: NEW_GAME_REASON_CODES.invalidWorld,
          message: `${issue.table}${issue.id === undefined ? '' : ` ${issue.id}`}: ${issue.code}: ${issue.message}`,
        });
      }
    }
  }
  return reasons;
}

function summarise(
  world: GameWorld,
  input: NewGameInput,
  promotionId: PromotionId,
  settings: Readonly<Record<string, NewGameSettingValue>>,
  seasonLengthDays: number,
): NewGameSummary {
  const promotion = world.tables.promotions.require(promotionId);
  const { startDate } = world.meta;
  return {
    saveName: input.saveName,
    playerName: input.playerName,
    playerId: input.playerId,
    startDate,
    season: {
      number: 1,
      startDate,
      endDate: addDays(startDate, seasonLengthDays - 1),
      lengthDays: seasonLengthDays,
    },
    promotion: {
      id: promotion.id,
      name: promotion.name,
      shortName: promotion.shortName,
      cash: promotion.cash,
    },
    counts: {
      promotions: world.tables.promotions.ids().length,
      people: world.tables.people.ids().length,
      freeAgents: countFreeAgents(world),
      titles: world.tables.titles.ids().length,
    },
    settings: { ...settings },
    packVersions: world.meta.contentPacks.map((pack) => ({ id: pack.id, version: pack.version })),
  };
}
