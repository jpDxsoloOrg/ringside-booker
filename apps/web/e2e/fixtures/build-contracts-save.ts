/**
 * Writes `sample-contracts.rbsave` next to this file: a new game on the shipped default world as
 * the player's flagship promotion (Altura), saved on the day two of its lower-card wrestlers ask
 * to leave. The contracts e2e (ECO4-06) loads it and answers one request with Refuse and the other
 * with Grant, in the browser.
 *
 * Why a built save: nothing lowers morale in a new game yet (WRK8 brings that), so nobody becomes
 * unhappy by playing. The builder sets Worker patience to Restless (morale −15 or lower for 3
 * days, through `tunables.setOverride`, so the Rules sheet reads Restless) and writes a low morale
 * straight onto the two contracts; the engine's own daily phase then runs the unhappy clock and
 * raises the requests, and the save is written when the request stop holds the day.
 *
 * The player's show nights would stop the days on the way, so those days are played with the
 * promotion handed to the computer booker (as `build-played-save.ts` does). The morale drop starts
 * on the first day after that a run of human days long enough for the clock lies ahead, so the
 * request is raised on a day the player runs (a computer promotion answers its own requests).
 *
 * `npm run e2e` rebuilds it first (the `pree2e` script). Run with
 * `npx tsx e2e/fixtures/build-contracts-save.ts` from `apps/web`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createEngine,
  createNewGame,
  createSaveDocument,
  defaultSystems,
  encodeSave,
  engineSaveSchemaFingerprint,
  engineSaveState,
  packManifestSchema,
  RECORD_KINDS,
  type Controller,
  type Engine,
  type EngineState,
  type RawPack,
  type RecordKind,
} from '@ringside/engine';

const CONTENT_ROOT = fileURLToPath(new URL('../../../../content/', import.meta.url));
const CONTRACTS_SAVE_PATH = fileURLToPath(new URL('./sample-contracts.rbsave', import.meta.url));

/** The slot label the save carries; its import gets " (imported)" added. */
export const CONTRACTS_SAVE_LABEL = 'Contracts save';
const PLAYER_ID = 'local-player';
const HUMAN: Controller = { kind: 'human', playerId: PLAYER_ID };
const PLAYER_VIEW = { kind: 'controller', controller: HUMAN } as const;
/** The Rules sheet's Restless preset (`patiencePresets.ts`). */
const RESTLESS = { 'contracts.quit.threshold': -15, 'contracts.quit.days': 3 } as const;
/** Well under the Restless threshold, and under the recover line after a refusal. */
const LOW_MORALE = -60;
/** How many workers ask to leave: one to refuse, one to grant. */
const UNHAPPY_WORKERS = 2;
/** The release-request stop's route hint (the engine's `CONTRACTS_ACTION_HINT`). */
const CONTRACTS_HINT = 'contracts';
/** Give up after this many days (a broken engine, not bad luck). */
const MAX_DAYS = 30;
const SAVED_AT = '2026-01-01T00:00:00.000Z';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readContentPack(folder: string): RawPack {
  const packRoot = `${CONTENT_ROOT}${folder}/`;
  const manifest = packManifestSchema.parse(readJson(`${packRoot}pack.json`));
  const files: Partial<Record<RecordKind, unknown>> = {};
  for (const kind of RECORD_KINDS) {
    const file = manifest.files[kind];
    if (file !== undefined) {
      files[kind] = readJson(`${packRoot}${file}`);
    }
  }
  return { manifest, files };
}

function engineOver(state: EngineState): Engine {
  return createEngine({ state, systems: defaultSystems, host: { now: () => performance.now() } });
}

/** The same state with the player's promotion and its brands run by `controller`. */
function controlledBy(
  state: EngineState,
  promotionId: string,
  controller: Controller,
): EngineState {
  const { promotions, brands } = state.world.tables;
  return {
    ...state,
    world: {
      ...state.world,
      tables: {
        ...state.world.tables,
        promotions: promotions.map((row) =>
          row.id === promotionId ? { ...row, controller } : row,
        ),
        brands: brands.map((row) =>
          row.promotionId === promotionId ? { ...row, controller } : row,
        ),
      },
    },
  };
}

/** The same state with `morale` written on the given contracts. */
function withMorale(state: EngineState, ids: ReadonlySet<string>, morale: number): EngineState {
  return {
    ...state,
    world: {
      ...state.world,
      tables: {
        ...state.world.tables,
        employments: state.world.tables.employments.map((row) =>
          ids.has(row.id) ? { ...row, morale } : row,
        ),
      },
    },
  };
}

/** True when the player can run `days` days in a row from `state` with nothing stopping them. */
async function humanDaysAhead(state: EngineState, days: number): Promise<boolean> {
  const engine = engineOver(state);
  const run = await engine.advanceDays({ maxDays: days });
  return run.daysAdvanced === days && run.failures.length === 0;
}

