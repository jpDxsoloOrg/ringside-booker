// The production ceiling on the shipped default world and the production.ceiling query (EVT4-02).
// Design: docs/design/card-flow.md#production-ceiling
import { beforeAll, describe, expect, it } from 'vitest';
import { createEngine, type Engine, type EngineState } from '../../../src/core/api';
import { parseId, type PromotionId } from '../../../src/core/ids';
import { defaultSystems } from '../../../src/systems';
import { startDefaultGame } from '../calendar/default-game';

const VIEWER = { kind: 'omniscient' } as const;

let state: EngineState;
let engine: Engine;

beforeAll(() => {
  state = startDefaultGame();
  engine = createEngine({ state, systems: defaultSystems });
});

function promotionId(prefix: string): PromotionId {
  const found = state.world.tables.promotions.find((row) => row.name.startsWith(prefix));
  if (found === undefined) throw new Error(`no promotion ${prefix}`);
  return found.id;
}

function ceilingOf(prefix: string, levels?: Record<string, number>) {
  const result = engine.query(
    'production.ceiling',
    { promotionId: promotionId(prefix), ...(levels === undefined ? {} : { levels }) },
    VIEWER,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return result.data;
}

describe('the production ceiling on the default world', () => {
  it('is 86.5 for Altura and 43.5 for Wattle at the defaults; neither earns the bonus slot', () => {
    const altura = ceilingOf('Altura');
    expect(altura.ceiling).toBe(86.5);
    expect(altura.bonusSlot).toMatchObject({
      qualifies: false,
      threshold: 90,
      minImportance: 'regular',
    });
    expect(altura.ceilingTrace.label).toBe('Production ceiling (Altura Wrestling Entertainment)');
    expect(ceilingOf('Wattle').ceiling).toBe(43.5);
  });

  it('keeps every opening show at its definition format', () => {
    const definitions = new Map(
      state.world.tables.eventDefinitions.map((row) => [row.id, row.format.slots]),
    );
    for (const show of state.world.tables.eventInstances) {
      if (show.eventDefinitionId === null) continue;
      expect(show.format.slots).toBe(definitions.get(show.eventDefinitionId));
    }
  });

  it('answers what-if levels without writing anything', () => {
    const before = engine.exportState();
    const upgraded = ceilingOf('Altura', { editing: 10, pyro: 10 });
    expect(upgraded.ceiling).toBe(86.5 + 3 * 1.5 + 2);
    expect(upgraded.bonusSlot.qualifies).toBe(true);
    expect(upgraded.bonusSlot.trace.value).toBe(true);
    expect(engine.exportState()).toEqual(before);
  });

  it('refuses an unknown promotion and an out-of-range level', () => {
    const unknown = engine.query(
      'production.ceiling',
      { promotionId: parseId('promotion', 'pro_9999999999') },
      VIEWER,
    );
    expect(unknown.ok).toBe(false);
    const tooHigh = engine.query(
      'production.ceiling',
      { promotionId: promotionId('Altura'), levels: { stage: 11 } },
      VIEWER,
    );
    expect(tooHigh.ok).toBe(false);
  });

  it('answers any viewer: production levels are public', () => {
    const player = engine.query(
      'production.ceiling',
      { promotionId: promotionId('Wattle') },
      { kind: 'controller', controller: { kind: 'human', playerId: 'local-player' } },
    );
    expect(player.ok && player.data.ceiling).toBe(43.5);
  });
});
