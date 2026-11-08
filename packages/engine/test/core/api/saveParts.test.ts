import { describe, expect, it } from 'vitest';
import {
  createEngine,
  createEngineSaveDocumentSchema,
  engineLoadOptions,
  engineSaveState,
  engineStateFromSave,
  engineStateParts,
  type Engine,
} from '../../../src/core/api';
import { TABLES } from '../../../src/model/tables';
import { encodeSave } from '../../../src/persistence/codec';
import { loadSave, type LoadReport } from '../../../src/persistence/load';
import { SIM_STATE_PARTS, type SaveDocument } from '../../../src/persistence/save-document';
import { createSaveDocument } from '../../../src/persistence/world-document';
import { TEST_ENGINE_VERSION, TEST_SAVED_AT } from '../../support/saves';
import { tinyWorld } from '../../support/worlds';
import { engineFor, testSystems } from './apiTestSystem';

/** An engine that has run a few days, so every state part has something in it. */
async function playedEngine(): Promise<{ engine: Engine; doc: SaveDocument }> {
  const { world, ids } = tinyWorld();
  const engine = engineFor(world);
  await engine.advanceDays({ maxDays: 4 });
  engine.command('test.refuse', {}, { kind: 'computer' });
  const doc = createSaveDocument(engineSaveState(engine.exportState()), {
    headerPromotionId: ids.promotions.A ?? null,
    savedAt: TEST_SAVED_AT,
    label: 'Engine save',
    engineVersion: TEST_ENGINE_VERSION,
  });
  return { engine, doc };
}

function failureOf(report: LoadReport) {
  if (report.ok) {
    throw new Error('expected the load to fail');
  }
  return report;
}

describe('engineStateParts', () => {
  it('has a schema for every simulation part', () => {
    expect(Object.keys(engineStateParts).sort()).toEqual([...SIM_STATE_PARTS].sort());
  });
});

describe('createEngineSaveDocumentSchema', () => {
  it('accepts an exported engine state wrapped in a save document', async () => {
    const { doc } = await playedEngine();
    const result = createEngineSaveDocumentSchema().safeParse(doc);
    if (!result.success) {
      expect.fail(JSON.stringify(result.error.issues, null, 2));
    }
    expect(doc.state.commandLog).toMatchObject({ seq: 1 });
  });

  it('rejects a part that does not match its schema', async () => {
    const { doc } = await playedEngine();
    const broken = structuredClone(doc);
    broken.state.commandLog = { version: 1, seq: 0, entries: 'none' };
    const result = createEngineSaveDocumentSchema().safeParse(broken);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path.slice(0, 2)).toEqual(['state', 'commandLog']);
  });
});

describe('loadSave with engineLoadOptions', () => {
  it('loads an engine save and the engine carries on where it left off', async () => {
    const { engine, doc } = await playedEngine();
    const report = await loadSave(await encodeSave(doc), TABLES, engineLoadOptions());
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    expect(report.warnings).toEqual([]);
    const reloaded = createEngine({
      state: engineStateFromSave(report.doc),
      systems: testSystems(),
    });
    await engine.advanceDays({ maxDays: 3 });
    await reloaded.advanceDays({ maxDays: 3 });
    expect(reloaded.exportState()).toStrictEqual(engine.exportState());
  });

  it('fails at validate with a path under state.rng for a corrupted RNG word', async () => {
    const { doc } = await playedEngine();
    const broken = structuredClone(doc);
    const rng = engineStateParts.rng.parse(broken.state.rng);
    const [streamName] = Object.keys(rng.streams);
    if (streamName === undefined) {
      expect.fail('the played engine touched no RNG stream');
    }
    broken.state.rng = { ...rng, streams: { ...rng.streams, [streamName]: [1, 2, 3, 2 ** 32] } };
    const report = failureOf(await loadSave(await encodeSave(broken), TABLES, engineLoadOptions()));
    expect(report.stage).toBe('validate');
    expect(report.issues.length).toBeGreaterThan(0);
    for (const issue of report.issues) {
      expect(issue.path.startsWith('state.rng')).toBe(true);
    }
    expect(report.issues[0]?.path).toContain(streamName);
  });

  it('drops an unknown tunable override and lists it as a warning', async () => {
    const { doc } = await playedEngine();
    const withOverrides = structuredClone(doc);
    withOverrides.state.tunableOverrides = {
      'sim.eventLogSize': 50,
      'sim.retiredTunable': 7,
    };
    const report = await loadSave(await encodeSave(withOverrides), TABLES, engineLoadOptions());
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    expect(report.doc.state.tunableOverrides).toEqual({ 'sim.eventLogSize': 50 });
    expect(report.warnings).toEqual([
      {
        path: 'state.tunableOverrides["sim.retiredTunable"]',
        message: expect.stringContaining('sim.retiredTunable') as unknown,
      },
    ]);
  });

  it('keeps the caller options it does not own', () => {
    const options = engineLoadOptions({ maxBytes: 1234 });
    expect(options.maxBytes).toBe(1234);
    expect(options.stateParts).toBe(engineStateParts);
  });
});
