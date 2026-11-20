/**
 * Draft-start games for the draft tests (DRF-01/03/06/07): the shipped default world, a big world
 * made by copying it (for the speed test), and an engine to drive the draft commands with.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEngine, type Engine, type EngineState } from '../../../src/core/api';
import { controllerViewer, type Controller, type Viewer } from '../../../src/core/api/controller';
import {
  packManifestSchema,
  RECORD_KINDS,
  type RawPack,
  type RecordKind,
} from '../../../src/persistence/packs';
import { TABLES, type GameWorld } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import { defaultSystems } from '../../../src/systems';
import { createNewGame } from '../../../src/systems/newgame';

const CONTENT_ROOT = fileURLToPath(new URL('../../../../../content/', import.meta.url));

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

export const DEFAULT_PACKS: readonly RawPack[] = [
  readContentPack('base'),
  readContentPack('worlds/default'),
];

export const PLAYER: Controller = { kind: 'human', playerId: 'local-player' };
export const PLAYER_VIEW: Viewer = controllerViewer(PLAYER);
export const FLAGSHIP = 'pro-flagship';

export interface DraftGameOptions {
  readonly settings?: Record<string, boolean | string>;
  readonly seed?: string;
  readonly promotionKey?: string;
  readonly activePromotionKeys?: string[];
  readonly packs?: readonly RawPack[];
  readonly rootPackId?: string;
}

/** A new game; "Start with a draft" is on unless `settings.draftStart` says otherwise. */
export function startDraftGame(options: DraftGameOptions = {}): EngineState {
  const result = createNewGame(options.packs ?? DEFAULT_PACKS, {
    rootPackId: options.rootPackId ?? 'default-world',
    seed: options.seed ?? 'draft-start',
    playerId: PLAYER.kind === 'human' ? PLAYER.playerId : 'local-player',
    playerName: 'Alex Booker',
    saveName: 'Draft run',
    seasonLength: { preset: '6m' },
    player: { mode: 'existing', promotionKey: options.promotionKey ?? FLAGSHIP },
    settings: { draftStart: true, ...options.settings },
    ...(options.activePromotionKeys === undefined
      ? {}
      : { activePromotionKeys: options.activePromotionKeys }),
  });
  if (!result.ok) {
    throw new Error(`New game was refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.state;
}

export function engineOf(state: EngineState): Engine {
  return createEngine({ state, systems: defaultSystems });
}

/** Runs a command and fails the test with its reasons when it is refused. */
export function run<T>(result: { ok: true; data: T } | { ok: false; reasons: unknown }): T {
  if (!result.ok) {
    throw new Error(`Refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

type Row = Record<string, unknown>;

function rowsOf(pack: RawPack, kind: RecordKind): Row[] {
  const rows: unknown = pack.files[kind];
  return Array.isArray(rows)
    ? rows.filter((row): row is Row => typeof row === 'object' && row !== null)
    : [];
}

/**
 * A big world: the default world's promotions, people, contracts and titles copied `copies`
 * times (copy 0 is the original), with new keys, names and short names. Everything else (teams,
 * reigns, shows, deals) stays with the originals.
 */
export function bigWorldPacks(copies: number): RawPack[] {
  const [base, world] = DEFAULT_PACKS;
  if (base === undefined || world === undefined) {
    throw new Error('default packs missing');
  }
  const promotions = rowsOf(world, 'promotion');
  const people = rowsOf(world, 'person');
  const employments = rowsOf(world, 'employment');
  const titles = rowsOf(world, 'title');
  const files: Partial<Record<RecordKind, unknown>> = { ...world.files };
  const outPromotions = [...promotions];
  const outPeople = [...people];
  const outEmployments = [...employments];
  const outTitles = [...titles];
  let shortIndex = 0;
  for (let copy = 1; copy < copies; copy += 1) {
    const suffix = `-c${String(copy)}`;
    for (const promotion of promotions) {
      shortIndex += 1;
      outPromotions.push({
        ...promotion,
        key: `${String(promotion['key'])}${suffix}`,
        name: `${String(promotion['name']).slice(0, 48)} ${String(copy)}`,
        shortName: `P${String(shortIndex).padStart(5, '0')}`,
        ownerPersonKey: null,
        bookerPersonKey: null,
        parentPromotionKey: null,
      });
    }
    for (const person of people) {
      outPeople.push({ ...person, key: `${String(person['key'])}${suffix}` });
    }
    for (const employment of employments) {
      outEmployments.push({
        ...employment,
        key: `${String(employment['key'])}${suffix}`,
        personKey: `${String(employment['personKey'])}${suffix}`,
        promotionKey: `${String(employment['promotionKey'])}${suffix}`,
        brandKey: null,
      });
    }
    for (const title of titles) {
      outTitles.push({
        ...title,
        key: `${String(title['key'])}${suffix}`,
        promotionKey: `${String(title['promotionKey'])}${suffix}`,
        brandKey: null,
      });
    }
  }
  files.promotion = outPromotions;
  files.person = outPeople;
  files.employment = outEmployments;
  files.title = outTitles;
  return [base, { manifest: world.manifest, files }];
}

/** The world of an engine state, for reading rows and running the engine's helpers on it. */
export function worldOf(state: EngineState): GameWorld {
  return documentToWorld({ state: { world: state.world } }, TABLES);
}
