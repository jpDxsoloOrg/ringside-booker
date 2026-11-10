/**
 * Save documents for tests: a fixed save time, placeholder simulation parts and a ready-made v1
 * document of `tinyWorld()`. The golden save fixture (`test/fixtures/saves/v1-tiny.json`) is
 * `tinySaveDocument()` serialised.
 */

import { engineSaveSchemaFingerprint } from '../../src/core/api/saveFingerprint';
import type { JsonValue } from '../../src/core/json';
import type { SaveDocument, SimStatePart } from '../../src/persistence/save-document';
import { worldToDocument, type SerialisableWorld } from '../../src/persistence/world-document';
import { tinyWorld } from './worlds';

/** The real-world save time every test save uses. */
export const TEST_SAVED_AT = '2026-11-08T12:00:00.000Z';

/** The engine version test saves record. Fixed, so a version bump does not churn the fixtures. */
export const TEST_ENGINE_VERSION = '0.1.0';

/**
 * Placeholder simulation parts for save-format tests that only care about the World. They are not
 * real engine state: tests that need one build it with `initialEngineState(world)` or an engine's
 * `exportState()`, and save it with `engineSaveState`.
 */
export const PLACEHOLDER_SIM_STATE: Readonly<Record<SimStatePart, JsonValue>> = {
  rng: {},
  tunableOverrides: {},
  traces: {},
  events: [],
  failureLog: [],
  commandLog: [],
};

/** A v1 save of `world` with the placeholder parts, the test save time and no header promotion. */
export function testSaveDocument(
  world: SerialisableWorld,
  overrides: Partial<Parameters<typeof worldToDocument>[1]> = {},
): SaveDocument {
  return worldToDocument(world, {
    simState: PLACEHOLDER_SIM_STATE,
    headerPromotionId: null,
    savedAt: TEST_SAVED_AT,
    label: 'Test save',
    engineVersion: TEST_ENGINE_VERSION,
    ...overrides,
  });
}

/**
 * A v1 save of `tinyWorld()` with the placeholder parts, saved by promotion A's controller, at
 * `TEST_SAVED_AT`, stamped with this build's schema fingerprint as every real save is.
 */
export function tinySaveDocument(): SaveDocument {
  const { world, ids } = tinyWorld();
  return testSaveDocument(world, {
    headerPromotionId: ids.promotions.A ?? null,
    schemaFingerprint: engineSaveSchemaFingerprint(),
  });
}
