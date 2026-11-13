// The `aip.rules` query behind the Rival rules chip (AIP1-02).
// Design: docs/design/rival-desk.md#shortcuts
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine, type Viewer } from '../../../src/core/api';
import { registerAiShortcutConsumer, type AipRulesView } from '../../../src/systems/aip';
import { defaultSystems } from '../../../src/systems';
import { TEST_PLAYER_ID } from '../../support/builders/build-row';
import { worldBuilder } from '../../support/world-builder';

const HUMAN = { kind: 'human', playerId: TEST_PLAYER_ID } as const;
const PLAYER: Viewer = { kind: 'controller', controller: HUMAN };

function rulesEngine(levelPlayingField = false): Engine {
  const { world } = worldBuilder({ settings: { levelPlayingField } })
    .withGeography('mini')
    .withPromotion({ controller: HUMAN })
    .withPromotion({ controller: { kind: 'computer' } })
    .build();
  return createEngine({ state: initialEngineState(world), systems: defaultSystems });
}

function rules(engine: Engine): AipRulesView {
  const result = engine.query('aip.rules', {}, PLAYER);
  if (!result.ok) {
    expect.fail(JSON.stringify(result.reasons));
  }
  return result.data;
}

function shortcut(view: AipRulesView, key: string) {
  const found = view.shortcuts.find((row) => row.key === key);
  if (found === undefined) {
    expect.fail(`no shortcut ${key}`);
  }
  return found;
}

describe('aip.rules', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
  });

  it('lists the six shortcuts, all in force by default', () => {
    const view = rules(rulesEngine());
    expect(view.levelPlayingField).toBe(false);
    expect(view.appliesTo).toBe('computer');
    expect(view.shortcuts.map((row) => [row.key, row.kind, row.value, row.inForce])).toEqual([
      ['ai.skipInMatchInjuries', 'flag', true, true],
      ['ai.skipResultMorale', 'flag', true, true],
      ['ai.scoreBonus', 'points', 3, true],
      ['ai.simpleBookingInputs', 'flag', true, true],
      ['ai.skipMediaRequests', 'flag', true, true],
      ['ai.skipWorkerRequests', 'flag', true, true],
    ]);
    expect(shortcut(view, 'ai.skipInMatchInjuries')).toMatchObject({
      label: 'No in-match injuries',
      description:
        "Rivals' matches cause no in-match injuries; their injuries come from daily world events",
      defaultValue: true,
      overridden: false,
    });
  });

  it('shows the six keys under Rival rules in tunables.list', () => {
    const list = rulesEngine().query('tunables.list', { category: 'Rival rules' }, PLAYER);
    if (!list.ok) {
      expect.fail(JSON.stringify(list.reasons));
    }
    // The list is sorted by key.
    expect(list.data.map((row) => [row.key, row.default])).toEqual([
      ['ai.scoreBonus', 3],
      ['ai.simpleBookingInputs', true],
      ['ai.skipInMatchInjuries', true],
      ['ai.skipMediaRequests', true],
      ['ai.skipResultMorale', true],
      ['ai.skipWorkerRequests', true],
    ]);
  });

  it('follows the tunable: an override turns a shortcut out of force', () => {
    const engine = rulesEngine();
    for (const [key, value] of [
      ['ai.skipMediaRequests', false],
      ['ai.scoreBonus', 0],
    ] as const) {
      const set = engine.command('tunables.setOverride', { key, value }, HUMAN);
      expect(set.ok).toBe(true);
    }
    const view = rules(engine);
    expect(shortcut(view, 'ai.skipMediaRequests')).toMatchObject({
      value: false,
      defaultValue: true,
      overridden: true,
      inForce: false,
    });
    expect(shortcut(view, 'ai.scoreBonus')).toMatchObject({
      value: 0,
      defaultValue: 3,
      overridden: true,
      inForce: false,
    });
    expect(shortcut(view, 'ai.skipResultMorale').inForce).toBe(true);
  });

  it('follows the setting: the level playing field puts every shortcut out of force', () => {
    const view = rules(rulesEngine(true));
    expect(view.levelPlayingField).toBe(true);
    expect(view.shortcuts.every((row) => !row.inForce)).toBe(true);
    expect(shortcut(view, 'ai.scoreBonus').value).toBe(3);
  });

  it('lists the features registered as consumers of each shortcut', () => {
    const engine = rulesEngine();
    expect(shortcut(rules(engine), 'ai.scoreBonus').consumers).toEqual([]);
    cleanups.push(
      registerAiShortcutConsumer({ key: 'ai.scoreBonus', featureId: 'TEST1', label: 'Ratings' }),
      registerAiShortcutConsumer({ key: 'ai.scoreBonus', featureId: 'TEST2', label: 'Lab' }),
    );
    const view = rules(engine);
    expect(shortcut(view, 'ai.scoreBonus').consumers).toEqual(['Ratings', 'Lab']);
    expect(shortcut(view, 'ai.skipResultMorale').consumers).toEqual([]);
    expect(shortcut(view, 'ai.scoreBonus').consumer).toBe('Match ratings (MTCH1)');
  });
});
