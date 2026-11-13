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

  it('keeps the decision log for the history window (POL4-08), listed under History', () => {
    const engine = createEngine({
      state: initialEngineState(worldBuilder().build().world),
      systems: defaultSystems,
    });
    const list = engine.query('tunables.list', { category: 'History' }, OMNISCIENT);
    if (!list.ok) {
      expect.fail(JSON.stringify(list.reasons));
    }
    expect(list.data.map((row) => [row.key, row.default, row.docRef])).toEqual([
      ['history.keepDetailDays', 28, 'save-format.md#history-retention'],
    ]);
  });
});

describe('the AIP1-04 tunables', () => {
  function listed(category: string) {
    const engine = createEngine({
      state: initialEngineState(worldBuilder().build().world),
      systems: defaultSystems,
    });
    const list = engine.query('tunables.list', { category }, OMNISCIENT);
    if (!list.ok) {
      expect.fail(JSON.stringify(list.reasons));
    }
    return list.data;
  }

  it('lists one style taste per style and axis under Rival taste', () => {
    const rows = listed('Rival taste');
    expect(rows).toHaveLength(56);
    expect(rows.every((row) => row.docRef === 'rival-desk.md#taste')).toBe(true);
    expect(
      rows.find((row) => row.key === 'aip.styleTaste.hardHitting.wrestlingFocus')?.default,
    ).toBe(80);
  });

  it('lists the card value and needs numbers under Rival desk', () => {
    const keys = listed('Rival desk').map((row) => row.key);
    expect(keys.filter((key) => key.startsWith('aip.cardValue.'))).toHaveLength(9);
    expect(keys.filter((key) => key.startsWith('aip.needs.'))).toHaveLength(17);
  });
});
