// The titles queries on the shipped default world, with the human seat on Altura (CRTV1-02).
// Design: docs/design/titles.md#queries
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createEngine, type Viewer } from '../../../src/core/api';
import { assertSerialisable } from '../../../src/core/api/serialisable';
import {
  packManifestSchema,
  RECORD_KINDS,
  type RawPack,
  type RecordKind,
} from '../../../src/persistence/packs';
import { defaultSystems } from '../../../src/systems';
import { createNewGame } from '../../../src/systems/newgame';

const CONTENT_ROOT = fileURLToPath(new URL('../../../../../content/', import.meta.url));
const PLAYER_ID = 'local-player';
const PLAYER: Viewer = { kind: 'controller', controller: { kind: 'human', playerId: PLAYER_ID } };

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Reads a shipped pack the way the tools do: its manifest and every file the manifest lists. */
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

const PACKS = [readContentPack('base'), readContentPack('worlds/default')];

const newGame = createNewGame(PACKS, {
  rootPackId: 'default-world',
  seed: 'default-world-titles',
  playerId: PLAYER_ID,
  playerName: 'Alex Booker',
  saveName: 'Titles run',
  seasonLength: { preset: '6m' },
  player: { mode: 'existing', promotionKey: 'pro-flagship' },
  settings: {},
});
if (!newGame.ok) {
  throw new Error(`New game was refused: ${JSON.stringify(newGame.reasons)}`);
}
const engine = createEngine({ state: newGame.state, systems: defaultSystems });

function data<T>(result: { ok: true; data: T } | { ok: false; reasons: unknown }, label: string) {
  if (!result.ok) {
    throw new Error(`${label} was refused: ${JSON.stringify(result.reasons)}`);
  }
  assertSerialisable(result.data, label);
  return result.data;
}

describe('the titles queries on the default world, playing Altura', () => {
  const own = data(engine.query('titles.list', { scope: 'own', status: 'all' }, PLAYER), 'own');
  const world = data(
    engine.query('titles.list', { scope: 'world', status: 'all' }, PLAYER),
    'world',
  );
  const ownRows = own.groups.flatMap((group) => group.titles);
  const worldRows = world.groups.flatMap((group) => group.titles);

  it('lists our 6 titles under Mainstage, Overclock and Promotion-wide', () => {
    expect(own.groups.map((group) => group.brandName)).toEqual([
      'Altura Mainstage',
      'Altura Overclock',
      'Promotion-wide',
    ]);
    expect(ownRows).toHaveLength(6);
    expect(ownRows.every((row) => row.editable)).toBe(true);
  });

  it('lists the other 22 titles in 11 promotion groups, none editable', () => {
    expect(world.groups).toHaveLength(11);
    expect(worldRows).toHaveLength(22);
    expect(worldRows.some((row) => row.editable)).toBe(false);
  });

  it('explains every prestige', () => {
    for (const row of [...ownRows, ...worldRows]) {
      expect((row.prestigeTraceRef === null) !== (row.prestigeTrace === null)).toBe(true);
    }
  });

  it('opens all 28 titles and their eligible holders', () => {
    expect(ownRows.length + worldRows.length).toBe(28);
    for (const row of [...ownRows, ...worldRows]) {
      const lineage = data(
        engine.query('titles.detail', { titleId: row.titleId }, PLAYER),
        `detail ${row.name}`,
      );
      expect(lineage.title.titleId).toBe(row.titleId);
      expect(lineage.stats.totalReigns).toBe(lineage.reigns.length);
      const holders = data(
        engine.query(
          'titles.eligibleHolders',
          { titleId: row.titleId, includeIneligible: true },
          PLAYER,
        ),
        `eligibleHolders ${row.name}`,
      );
      expect(holders.people.length + holders.ineligible.length).toBeGreaterThan(0);
    }
  });

  it('counts days vacant only from where the history starts, and says so (CRTV1-08)', () => {
    let cutOff = 0;
    for (const row of [...ownRows, ...worldRows]) {
      const lineage = data(
        engine.query('titles.detail', { titleId: row.titleId }, PLAYER),
        `detail ${row.name}`,
      );
      // A new game: nothing has been vacant for long, let alone thousands of days.
      expect(lineage.stats.daysVacant, row.name).toBeLessThan(365);
      expect(lineage.stats.daysVacantTrace.value).toBe(lineage.stats.daysVacant);
      const from = lineage.stats.historyRecordedFrom;
      if (from !== null) {
        cutOff += 1;
        expect(from > lineage.title.introducedOn).toBe(true);
        expect(JSON.stringify(lineage.stats.daysVacantTrace)).toContain('History before');
      }
    }
    // The default world's titles are older than the reigns it lists.
    expect(cutOff).toBeGreaterThan(0);
  });
});
