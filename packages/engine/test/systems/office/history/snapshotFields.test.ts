// The promotion history field registry (DAY2-01). Design: docs/design/office.md#history
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine, initialEngineState } from '../../../../src/core/api';
import { simSystem } from '../../../../src/core/api/builtins';
import { RegistryError } from '../../../../src/core/errors';
import { parseGameDate } from '../../../../src/core/date';
import { constantOf } from '../../../../src/core/trace/helpers';
import {
  officeSystem,
  promotionSnapshotFields,
  registerPromotionSnapshotField,
  type PromotionSnapshotFieldSpec,
} from '../../../../src/systems/office';
import { worldBuilder } from '../../../support/world-builder';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function field(
  key: string,
  extract: PromotionSnapshotFieldSpec['extract'] = () => 1,
): PromotionSnapshotFieldSpec {
  return { key, label: `Test ${key}`, unit: 'points', visibility: 'public', extract };
}

function register(spec: PromotionSnapshotFieldSpec): () => void {
  const unregister = registerPromotionSnapshotField(spec);
  cleanups.push(unregister);
  return unregister;
}

describe('registerPromotionSnapshotField', () => {
  it('lists registered fields in key order', () => {
    register(field('test.zeta'));
    register(field('test.alpha'));
    expect(promotionSnapshotFields().map((spec) => spec.key)).toEqual(['test.alpha', 'test.zeta']);
  });

  it('refuses a duplicate key, naming it', () => {
    register(field('test.hype'));
    expect(() => registerPromotionSnapshotField(field('test.hype'))).toThrow(RegistryError);
    expect(() => registerPromotionSnapshotField(field('test.hype'))).toThrow(/test\.hype/);
  });

  it.each(['cash', 'prestige', 'popularity', 'popularity.world', 'rosterSize', 'averageMorale'])(
    'refuses the built-in column %s',
    (key) => {
      expect(() => registerPromotionSnapshotField(field(key))).toThrow(
        new RegExp(`"${key.replace('.', '\\.')}".*built-in`),
      );
    },
  );

  it.each(['', 'Hype', 'hype.', '.hype', 'hype..trend', 'hype-trend', '1hype', 'hype.Trend'])(
    'refuses the malformed key "%s"',
    (key) => {
      expect(() => registerPromotionSnapshotField(field(key))).toThrow(RegistryError);
    },
  );

  it('accepts a key that only starts like a built-in column', () => {
    register(field('cashFlow'));
    expect(promotionSnapshotFields().map((spec) => spec.key)).toContain('cashFlow');
  });

  it('removes the field again when unregistered', () => {
    const unregister = register(field('test.gone'));
    unregister();
    expect(promotionSnapshotFields().map((spec) => spec.key)).not.toContain('test.gone');
  });
});

describe('registered fields in the weekly snapshot', () => {
  it('appear from the next snapshot on; earlier rows lack the key; traced values store the value', async () => {
    const start = parseGameDate('2026-01-05');
    const { world, ids } = worldBuilder({ startDate: start, currentDate: start })
      .withGeography('mini')
      .withPromotion()
      .build();
    const engine = createEngine({
      state: initialEngineState(world),
      systems: [simSystem, officeSystem],
    });
    await engine.advanceDays({ maxDays: 7 });

    register(field('test.zero', () => 0));
    register(field('test.skipped', () => null));
    register(
      field('test.traced', (promotion) =>
        constantOf('Half the prestige', promotion.prestige / 2, 'A test field'),
      ),
    );
    await engine.advanceDays({ maxDays: 7 });

    const rows = engine
      .exportState()
      .world.tables.promotionSnapshots.filter((row) => row.promotionId === ids.promotions.A)
      .sort((left, right) => (left.date < right.date ? -1 : 1));
    expect(rows.map((row) => [row.date, row.extra])).toEqual([
      ['2026-01-05', {}],
      ['2026-01-12', { 'test.traced': 25, 'test.zero': 0 }],
    ]);
  });
});
