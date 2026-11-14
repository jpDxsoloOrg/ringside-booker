// Rival rules shortcuts read through `aiShortcut` (AIP1-02, D-01).
// Design: docs/design/rival-desk.md#shortcuts
import { afterEach, describe, expect, it } from 'vitest';
import type { BrandId, PromotionId } from '../../../src/core/ids';
import { RegistryError } from '../../../src/core/errors';
import {
  AI_SHORTCUT_KEYS,
  AI_SHORTCUTS,
  aiShortcut,
  aiShortcutConsumers,
  aiShortcutOn,
  aiShortcutsFor,
  isAiShortcutFlag,
  registerAiShortcutConsumer,
  type AiShortcutFlagKey,
} from '../../../src/systems/aip';
import { createEngineTunables, type EngineTunables } from '../../../src/systems/tunables';
import { TEST_PLAYER_ID } from '../../support/builders/build-row';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';
import { worldBuilder, type BuiltWorld } from '../../support/world-builder';

const HUMAN = { kind: 'human', playerId: TEST_PLAYER_ID } as const;
const COMPUTER = { kind: 'computer' } as const;

const FLAG_KEYS: readonly AiShortcutFlagKey[] = AI_SHORTCUT_KEYS.filter(isAiShortcutFlag);

/** A: human promotion with brand 0 (no controller of its own) and brand 1 (a computer GM brand). B: computer. */
function rulesWorld(levelPlayingField = false): BuiltWorld {
  return worldBuilder({ settings: { levelPlayingField } })
    .withGeography('mini')
    .withPromotion({ controller: HUMAN }, (promotion) =>
      promotion.withBrand({ controller: null }).withBrand({ controller: COMPUTER }),
    )
    .withPromotion({ controller: COMPUTER })
    .build();
}

function promotion(built: BuiltWorld, label: 'A' | 'B'): PromotionId {
  const id = built.ids.promotions[label];
  if (id === undefined) {
    throw new Error(`no promotion ${label}`);
  }
  return id;
}

function brand(built: BuiltWorld, index: number): BrandId {
  const id = built.ids.brands[index];
  if (id === undefined) {
    throw new Error(`no brand ${String(index)}`);
  }
  return id;
}

const DEFAULTS: EngineTunables = createEngineTunables();

