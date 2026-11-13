// The rival desk's system bundle and tunables (AIP1-01). Design: docs/design/rival-desk.md
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Viewer } from '../../../src/core/api';
import { aipSystem, defaultSystems } from '../../../src/systems';
import { worldBuilder } from '../../support';

const OMNISCIENT: Viewer = { kind: 'omniscient' };

describe('the aip system', () => {
  it('is a default system, after the workers system', () => {
    const ids = defaultSystems.map((system) => system.id);
    expect(ids).toContain(aipSystem.id);
    expect(ids.indexOf('aip')).toBeGreaterThan(ids.indexOf('workers'));
  });

  it('lists the decision log retention under the Rival desk category', () => {
    const engine = createEngine({
      state: initialEngineState(worldBuilder().build().world),
      systems: defaultSystems,
    });
    const list = engine.query('tunables.list', { category: 'Rival desk' }, OMNISCIENT);
    if (!list.ok) {
      expect.fail(JSON.stringify(list.reasons));
    }
    expect(list.data.map((row) => [row.key, row.default, row.docRef])).toEqual([
      ['aip.decisionLogRetentionDays', 365, 'rival-desk.md#decision-log'],
    ]);
  });
});
