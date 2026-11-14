/**
 * A save from before CRTV4 (no storyline links, progress, totals or payoff record) loads and every
 * storyline query the screens ask answers without throwing (CRTV4-07). The owner is still told to
 * start a new game after the deploy: an old save's storylines have no linked history to show.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { controllerViewer, createEngine, initialEngineState } from '../../../src/core/api';
import { TABLES } from '../../../src/model/tables';
import { loadSave } from '../../../src/persistence/load';
import { documentToWorld } from '../../../src/persistence/world-document';
import { defaultSystems } from '../../../src/systems';
import { TEST_PLAYER_ID } from '../../support';

const VIEWER = controllerViewer({ kind: 'human', playerId: TEST_PLAYER_ID });

describe('a save from before storylines on the card', () => {
  it('answers the storyline queries for every storyline', async () => {
    const file = new URL(
      '../../fixtures/saves/v1-tiny-before-storyline-progress.json',
      import.meta.url,
    );
    const report = await loadSave(new Uint8Array(readFileSync(file)), TABLES);
    if (!report.ok) expect.fail(JSON.stringify(report.issues, null, 2));
    const world = documentToWorld(report.doc, TABLES);
    const engine = createEngine({ state: initialEngineState(world), systems: defaultSystems });
    const storylines = world.tables.storylines.values();
    expect(storylines.length).toBeGreaterThan(0);
    expect(engine.query('storylines.list', { status: 'all' }, VIEWER).ok).toBe(true);
    for (const { id } of storylines) {
      for (const name of [
        'storylines.detail',
        'storylines.timeline',
        'storylines.payoff',
      ] as const) {
        const result = engine.query(name, { storylineId: id }, VIEWER);
        expect(result.ok, `${name} for ${id}`).toBe(true);
      }
    }
  });
});