describe('aiShortcut', () => {
  it('lists the seven keys in order, the six flags first-class and the score bonus in points', () => {
    expect(AI_SHORTCUT_KEYS).toEqual([
      'ai.skipInMatchInjuries',
      'ai.skipResultMorale',
      'ai.scoreBonus',
      'ai.simpleBookingInputs',
      'ai.skipMediaRequests',
      'ai.skipWorkerRequests',
      'ai.contracts.simpleRenewals',
    ]);
    for (const key of AI_SHORTCUT_KEYS) {
      const def = DEFAULTS.def(key);
      expect(def.category).toBe('Rival rules');
      expect(def.docRef).toBe('rival-desk.md#shortcuts');
      expect(DEFAULTS.get(key)).toBe(isAiShortcutFlag(key) ? true : 3);
    }
  });

  it.each(FLAG_KEYS)(
    '%s is on for a computer promotion by default and off when overridden',
    (key) => {
      const built = rulesWorld();
      const proB = promotion(built, 'B');
      const on = aiShortcut(built.world, DEFAULTS, proB, key);
      expect(on.value).toBe(true);
      expect(on.trace).toMatchObject({
        kind: 'decision',
        label: `Rival shortcut: ${AI_SHORTCUTS[key].label}`,
        reason: 'Rival rules apply',
        docRef: 'rival-desk.md#shortcuts',
      });
      expectTraceContains(on, { kind: 'branch', label: 'Run by the computer' });
      expectTraceContains(on, { kind: 'branch', label: 'Level playing field is off' });
      expect(expectTraceContains(on, { kind: 'tunable' }).key).toBe(key);
      expectSerialisable(on);

      const off = aiShortcut(built.world, createEngineTunables({ [key]: false }), proB, key);
      expect(off.value).toBe(false);
      expect(off.trace).toMatchObject({ reason: 'This shortcut is turned off' });
      expect(expectTraceContains(off, { kind: 'tunable' })).toMatchObject({
        value: false,
        defaultValue: true,
        overridden: true,
      });
      expectSerialisable(off);
    },
  );

  it('reads every shortcut as off or 0 for a human promotion, naming the failed rule', () => {
    const built = rulesWorld();
    const proA = promotion(built, 'A');
    for (const key of FLAG_KEYS) {
      const result = aiShortcutOn(built.world, DEFAULTS, proA, key);
      expect(result.value).toBe(false);
      expect(result.trace).toMatchObject({ reason: 'Run by a player, not the computer' });
      expect(
        expectTraceContains(result, { kind: 'branch', label: 'Run by the computer' }).taken,
      ).toBe(false);
      expectSerialisable(result);
    }
    const bonus = aiShortcut(built.world, DEFAULTS, proA, 'ai.scoreBonus');
    expect(bonus.value).toBe(0);
    expect(expectTraceContains(bonus, { kind: 'branch', label: 'Run by the computer' }).taken).toBe(
      false,
    );
    expectTraceContains(bonus, { kind: 'note', label: 'Run by a player, not the computer' });
    expectTraceReplays(bonus);
  });

  it('reads every shortcut as off or 0 for every promotion under the level playing field', () => {
    const built = rulesWorld(true);
    for (const promotionId of [promotion(built, 'A'), promotion(built, 'B')]) {
      for (const key of FLAG_KEYS) {
        const result = aiShortcut(built.world, DEFAULTS, promotionId, key);
        expect(result.value).toBe(false);
        expect(
          expectTraceContains(result, { kind: 'branch', label: 'Level playing field is off' })
            .taken,
        ).toBe(false);
        expectSerialisable(result);
      }
      const bonus = aiShortcut(built.world, DEFAULTS, promotionId, 'ai.scoreBonus');
      expect(bonus.value).toBe(0);
      expect(
        expectTraceContains(bonus, { kind: 'branch', label: 'Level playing field is off' }).taken,
      ).toBe(false);
      expectTraceReplays(bonus);
    }
    const computerOnly = aiShortcut(built.world, DEFAULTS, promotion(built, 'B'), 'ai.scoreBonus');
    expectTraceContains(computerOnly, { kind: 'note', label: 'The level playing field is on' });
  });

  it('follows the brand: a computer GM brand gets the shortcut, a brand of the player does not', () => {
    const built = rulesWorld();
    const proA = promotion(built, 'A');
    const gmBrand = aiShortcut(built.world, DEFAULTS, proA, 'ai.skipResultMorale', brand(built, 1));
    expect(gmBrand.value).toBe(true);
    const ownBrand = aiShortcut(
      built.world,
      DEFAULTS,
      proA,
      'ai.skipResultMorale',
      brand(built, 0),
    );
    expect(ownBrand.value).toBe(false);
    expect(aiShortcut(built.world, DEFAULTS, proA, 'ai.scoreBonus', brand(built, 1)).value).toBe(3);
    expect(aiShortcut(built.world, DEFAULTS, proA, 'ai.scoreBonus', brand(built, 0)).value).toBe(0);
  });

  it('adds the score bonus for a computer promotion, and an override of 0 means 0', () => {
    const built = rulesWorld();
    const proB = promotion(built, 'B');
    const bonus = aiShortcut(built.world, DEFAULTS, proB, 'ai.scoreBonus');
    expect(bonus.value).toBe(3);
    expect(bonus.trace).toMatchObject({ label: 'Rival score bonus', unit: 'points' });
    expectTraceContains(bonus, { kind: 'add', label: 'Rival shortcut' });
    expectTraceReplays(bonus);

    const zero = aiShortcut(
      built.world,
      createEngineTunables({ 'ai.scoreBonus': 0 }),
      proB,
      'ai.scoreBonus',
    );
    expect(zero.value).toBe(0);
    expect(expectTraceContains(zero, { kind: 'tunable' })).toMatchObject({
      value: 0,
      overridden: true,
    });
    expectTraceReplays(zero);
  });

  it('aiShortcutsFor returns all seven, the same as asking one by one', () => {
    const built = rulesWorld();
    const proB = promotion(built, 'B');
    const all = aiShortcutsFor(built.world, DEFAULTS, proB);
    expect(Object.keys(all)).toEqual([...AI_SHORTCUT_KEYS]);
    for (const key of AI_SHORTCUT_KEYS) {
      expect(all[key]).toEqual(aiShortcut(built.world, DEFAULTS, proB, key));
    }
    expectSerialisable(all);
  });
});

describe('registerAiShortcutConsumer', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
  });

  it('lists consumers by key and refuses the same feature twice for one key', () => {
    cleanups.push(
      registerAiShortcutConsumer({
        key: 'ai.scoreBonus',
        featureId: 'TEST1',
        label: 'Test ratings',
      }),
    );
    cleanups.push(
      registerAiShortcutConsumer({
        key: 'ai.simpleBookingInputs',
        featureId: 'TEST1',
        label: 'Test ratings',
      }),
    );
    // MTCH1 (wired by the rival desk's rating policy, AIP1-07) registered first, on import.
    expect(aiShortcutConsumers('ai.scoreBonus')).toEqual([
      { key: 'ai.scoreBonus', featureId: 'MTCH1', label: 'Match ratings' },
      { key: 'ai.scoreBonus', featureId: 'TEST1', label: 'Test ratings' },
    ]);
    expect(() =>
      registerAiShortcutConsumer({ key: 'ai.scoreBonus', featureId: 'TEST1', label: 'Again' }),
    ).toThrow(RegistryError);
  });

  it('removes a registration with the function it returns', () => {
    const unregister = registerAiShortcutConsumer({
      key: 'ai.skipMediaRequests',
      featureId: 'TEST2',
      label: 'Test media',
    });
    expect(aiShortcutConsumers('ai.skipMediaRequests')).toHaveLength(1);
    unregister();
    expect(aiShortcutConsumers('ai.skipMediaRequests')).toEqual([]);
  });
});
