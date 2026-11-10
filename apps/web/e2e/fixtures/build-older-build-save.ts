/**
 * Writes `src/screens/saves/fixtures/older-build.rbsave`: a save as an older build would have left
 * it, for the "Made with an older build" tests.
 *
 * NEVER REGENERATE THE FILE. It is frozen on purpose: it stands for a save that today's build can
 * no longer open, and it has to keep failing the same way while the schemas move on. This script
 * was run by hand once and is kept only to show how the file was made. `npm run e2e` does not run
 * it.
 *
 * The save is the engine's golden tiny save with a fresh game's simulation parts, changed in three
 * ways:
 *
 * - the header has no `schemaFingerprint`, as every save from before fingerprints;
 * - the header label is "Older build test save";
 * - the first `people` row has an extra key, `legacyMicSkill`, which is what a renamed field looks
 *   like to a strict schema, so the load stops at the validate stage.
 *
 * It was run with `npx tsx e2e/fixtures/build-older-build-save.ts` from `apps/web`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  createSaveDocument,
  createSaveDocumentSchema,
  documentToWorld,
  engineSaveState,
  initialEngineState,
  serialiseSaveDocument,
  TABLES,
} from '@ringside/engine';

const GOLDEN_SAVE_PATH = fileURLToPath(
  new URL('../../../../packages/engine/test/fixtures/saves/v1-tiny.json', import.meta.url),
);
const OLDER_BUILD_SAVE_PATH = fileURLToPath(
  new URL('../../src/screens/saves/fixtures/older-build.rbsave', import.meta.url),
);

const OLDER_BUILD_LABEL = 'Older build test save';
const LEGACY_FIELD = 'legacyMicSkill';
const LEGACY_FIELD_VALUE = 55;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The object at `key` of `parent`, or an error naming what was missing. */
function objectAt(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  if (!isRecord(value)) {
    throw new Error(`The save has no object at "${key}"`);
  }
  return value;
}

function buildOlderBuildSave(): void {
  const golden = createSaveDocumentSchema().parse(
    JSON.parse(readFileSync(GOLDEN_SAVE_PATH, 'utf8')),
  );
  const headerPromotion = golden.state.world.tables.promotions.find(
    (promotion) => promotion.name === golden.header.promotionName,
  );
  const world = documentToWorld(golden, TABLES);
  // No schemaFingerprint: the header is left as a save from before fingerprints has it.
  const doc = createSaveDocument(engineSaveState(initialEngineState(world)), {
    headerPromotionId: headerPromotion?.id ?? null,
    savedAt: golden.savedAt,
    label: OLDER_BUILD_LABEL,
    engineVersion: golden.engineVersion,
  });

  const raw: unknown = JSON.parse(serialiseSaveDocument(doc));
  if (!isRecord(raw)) {
    throw new Error('The save document is not an object');
  }
  const people = objectAt(objectAt(objectAt(raw, 'state'), 'world'), 'tables')['people'];
  const firstPerson: unknown = Array.isArray(people) ? people[0] : undefined;
  if (!isRecord(firstPerson)) {
    throw new Error('The golden save has no people');
  }
  firstPerson[LEGACY_FIELD] = LEGACY_FIELD_VALUE;

  const bytes = gzipSync(Buffer.from(JSON.stringify(raw), 'utf8'));
  writeFileSync(OLDER_BUILD_SAVE_PATH, bytes);
  process.stdout.write(`Wrote ${OLDER_BUILD_SAVE_PATH} (${String(bytes.byteLength)} bytes)\n`);
}

buildOlderBuildSave();
