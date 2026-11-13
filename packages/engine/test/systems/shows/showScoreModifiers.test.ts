// Show score modifier seam. Design: docs/design/show-night.md#seams
import { afterEach, describe, expect, it } from 'vitest';
import type { JsonValue } from '../../../src/core/json';
import type { EventInstance } from '../../../src/model/entities/event-instance';
import type { GameWorldView } from '../../../src/model/tables';
import type { DeepReadonly } from '../../../src/model/world';
import {
  listShowScoreModifiers,
  registerShowScoreModifier,
  showScore,
  unregisterShowScoreModifier,
  type ShowScoreInputs,
  type ShowScoreModifier,
} from '../../../src/systems/shows';
import { createEngineTunables } from '../../../src/systems/tunables';
import { constantOf } from '../../../src/core/trace';
import { expectTraceContains, expectTraceReplays } from '../../support/trace';

const registered: string[] = [];

function register(def: ShowScoreModifier): void {
  registerShowScoreModifier(def);
  registered.push(def.id);
}

afterEach(() => {
  for (const id of registered.splice(0)) {
    unregisterShowScoreModifier(id);
  }
});

const noop: ShowScoreModifier['apply'] = () => undefined;

function inputs(extras: Record<string, JsonValue> = {}): ShowScoreInputs {
  return {
    showName: 'Friday Night Fury',
    importance: 'regular',
    format: { slots: 1, preShowSlots: 0 },
    slots: [
      {
        slot: 0,
        preShow: false,
        roleLabel: 'Main event',
        weight: constantOf('Main event weight', 1.75, 'Test weight'),
        filled: true,
        segmentId: null,
        kind: 'match',
        matchTypeKey: null,
        score: 60,
        participantIds: [],
        storylineIds: [],
      },
    ],
    extras,
  };
}

describe('show score modifier registry', () => {
  it('throws on a duplicate id', () => {
    register({ id: 'test.flow', stage: 'adjust', order: 1, apply: noop });
    expect(() => {
      registerShowScoreModifier({ id: 'test.flow', stage: 'cap', order: 2, apply: noop });
    }).toThrow(/already registered/);
  });

  it('refuses a malformed id, stage or order', () => {
    expect(() => {
      registerShowScoreModifier({ id: 'flow', stage: 'adjust', order: 1, apply: noop });
    }).toThrow(/system\.camelName/);
    expect(() => {
      registerShowScoreModifier({
        id: 'test.badStage',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- deliberately invalid test input
        stage: 'late' as ShowScoreModifier['stage'],
        order: 1,
        apply: noop,
      });
    }).toThrow(/stage/);
    expect(() => {
      registerShowScoreModifier({
        id: 'test.badOrder',
        stage: 'cap',
        order: Number.NaN,
        apply: noop,
      });
    }).toThrow(/order/);
  });

  it('lists modifiers by stage, then order, then id', () => {
    const before = listShowScoreModifiers().map((modifier) => modifier.id);
    register({ id: 'test.ceiling', stage: 'cap', order: 0, apply: noop });
    register({ id: 'test.late', stage: 'adjust', order: 9, apply: noop });
    register({ id: 'test.bravo', stage: 'adjust', order: 1, apply: noop });
    register({ id: 'test.alpha', stage: 'adjust', order: 1, apply: noop });
    const added = listShowScoreModifiers()
      .map((modifier) => modifier.id)
      .filter((id) => !before.includes(id));
    expect(added).toEqual(['test.alpha', 'test.bravo', 'test.late', 'test.ceiling']);
  });

  it('carries what gather returned to apply through inputs.extras', () => {
    register({
      id: 'test.repeats',
      stage: 'adjust',
      order: 1,
      gather: () => ({ repeats: 3 }),
      apply: (calc, _inputs, extra) => {
        const repeats =
          typeof extra === 'object' && extra !== null && 'repeats' in extra
            ? extra['repeats']
            : undefined;
        calc.subtract('Repeated matchups', typeof repeats === 'number' ? repeats * 2 : 0);
      },
    });
    // What the shows phase does: run every gather, then hand the results to the formula.
    // This gather reads nothing, so empty stand-ins are enough for the world and the show.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- unread stand-in
    const world = {} as GameWorldView;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- unread stand-in
    const show = {} as DeepReadonly<EventInstance>;
    // Only this test's modifier: the built-in ones (EVT4-02's production ceiling) read the world.
    const modifiers = listShowScoreModifiers().filter((modifier) => registered.includes(modifier.id));
    const extras: Record<string, JsonValue> = {};
    for (const modifier of modifiers) {
      if (modifier.gather !== undefined) {
        extras[modifier.id] = modifier.gather(world, show);
      }
    }
    const result = showScore(inputs(extras), {
      tunables: createEngineTunables(),
      modifiers,
    });
    expectTraceReplays(result.score);
    expect(
      expectTraceContains(result.score, { kind: 'subtract', label: 'Repeated matchups' }).operand,
    ).toBe(6);
    expect(result.rawScore).toBe(54);
  });

  it('restores the original list after unregistering', () => {
    const before = listShowScoreModifiers();
    registerShowScoreModifier({ id: 'test.temporary', stage: 'cap', order: 1, apply: noop });
    expect(listShowScoreModifiers()).toHaveLength(before.length + 1);
    expect(unregisterShowScoreModifier('test.temporary')).toBe(true);
    expect(listShowScoreModifiers()).toEqual(before);
    expect(unregisterShowScoreModifier('test.temporary')).toBe(false);
  });
});
