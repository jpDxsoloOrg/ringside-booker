// Who may read which roster through roster.rows, and what a row never shows.
// Design: docs/design/roster.md#viewer-scoping
import { describe, expect, it } from 'vitest';
import {
  ROSTER_NO_PROMOTION,
  ROSTER_NOT_YOURS,
  ROSTER_UNKNOWN_PROMOTION,
} from '../../../src/systems/roster';
import { testId } from '../../support/ids';
import { expectSerialisable } from '../../support/trace';
import {
  COMPUTER,
  keysIn,
  OMNISCIENT,
  PLAYER,
  rosterOf,
  rosterTestWorld,
  SPECTATOR,
} from './roster-world';

const HIDDEN_KEYS = [
  'development',
  'potential',
  'ceilings',
  'vices',
  'terms',
  'monthlyWage',
  'perAppearanceFee',
  'wage',
  'wages',
];

describe('roster.rows: viewer scoping', () => {
  it("gives the player their own roster when they don't name one", () => {
    const world = rosterTestWorld();
    const view = rosterOf(world.engine, {}, PLAYER);
    expect(view.promotion?.promotionId).toBe(world.own);
    expect(view.rows.length).toBeGreaterThan(0);
    expect(rosterOf(world.engine, { promotionId: world.own }, PLAYER)).toEqual(view);
  });

  it("does not show the player a rival's roster", () => {
    const world = rosterTestWorld();
    const view = rosterOf(world.engine, { promotionId: world.rival }, PLAYER);
    expectSerialisable(view);
    expect(view).toEqual({ promotion: null, unavailableReason: ROSTER_NOT_YOURS, rows: [] });
    expect(ROSTER_NOT_YOURS).toBe(
      "You can only open your own roster here. Other promotions' workers are under World > Workers.",
    );
    expect(rosterOf(world.engine, { promotionId: world.own }, COMPUTER).rows).toEqual([]);
  });

  it("tells a seat that runs no promotion it doesn't have a roster", () => {
    const world = rosterTestWorld();
    for (const viewer of [SPECTATOR, COMPUTER, OMNISCIENT]) {
      expect(rosterOf(world.engine, {}, viewer)).toEqual({
        promotion: null,
        unavailableReason: ROSTER_NO_PROMOTION,
        rows: [],
      });
    }
  });

  it('lets the all-seeing viewer read any roster', () => {
    const world = rosterTestWorld();
    const rival = rosterOf(world.engine, { promotionId: world.rival }, OMNISCIENT);
    expect(rival.promotion?.name).toBe('Test Promotion B');
    expect(rival.rows).toHaveLength(3);
    expect(rival.rows.every((row) => row.promotionId === world.rival)).toBe(true);
    expect(rosterOf(world.engine, { promotionId: testId('promotion', 999) }, OMNISCIENT)).toEqual({
      promotion: null,
      unavailableReason: ROSTER_UNKNOWN_PROMOTION,
      rows: [],
    });
  });

  it('never puts development, vices, wages or contract terms in a row', () => {
    const world = rosterTestWorld();
    for (const view of [
      rosterOf(world.engine, {}, PLAYER),
      rosterOf(world.engine, { promotionId: world.rival }, OMNISCIENT),
    ]) {
      const keys = keysIn(view);
      for (const hidden of HIDDEN_KEYS) {
        expect(keys.has(hidden), hidden).toBe(false);
      }
    }
  });
});