/** Plays one day; the player's show night is played by the computer booker. */
async function playDay(state: EngineState, promotionId: string): Promise<EngineState> {
  const human = engineOver(state);
  const day = await human.advanceDays({ maxDays: 1 });
  if (day.daysAdvanced === 1 && day.failures.length === 0) return human.exportState();
  const computer = engineOver(controlledBy(state, promotionId, { kind: 'computer' }));
  const played = await computer.advanceDays({ maxDays: 1 });
  if (played.daysAdvanced !== 1 || played.failures.length > 0) {
    throw new Error(`The computer's day stopped: ${JSON.stringify(played.stoppedBy)}`);
  }
  return controlledBy(computer.exportState(), promotionId, HUMAN);
}

/** True when the player's day is held by release requests and nothing else. */
function stoppedByRequests(engine: Engine): boolean {
  const gates = engine.query('sim.pendingGates', {}, PLAYER_VIEW);
  return (
    gates.ok &&
    gates.data.hits.length > 0 &&
    gates.data.hits.every((hit) => hit.actionHint === CONTRACTS_HINT)
  );
}

async function buildContractsSave(): Promise<void> {
  const created = createNewGame([readContentPack('base'), readContentPack('worlds/default')], {
    rootPackId: 'default-world',
    seed: 'e2e-contracts-save',
    playerId: PLAYER_ID,
    playerName: 'Alex Booker',
    saveName: CONTRACTS_SAVE_LABEL,
    seasonLength: { preset: '6m' },
    player: { mode: 'existing', promotionKey: 'pro-flagship' },
    settings: {},
  });
  if (!created.ok) {
    throw new Error(`New game was refused: ${JSON.stringify(created.reasons)}`);
  }
  const promotion = created.state.world.tables.promotions.find(
    (row) => row.controller.kind === 'human' && row.controller.playerId === PLAYER_ID,
  );
  if (promotion === undefined) throw new Error('The player runs no promotion');

  const setup = engineOver(created.state);
  for (const [key, value] of Object.entries(RESTLESS)) {
    const set = setup.command('tunables.setOverride', { key, value }, HUMAN);
    if (!set.ok) throw new Error(`${key} was refused: ${JSON.stringify(set.reasons)}`);
  }
  const listed = setup.query('contracts.list', { tab: 'active' }, PLAYER_VIEW);
  if (!listed.ok) throw new Error(`contracts.list failed: ${JSON.stringify(listed.reasons)}`);
  // Lower-card wrestlers without a title, in id order: cheap to let go, never a champion.
  const unhappy = new Set(
    listed.data
      .filter((row) => row.role === 'wrestler' && row.push === 'lowerCard')
      .filter((row) => row.titles.length === 0 && row.endsOn !== null)
      .map((row) => row.employmentId)
      .sort()
      .slice(0, UNHAPPY_WORKERS),
  );
  if (unhappy.size < UNHAPPY_WORKERS) throw new Error('Too few lower-card wrestlers');

  // The clock needs `quit.days` days, and the request is raised on the day after the last one.
  const clockDays = RESTLESS['contracts.quit.days'] + 1;
  let state = setup.exportState();
  let low = false;
  for (let day = 0; day < MAX_DAYS; day += 1) {
    if (!low && (await humanDaysAhead(state, clockDays))) {
      state = withMorale(state, unhappy, LOW_MORALE);
      low = true;
    }
    if (low) {
      const engine = engineOver(state);
      if (stoppedByRequests(engine)) {
        const counts = engine.query('contracts.counts', {}, PLAYER_VIEW);
        if (!counts.ok || counts.data.wantsToLeave !== UNHAPPY_WORKERS) {
          throw new Error(
            `Expected ${String(UNHAPPY_WORKERS)} requests: ${JSON.stringify(counts)}`,
          );
        }
        const doc = createSaveDocument(engineSaveState(state), {
          headerPromotionId: promotion.id,
          savedAt: SAVED_AT,
          label: CONTRACTS_SAVE_LABEL,
          engineVersion: '0.1.0',
          schemaFingerprint: engineSaveSchemaFingerprint(),
        });
        const bytes = await encodeSave(doc);
        writeFileSync(CONTRACTS_SAVE_PATH, bytes);
        process.stdout.write(
          `Wrote ${CONTRACTS_SAVE_PATH} (${String(bytes.byteLength)} bytes, ` +
            `${state.world.meta.currentDate})\n`,
        );
        return;
      }
      const run = await engine.advanceDays({ maxDays: 1 });
      if (run.daysAdvanced !== 1 || run.failures.length > 0) {
        throw new Error(`The day stopped before the requests: ${JSON.stringify(run.stoppedBy)}`);
      }
      state = engine.exportState();
    } else {
      state = await playDay(state, promotion.id);
    }
  }
  throw new Error(`No release requests in ${String(MAX_DAYS)} days`);
}

await buildContractsSave();
