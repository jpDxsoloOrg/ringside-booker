/**
 * Writes `sample-played.rbsave` next to this file: a new game on the shipped default world, played
 * for three in-game weeks, so the phone layout checks see real tables (results, ledgers, news,
 * contracts, a filled calendar) rather than the tiny golden save. `npm run e2e` rebuilds it first
 * (the `pree2e` script), so it always matches the engine in this checkout.
 *
 * Headless runs have nobody to book the player's shows, so for the weeks of play the player's
 * promotion is handed to the computer booker, which books and runs its shows like any rival's.
 * The promotion goes back to the player for the last day, so the save loads as the player's own
 * game with three weeks of booked and run shows behind it, and a cash Why? that ends at the cash.
 *
 * Run with `npx tsx e2e/fixtures/build-played-save.ts` from `apps/web`.
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
  type EngineState,
  type RawPack,
  type RecordKind,
} from '@ringside/engine';

const CONTENT_ROOT = fileURLToPath(new URL('../../../../content/', import.meta.url));
const PLAYED_SAVE_PATH = fileURLToPath(new URL('./sample-played.rbsave', import.meta.url));

/** The slot label the played save carries, and so the label its import gets a suffix on. */
export const PLAYED_SAVE_LABEL = 'Played save';
const PLAYER_ID = 'local-player';
const PLAYED_DAYS = 21;
/** A fixed timestamp, so the file only changes when the engine does. */
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

function isPlayers(controller: Controller | null): boolean {
  return controller?.kind === 'human' && controller.playerId === PLAYER_ID;
}

/** The same state with every promotion and brand the player runs given to `controller`. */
function withPlayerRowsControlledBy(state: EngineState, controller: Controller): EngineState {
  const { promotions, brands } = state.world.tables;
  return {
    ...state,
    world: {
      ...state.world,
      tables: {
        ...state.world.tables,
        promotions: promotions.map((row) =>
          isPlayers(row.controller) ? { ...row, controller } : row,
        ),
        brands: brands.map((row) => (isPlayers(row.controller) ? { ...row, controller } : row)),
      },
    },
  };
}

/** Ids of the rows the player runs, so they can be handed back after the computer's weeks. */
function playerRowIds(state: EngineState) {
  const { promotions, brands } = state.world.tables;
  return {
    promotions: new Set(promotions.filter((row) => isPlayers(row.controller)).map((row) => row.id)),
    brands: new Set(brands.filter((row) => isPlayers(row.controller)).map((row) => row.id)),
  };
}

async function buildPlayedSave(): Promise<void> {
  const created = createNewGame([readContentPack('base'), readContentPack('worlds/default')], {
    rootPackId: 'default-world',
    seed: 'e2e-played-save',
    playerId: PLAYER_ID,
    playerName: 'Alex Booker',
    saveName: PLAYED_SAVE_LABEL,
    seasonLength: { preset: '6m' },
    player: { mode: 'existing', promotionKey: 'pro-flagship' },
    settings: {},
  });
  if (!created.ok) {
    throw new Error(`New game was refused: ${JSON.stringify(created.reasons)}`);
  }
  const owned = playerRowIds(created.state);
  const human: Controller = { kind: 'human', playerId: PLAYER_ID };

  const engine = createEngine({
    state: withPlayerRowsControlledBy(created.state, { kind: 'computer' }),
    systems: defaultSystems,
    host: { now: () => performance.now() },
  });
  const advanced = await engine.advanceDays({ maxDays: PLAYED_DAYS - 1 });
  if (advanced.daysAdvanced !== PLAYED_DAYS - 1 || advanced.failures.length > 0) {
    throw new Error(
      `The played weeks stopped early: ${JSON.stringify(advanced.stoppedBy)}, ` +
        `${String(advanced.failures.length)} failed steps`,
    );
  }

  const played = engine.exportState();
  const { promotions, brands } = played.world.tables;
  const handedBack: EngineState = {
    ...played,
    world: {
      ...played.world,
      tables: {
        ...played.world.tables,
        promotions: promotions.map((row) =>
          owned.promotions.has(row.id) ? { ...row, controller: human } : row,
        ),
        brands: brands.map((row) =>
          owned.brands.has(row.id) ? { ...row, controller: human } : row,
        ),
      },
    },
  };

  // The last day is the player's own: the computer never rewrites the cash Why?, and a stale one
  // is not shown, so a day of the player's own money brings it up to date.
  const playerEngine = createEngine({
    state: handedBack,
    systems: defaultSystems,
    host: { now: () => performance.now() },
  });
  const lastDay = await playerEngine.advanceDays({ maxDays: 1 });
  if (lastDay.daysAdvanced !== 1 || lastDay.failures.length > 0) {
    throw new Error(
      `The player's day stopped early: ${JSON.stringify(lastDay.stoppedBy)}, ` +
        `${String(lastDay.failures.length)} failed steps`,
    );
  }
  const final = playerEngine.exportState();
  const headerPromotionId = [...owned.promotions][0] ?? null;

  const doc = createSaveDocument(engineSaveState(final), {
    headerPromotionId,
    savedAt: SAVED_AT,
    label: PLAYED_SAVE_LABEL,
    engineVersion: '0.1.0',
    schemaFingerprint: engineSaveSchemaFingerprint(),
  });
  const bytes = await encodeSave(doc);
  writeFileSync(PLAYED_SAVE_PATH, bytes);
  process.stdout.write(
    `Wrote ${PLAYED_SAVE_PATH} (${String(bytes.byteLength)} bytes, ` +
      `${final.world.meta.currentDate})\n`,
  );
}

await buildPlayedSave();
