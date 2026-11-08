/**
 * The engine's golden save (`tinySaveDocument()`, which `packages/engine/test/fixtures/saves/
 * v1-tiny.json` stores) as a save the running game accepts, plus damaged copies of it for the
 * load-failure tests.
 *
 * The golden file stores placeholder simulation parts (`rng: {}` and the like), because the save
 * format tests only care about the World. A real load checks every part with the engine's own
 * schemas, so the World is kept exactly as stored and the parts are filled with a fresh game's
 * (`initialEngineState`). `e2e/fixtures/build-sample-save.ts` builds the e2e sample the same way.
 */

import {
  createSaveDocument,
  documentToWorld,
  encodeSave,
  engineSaveState,
  initialEngineState,
  isJsonObject,
  isJsonValue,
  TABLES,
} from '@ringside/engine';
import type {
  Controller,
  JsonObject,
  JsonValue,
  PromotionId,
  SaveDocument,
} from '@ringside/engine';
import { tinySaveDocument } from '@ringside/engine/testing';

/** The promotion the golden header names: the one its human player runs. */
function headerPromotionId(doc: SaveDocument): PromotionId | null {
  const promotion = doc.state.world.tables.promotions.find(
    (row) => row.name === doc.header.promotionName,
  );
  return promotion?.id ?? null;
}

/** The golden save with real simulation parts, ready to load. */
export function goldenSaveDocument(): SaveDocument {
  const stored = tinySaveDocument();
  const world = documentToWorld(stored, TABLES);
  return createSaveDocument(engineSaveState(initialEngineState(world)), {
    headerPromotionId: headerPromotionId(stored),
    savedAt: stored.savedAt,
    label: stored.header.label,
    engineVersion: stored.engineVersion,
  });
}

/** The golden save encoded the way the game stores it (gzip). */
export async function goldenSaveBytes(): Promise<Uint8Array> {
  return encodeSave(goldenSaveDocument());
}

/** The human controller that runs a promotion in the golden save. */
export function goldenHumanController(): Controller {
  const promotion = goldenSaveDocument().state.world.tables.promotions.find(
    (row) => row.controller.kind === 'human',
  );
  if (promotion === undefined) {
    throw new Error('The golden save has no human-run promotion.');
  }
  return promotion.controller;
}

/** The golden save's game date. */
export function goldenGameDate(): string {
  return goldenSaveDocument().header.gameDate;
}

/** `doc` with the value at `path` replaced by `value`, creating objects on the way as needed. */
export function setJsonPath(
  doc: JsonObject,
  path: readonly string[],
  value: JsonValue,
): JsonObject {
  const [key, ...rest] = path;
  if (key === undefined) {
    throw new Error('setJsonPath needs at least one key.');
  }
  if (rest.length === 0) return { ...doc, [key]: value };
  const child = doc[key];
  const childObject = child !== undefined && isJsonObject(child) ? child : {};
  return { ...doc, [key]: setJsonPath(childObject, rest, value) };
}

/**
 * The golden save with the value at `path` replaced, stored as plain UTF-8 JSON (which the decoder
 * accepts next to gzip) with no checks, so a test can hand the loader a document the encoder
 * would refuse.
 */
export function damagedGoldenSave(path: readonly string[], value: JsonValue): Uint8Array {
  const parsed: unknown = JSON.parse(JSON.stringify(goldenSaveDocument()));
  if (!isJsonValue(parsed) || !isJsonObject(parsed)) {
    throw new Error('The golden save is not a JSON object.');
  }
  return new TextEncoder().encode(JSON.stringify(setJsonPath(parsed, path, value)));
}

/** The first `keepBytes` bytes of the encoded golden save: a truncated gzip stream. */
export async function truncatedGoldenSave(keepBytes = 64): Promise<Uint8Array> {
  const bytes = await goldenSaveBytes();
  return bytes.slice(0, keepBytes);
}
