/**
 * Writes `sample-news.rbsave` next to this file: the sample world (`v1-tiny.json`, as
 * `build-sample-save.ts` encodes it) changed so a long skip meets several news alerts and nothing
 * else. Three of the player's wrestlers reach ten years in the ring in each of the next three
 * weeks (career-anniversary milestones, posted on Mondays), and the player's weekly show ends
 * today, so no show night stops the skip first. The news-alerts e2e (DAY1-05) turns on the
 * "My roster" alert and skips through all three stops.
 *
 * `npm run e2e` rebuilds it first (the `pree2e` script). Run with
 * `npx tsx e2e/fixtures/build-news-save.ts` from `apps/web`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createSaveDocument,
  createSaveDocumentSchema,
  documentToWorld,
  encodeSave,
  engineSaveSchemaFingerprint,
  engineSaveState,
  initialEngineState,
  parseGameDate,
  TABLES,
} from '@ringside/engine';

const GOLDEN_SAVE_PATH = fileURLToPath(
  new URL('../../../../packages/engine/test/fixtures/saves/v1-tiny.json', import.meta.url),
);
const NEWS_SAVE_PATH = fileURLToPath(new URL('./sample-news.rbsave', import.meta.url));

/** The slot label the save carries; its import gets " (imported)" added. */
export const NEWS_SAVE_LABEL = 'News save';

/**
 * Debut dates ten years before a day in each of the three weeks after the sample's 10 April
 * 2026, so the Mondays of 13, 20 and 27 April each post one anniversary of the player's roster.
 */
const DEBUTS: Readonly<Record<string, string>> = {
  per_0000000002: '2016-04-09',
  per_0000000003: '2016-04-16',
  per_0000000004: '2016-04-23',
};

async function buildNewsSave(): Promise<void> {
  const golden = createSaveDocumentSchema().parse(
    JSON.parse(readFileSync(GOLDEN_SAVE_PATH, 'utf8')),
  );
  const { tables, meta } = golden.state.world;
  tables.people = tables.people.map((person) => {
    const debut = DEBUTS[person.id];
    return debut === undefined ? person : { ...person, debutDate: parseGameDate(debut) };
  });
  tables.eventDefinitions = tables.eventDefinitions.map((definition) => ({
    ...definition,
    activeUntil: meta.currentDate,
  }));
  const headerPromotion = golden.state.world.tables.promotions.find(
    (promotion) => promotion.name === golden.header.promotionName,
  );
  const world = documentToWorld(golden, TABLES);
  const doc = createSaveDocument(engineSaveState(initialEngineState(world)), {
    headerPromotionId: headerPromotion?.id ?? null,
    savedAt: golden.savedAt,
    label: NEWS_SAVE_LABEL,
    engineVersion: golden.engineVersion,
    schemaFingerprint: engineSaveSchemaFingerprint(),
  });
  const bytes = await encodeSave(doc);
  writeFileSync(NEWS_SAVE_PATH, bytes);
  process.stdout.write(`Wrote ${NEWS_SAVE_PATH} (${String(bytes.byteLength)} bytes)\n`);
}

await buildNewsSave();
