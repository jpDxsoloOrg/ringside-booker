/**
 * Writes `sample.rbsave` next to this file: the engine's golden save
 * (`packages/engine/test/fixtures/saves/v1-tiny.json`) encoded with the public `encodeSave`, for
 * the save-slot e2e specs to import. `npm run e2e` rebuilds it first (the `pree2e` script), so it
 * always matches the engine in this checkout.
 *
 * The golden file keeps placeholder simulation parts (the save-format tests only care about the
 * World), and a real load checks every part with the engine's own schemas. So the World is kept
 * exactly as stored and the parts are a fresh game's, the same as `src/test/goldenSave.ts` does.
 *
 * Run with `npx tsx e2e/fixtures/build-sample-save.ts` from `apps/web`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createSaveDocument,
  createSaveDocumentSchema,
  documentToWorld,
  encodeSave,
  engineSaveState,
  initialEngineState,
  TABLES,
} from '@ringside/engine';

const GOLDEN_SAVE_PATH = fileURLToPath(
  new URL('../../../../packages/engine/test/fixtures/saves/v1-tiny.json', import.meta.url),
);
const SAMPLE_SAVE_PATH = fileURLToPath(new URL('./sample.rbsave', import.meta.url));

async function buildSampleSave(): Promise<void> {
  const golden = createSaveDocumentSchema().parse(
    JSON.parse(readFileSync(GOLDEN_SAVE_PATH, 'utf8')),
  );
  const headerPromotion = golden.state.world.tables.promotions.find(
    (promotion) => promotion.name === golden.header.promotionName,
  );
  const world = documentToWorld(golden, TABLES);
  const doc = createSaveDocument(engineSaveState(initialEngineState(world)), {
    headerPromotionId: headerPromotion?.id ?? null,
    savedAt: golden.savedAt,
    label: golden.header.label,
    engineVersion: golden.engineVersion,
  });
  const bytes = await encodeSave(doc);
  writeFileSync(SAMPLE_SAVE_PATH, bytes);
  process.stdout.write(`Wrote ${SAMPLE_SAVE_PATH} (${String(bytes.byteLength)} bytes)\n`);
}

await buildSampleSave();
