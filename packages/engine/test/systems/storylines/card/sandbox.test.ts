// `storylines.setHeat`, the Sandbox game's test aid (CRTV4-05). Design: docs/design/storylines.md#sandbox-heat
import { describe, expect, it } from 'vitest';
import { controllerViewer, createEngine, initialEngineState } from '../../../../src/core/api';
import { simSystem } from '../../../../src/core/api/builtins';
import type { Controller } from '../../../../src/core/api/controller';
import { isFullTrace } from '../../../../src/core/trace/store';
import { storylinesSystem } from '../../../../src/systems/storylines';
import {
  SANDBOX_ONLY_MESSAGE,
  SET_BY_HAND_TEXT,
  STORYLINE_SANDBOX_REASONS,
} from '../../../../src/systems/storylines/card/sandbox';
import { storylineHeatTraceRef } from '../../../../src/systems/storylines/traceKinds';
import { TEST_PLAYER_ID, type BuiltWorld } from '../../../support';
import { ok, PLAYER_VIEWER, reasonCodes, storylineWorld } from '../storyline-world';

const PLAYER: Controller = { kind: 'human', playerId: TEST_PLAYER_ID };
const OMNISCIENT = { kind: 'omniscient' } as const;

function sandboxed(built: BuiltWorld, sandbox: boolean): BuiltWorld {
  const { meta } = built.world;
  return {
    ...built,
    world: { ...built.world, meta: { ...meta, settings: { ...meta.settings, sandbox } } },
  };
}

function engineFor(sandbox: boolean) {
  const built = sandboxed(storylineWorld(), sandbox);
  const engine = createEngine({
    state: initialEngineState(built.world),
    systems: [simSystem, storylinesSystem],
  });
  return { built, engine };
}

describe('storylines.setHeat', () => {
  it('refuses outside a Sandbox game and changes nothing', () => {
    const { built, engine } = engineFor(false);
    const hot = built.ids.storylines[1]!;
    const result = engine.command('storylines.setHeat', { storylineId: hot, heat: 20 }, PLAYER);
    expect(reasonCodes(result)).toEqual([STORYLINE_SANDBOX_REASONS.sandboxOnly]);
    expect(result.ok ? null : result.reasons[0]?.message).toBe(SANDBOX_ONLY_MESSAGE);
    expect(ok(engine.query('storylines.detail', { storylineId: hot }, PLAYER_VIEWER)).heat).toBe(
      85,
    );
    expect(ok(engine.query('sim.status', {}, PLAYER_VIEWER)).sandbox).toBe(false);
  });

  it('sets the heat in a Sandbox game with a set-by-hand Why?, leaving progress alone', () => {
    const { built, engine } = engineFor(true);
    const hot = built.ids.storylines[1]!;
    const before = ok(engine.query('storylines.detail', { storylineId: hot }, PLAYER_VIEWER));

    const result = engine.command('storylines.setHeat', { storylineId: hot, heat: 72 }, PLAYER);
    expect(result.ok && result.data).toEqual({ heat: 72 });

    const after = ok(engine.query('storylines.detail', { storylineId: hot }, PLAYER_VIEWER));
    expect(after.heat).toBe(72);
    expect(after.lastProgressOn).toBe(before.lastProgressOn);
    const timeline = ok(
      engine.query('storylines.timeline', { storylineId: hot }, controllerViewer(PLAYER)),
    );
    expect(timeline.kind === 'ok' && timeline.rows).toEqual([]);
    expect(timeline.kind === 'ok' && timeline.totals.segments).toBe(0);

    const trace = ok(engine.query('trace.get', { ref: storylineHeatTraceRef(hot) }, OMNISCIENT));
    expect(trace !== null && isFullTrace(trace)).toBe(true);
    expect(JSON.stringify(trace)).toContain(SET_BY_HAND_TEXT);
    expect(ok(engine.query('sim.status', {}, PLAYER_VIEWER)).sandbox).toBe(true);
  });

  it("refuses a rival's storyline, an ended one and heat outside 0 to 100", () => {
    const { built, engine } = engineFor(true);
    const [, hot, , rival] = built.ids.storylines;
    const ended = built.ids.storylines[2]!;
    expect(
      reasonCodes(engine.command('storylines.setHeat', { storylineId: rival!, heat: 50 }, PLAYER)),
    ).toEqual(['storylines.notYours']);
    expect(
      reasonCodes(engine.command('storylines.setHeat', { storylineId: ended, heat: 50 }, PLAYER)),
    ).toEqual(['storylines.ended']);
    expect(
      reasonCodes(engine.command('storylines.setHeat', { storylineId: hot!, heat: 101 }, PLAYER)),
    ).toEqual(['invalidArgs']);
  });
});
