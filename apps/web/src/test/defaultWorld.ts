/**
 * A new game on the shipped default world, read from `content/` the way the tools read it, for
 * tests that check the player's words against real data (the Match lab's owner-test scripts).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createEngine,
  createNewGame,
  defaultSystems,
  packManifestSchema,
  RECORD_KINDS,
} from '@ringside/engine';
import type { Engine, RawPack, RecordKind, Viewer } from '@ringside/engine';

// A path, not a URL: under jsdom the URL class is not the one node:fs accepts.
const CONTENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../content');

export const DEFAULT_WORLD_PLAYER_ID = 'local-player';
/** Altura Wrestling Entertainment, the promotion the owner-test scripts play. */
export const DEFAULT_WORLD_PROMOTION_KEY = 'pro-flagship';
export const DEFAULT_WORLD_PROMOTION_NAME = 'Altura Wrestling Entertainment';
export const DEFAULT_WORLD_VIEWER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: DEFAULT_WORLD_PLAYER_ID },
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Reads a shipped pack the way the tools do: its manifest and every file the manifest lists. */
export function readContentPack(folder: string): RawPack {
  const packRoot = join(CONTENT_ROOT, folder);
  const manifest = packManifestSchema.parse(readJson(join(packRoot, 'pack.json')));
  const files: Partial<Record<RecordKind, unknown>> = {};
  for (const kind of RECORD_KINDS) {
    const file = manifest.files[kind];
    if (file !== undefined) {
      files[kind] = readJson(join(packRoot, file));
    }
  }
  return { manifest, files };
}

/** A new game on the default world, playing Altura, before any day has run. */
export function startDefaultWorldGame(
  seed: string,
  settings: Readonly<Record<string, unknown>> = {},
): Engine {
  const game = createNewGame([readContentPack('base'), readContentPack('worlds/default')], {
    rootPackId: 'default-world',
    seed,
    playerId: DEFAULT_WORLD_PLAYER_ID,
    playerName: 'Alex Booker',
    saveName: 'Owner test',
    seasonLength: { preset: '6m' },
    player: { mode: 'existing', promotionKey: DEFAULT_WORLD_PROMOTION_KEY },
    settings,
  });
  if (!game.ok) {
    throw new Error(`The new game was refused: ${JSON.stringify(game.reasons)}`);
  }
  return createEngine({ state: game.state, systems: defaultSystems });
}
