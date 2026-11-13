// A push set through roster.setPush survives a save and a load. Design: docs/design/roster.md#set-push
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  engineLoadOptions,
  engineSaveState,
  engineStateFromSave,
  type Engine,
  type EngineState,
} from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { EmploymentId } from '../../../src/core/ids';
import { TABLES } from '../../../src/model/tables';
import { encodeSave } from '../../../src/persistence/codec';
import { loadSave } from '../../../src/persistence/load';
import { createSaveDocument } from '../../../src/persistence/world-document';
import { rosterSystem } from '../../../src/systems/roster';
import { workersSystem } from '../../../src/systems/workers';
import { TEST_ENGINE_VERSION, TEST_SAVED_AT } from '../../support/saves';
import { rosterOf, rosterTestWorld } from './roster-world';
import { ownWrestlerAt, setPushOk } from './set-push-support';

function engineOver(state: EngineState): Engine {
  return createEngine({ state, systems: [simSystem, workersSystem, rosterSystem] });
}

function rowPush(engine: Engine, employmentId: EmploymentId) {
  return rosterOf(engine).rows.find((row) => row.employmentId === employmentId)?.push;
}

describe('roster.setPush and saves', () => {
  it('keeps the new push through exportState and JSON', () => {
    const world = rosterTestWorld();
    const id = ownWrestlerAt(world, 'enhancement');
    setPushOk(world.engine, [id], 'upperCard');
    const parsed: unknown = JSON.parse(JSON.stringify(world.engine.exportState()));
    // Test-only: the round trip keeps the shape; createEngine validates every part it rebuilds.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const reloaded = engineOver(parsed as EngineState);
    expect(rowPush(reloaded, id)).toBe('upperCard');
  });

  it('keeps the new push through a save file', async () => {
    const world = rosterTestWorld();
    const id = ownWrestlerAt(world, 'enhancement');
    setPushOk(world.engine, [id], 'upperCard');
    const doc = createSaveDocument(engineSaveState(world.engine.exportState()), {
      headerPromotionId: world.own,
      savedAt: TEST_SAVED_AT,
      label: 'Pushes set',
      engineVersion: TEST_ENGINE_VERSION,
    });
    const report = await loadSave(await encodeSave(doc), TABLES, engineLoadOptions());
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    const reloaded = engineOver(engineStateFromSave(report.doc));
    expect(rowPush(reloaded, id)).toBe('upperCard');
  });
});
