// New game (WLD-10) with the shipped default world: every promotion slot can be chosen, founding
// works in every region, and the result saves as a valid engine save document.
// Design: docs/design/new-game.md
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createEngineSaveDocumentSchema,
  engineSaveState,
  type EngineState,
} from '../../../src/core/api';
import { runStep } from '../../../src/core/pipeline/runStep';
import { createRuntime } from '../../../src/core/pipeline/runtime';
import { PROMOTION_STYLES } from '../../../src/model/entities/promotion-style';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import {
  loadWorldFromPacks,
  packManifestSchema,
  RECORD_KINDS,
  type RawPack,
  type RecordKind,
} from '../../../src/persistence/packs';
import { createSaveDocument } from '../../../src/persistence/world-document';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  createNewGame,
  FOUNDING_SIZES,
  foundPromotion,
  type NewGameResult,
} from '../../../src/systems/newgame';

const CONTENT_ROOT = fileURLToPath(new URL('../../../../../content/', import.meta.url));

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
const PROMOTION_RECORDS: unknown = readJson(`${CONTENT_ROOT}worlds/default/promotions.json`);
const PROMOTION_ROWS: readonly unknown[] = Array.isArray(PROMOTION_RECORDS)
  ? PROMOTION_RECORDS
  : [];
const PROMOTION_KEYS: string[] = PROMOTION_ROWS.map((row): unknown =>
  typeof row === 'object' && row !== null ? Reflect.get(row, 'key') : undefined,
).filter((key): key is string => typeof key === 'string');

function input(player: Record<string, unknown>, settings: Record<string, unknown> = {}) {
  return {
    rootPackId: 'default-world',
    seed: 'default-world-new-game',
    playerId: 'local-player',
    playerName: 'Alex Booker',
    saveName: 'Default world run',
    seasonLength: { preset: '6m' },
    player,
    settings,
  };
}

function expectValidSave(result: NewGameResult): EngineState {
  if (!result.ok) {
    throw new Error(`New game was refused: ${JSON.stringify(result.reasons)}`);
  }
  const doc = createSaveDocument(engineSaveState(result.state), {
    headerPromotionId: result.summary.promotion.id,
    savedAt: '2026-11-08T12:00:00.000Z',
    label: result.summary.saveName,
    engineVersion: '0.1.0',
  });
  const parsed = createEngineSaveDocumentSchema().safeParse(doc);
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  expect(doc.header.promotionName).toBe(
    result.state.world.tables.promotions.find((row) => row.id === result.summary.promotion.id)
      ?.name,
  );
  return result.state;
}

describe('createNewGame with the default world', () => {
  it('has twelve promotions to choose from', () => {
    expect(PROMOTION_KEYS).toHaveLength(12);
  });

  it.each(PROMOTION_KEYS)('starts a valid game running %s', (promotionKey) => {
    const state = expectValidSave(createNewGame(PACKS, input({ mode: 'existing', promotionKey })));
    const human = state.world.tables.promotions.filter((row) => row.controller.kind === 'human');
    expect(human).toHaveLength(1);
    expect(state.world.meta.contentKeys['promotion']?.[promotionKey]).toBe(human[0]?.id);
  });

  it('starts a valid game with every setup option on', () => {
    const state = expectValidSave(
      createNewGame(
        PACKS,
        input(
          { mode: 'existing', promotionKey: 'pro-uk' },
          { equalStart: true, randomiseContractLengths: true, rerollPotential: true },
        ),
      ),
    );
    expect(state.world.tables.deals).toEqual([]);
  });

  it('starts a valid game with a founded promotion and its starter kit', () => {
    expectValidSave(
      createNewGame(
        PACKS,
        input({
          mode: 'found',
          name: 'Harbourside Grappling',
          shortName: 'HSG',
          homeRegionKey: 'us-northeast',
          style: 'technical',
          size: 'large',
          color: '#204060',
          starterKit: true,
          weeklyShowDay: 5,
        }),
      ),
    );
  });

  it('founds a valid promotion in every region, size and style', () => {
    const loaded = loadWorldFromPacks(PACKS, ['default-world'], { seed: 'founding-everywhere' });
    if (!loaded.ok) {
      throw new Error(JSON.stringify(loaded.issues));
    }
    const { world, rng } = loaded.value;
    const runtime = createRuntime({ world, rng, tunables: createEngineTunables() });
    const regions = world.tables.regions.values();
    expect(regions.length).toBeGreaterThan(50);
    regions.forEach((region, index) => {
      const report = runStep(runtime, 'test.found', { kind: 'phase', id: 'test.found' }, (ctx) => {
        foundPromotion(ctx, {
          name: `Founded Promotion ${String(index)}`,
          shortName: `FP${String(index)}`,
          homeRegionId: region.id,
          style: PROMOTION_STYLES[index % PROMOTION_STYLES.length] ?? 'traditional',
          size: FOUNDING_SIZES[index % FOUNDING_SIZES.length] ?? 'small',
          color: '#336699',
          starterKit: index % 2 === 0,
          weeklyShowDay: index % 7 === 6 ? 6 : 2,
        });
      });
      expect(report.status, report.error?.message).toBe('ok');
    });
    const integrity = checkWorld(world, TABLES);
    expect(integrity.issues.filter((issue) => issue.severity !== 'warning')).toEqual([]);
    for (const promotion of world.tables.promotions.values()) {
      expect(TABLES.promotions.schema.safeParse(promotion).success).toBe(true);
    }
  });
});
