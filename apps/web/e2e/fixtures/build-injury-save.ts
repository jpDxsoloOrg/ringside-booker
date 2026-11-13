/**
 * Writes `sample-injury.rbsave` next to this file: a new game on the shipped default world as the
 * player's flagship promotion, with off-screen injuries turned up to their highest rate, saved on
 * a day whose Next day hurts one of the player's own wrestlers. The own-injury e2e (WRK6-06) loads
 * it, presses Next day, sees the day stop on "Roster" and clears it from there, so a real injury
 * happens in the browser without the spec waiting through weeks of play.
 *
 * The engine is deterministic, so the builder finds that day by trying each next day on a copy:
 * a day that hurts nobody of the player's is kept and the next one tried, until one does. The
 * player's promotion is the computer's while trying, so its shows are booked and run and no show
 * night stops the days; it goes back to the player before the save is written.
 *
 * `npm run e2e` rebuilds it first (the `pree2e` script). Run with
 * `npx tsx e2e/fixtures/build-injury-save.ts` from `apps/web`.
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
const INJURY_SAVE_PATH = fileURLToPath(new URL('./sample-injury.rbsave', import.meta.url));

/** The slot label the save carries; its import gets " (imported)" added. */
export const INJURY_SAVE_LABEL = 'Injury save';
const PLAYER_ID = 'local-player';
const HUMAN: Controller = { kind: 'human', playerId: PLAYER_ID };
/** The highest off-screen rate the tunable allows. */
const INJURIES_PER_YEAR = 5;
/** Give up after this many days without an own injury (a broken engine, not bad luck). */
const MAX_DAYS = 60;
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

/** The same state with the given promotions and brands run by `controller`. */
function controlledBy(
  state: EngineState,
  ids: { promotions: ReadonlySet<string>; brands: ReadonlySet<string> },
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
          ids.promotions.has(row.id) ? { ...row, controller } : row,
        ),
        brands: brands.map((row) => (ids.brands.has(row.id) ? { ...row, controller } : row)),
      },
    },
  };
}

function engineOver(state: EngineState) {
  return createEngine({ state, systems: defaultSystems, host: { now: () => performance.now() } });
}

/** True when the player's next day hurts one of their own and stops on it. */
async function nextDayHurtsOwn(state: EngineState): Promise<boolean> {
  const engine = engineOver(state);
  const day = await engine.advanceDays({ maxDays: 1 });
  if (day.failures.length > 0) {
    throw new Error(`A day failed: ${JSON.stringify(day.failures)}`);
  }
  return engine.exportState().world.tables.injuries.some((injury) => injury.noticedOn === null);
}

async function buildInjurySave(): Promise<void> {
  const created = createNewGame([readContentPack('base'), readContentPack('worlds/default')], {
    rootPackId: 'default-world',
    seed: 'e2e-injury-save',
    playerId: PLAYER_ID,
    playerName: 'Alex Booker',
    saveName: INJURY_SAVE_LABEL,
    seasonLength: { preset: '6m' },
    player: { mode: 'existing', promotionKey: 'pro-flagship' },
    settings: {},
  });
  if (!created.ok) {
    throw new Error(`New game was refused: ${JSON.stringify(created.reasons)}`);
  }
  const isPlayers = (controller: Controller | null): boolean =>
    controller?.kind === 'human' && controller.playerId === PLAYER_ID;
  const { promotions, brands } = created.state.world.tables;
  const owned = {
    promotions: new Set(promotions.filter((row) => isPlayers(row.controller)).map((row) => row.id)),
    brands: new Set(brands.filter((row) => isPlayers(row.controller)).map((row) => row.id)),
  };

  const setup = engineOver(created.state);
  const set = setup.command(
    'tunables.setOverride',
    { key: 'health.offscreen.injuriesPerYear', value: INJURIES_PER_YEAR },
    HUMAN,
  );
  if (!set.ok) {
    throw new Error(`The injury rate was refused: ${JSON.stringify(set.reasons)}`);
  }
  let state = setup.exportState();

  for (let day = 0; day < MAX_DAYS; day += 1) {
    if (await nextDayHurtsOwn(state)) {
      const headerPromotionId = [...owned.promotions][0] ?? null;
      const doc = createSaveDocument(engineSaveState(state), {
        headerPromotionId,
        savedAt: SAVED_AT,
        label: INJURY_SAVE_LABEL,
        engineVersion: '0.1.0',
        schemaFingerprint: engineSaveSchemaFingerprint(),
      });
      const bytes = await encodeSave(doc);
      writeFileSync(INJURY_SAVE_PATH, bytes);
      process.stdout.write(
        `Wrote ${INJURY_SAVE_PATH} (${String(bytes.byteLength)} bytes, ` +
          `${state.world.meta.currentDate})\n`,
      );
      return;
    }
    // Nobody of the player's was hurt: play that day as the computer and try the next.
    const computerDay = engineOver(controlledBy(state, owned, { kind: 'computer' }));
    const played = await computerDay.advanceDays({ maxDays: 1 });
    if (played.daysAdvanced !== 1 || played.failures.length > 0) {
      throw new Error(`The computer's day stopped: ${JSON.stringify(played.stoppedBy)}`);
    }
    state = controlledBy(computerDay.exportState(), owned, HUMAN);
  }
  throw new Error(
    `No own injury in ${String(MAX_DAYS)} days at ${String(INJURIES_PER_YEAR)} a year`,
  );
}

await buildInjurySave();
