/**
 * New games on the shipped default world for the calendar tests, and the "what should be on the
 * books" check both test files share.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addDays, type GameDate } from '../../../src/core/date';
import type { EngineState } from '../../../src/core/api';
import type { EventDefinition } from '../../../src/model/entities/event-definition';
import type { EventInstance } from '../../../src/model/entities/event-instance';
import {
  packManifestSchema,
  RECORD_KINDS,
  type RawPack,
  type RecordKind,
} from '../../../src/persistence/packs';
// Importing the calendar registers its setup step; `createNewGame` alone does not know about it.
import { occurrencesBetween } from '../../../src/systems/calendar';
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

const PACKS = [readContentPack('base'), readContentPack('worlds/default')];

/** The key of the default world's biggest promotion, the one the calendar tests play as. */
export const FLAGSHIP_PROMOTION_KEY = 'pro-flagship';

export interface DefaultGameOptions {
  readonly player?: Record<string, unknown>;
  readonly tunableOverrides?: Record<string, number>;
}

/** Starts a game on the default world; plays the flagship promotion unless told otherwise. */
export function startDefaultGame(options: DefaultGameOptions = {}): EngineState {
  const result = createNewGame(PACKS, {
    rootPackId: 'default-world',
    seed: 'calendar-default-world',
    playerId: 'local-player',
    playerName: 'Alex Booker',
    saveName: 'Calendar run',
    seasonLength: { preset: '6m' },
    player: options.player ?? { mode: 'existing', promotionKey: FLAGSHIP_PROMOTION_KEY },
    settings: {},
    ...(options.tunableOverrides === undefined
      ? {}
      : { tunableOverrides: options.tunableOverrides }),
  });
  if (!result.ok) {
    throw new Error(`New game was refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.state;
}

/** True when the definition's promotion is active and its brand, if any, is active. */
function isSchedulableIn(state: EngineState, definition: EventDefinition): boolean {
  const { promotions, brands } = state.world.tables;
  const promotion = promotions.find((row) => row.id === definition.promotionId);
  const brand = brands.find((row) => row.id === definition.brandId);
  return promotion?.status === 'active' && (definition.brandId === null || brand?.active === true);
}

/** `definitionId|airDate` for every stored show that came from a definition, sorted. */
export function storedShowKeys(
  state: EngineState,
  keep: (instance: EventInstance) => boolean = () => true,
): string[] {
  return state.world.tables.eventInstances
    .filter((instance) => instance.eventDefinitionId !== null && keep(instance))
    .map((instance) => `${String(instance.eventDefinitionId)}|${instance.airDate}`)
    .sort();
}

/**
 * `definitionId|date` for every date a schedulable definition runs on from `from` through
 * `from + days`, sorted: what the stored schedule must hold for that window, exactly once each.
 */
export function expectedShowKeys(state: EngineState, from: GameDate, days: number): string[] {
  const through = addDays(from, days);
  return state.world.tables.eventDefinitions
    .filter((definition) => isSchedulableIn(state, definition))
    .flatMap((definition) =>
      occurrencesBetween(definition, from, through).map(
        (occurrence) => `${definition.id}|${occurrence}`,
      ),
    )
    .sort();
}
