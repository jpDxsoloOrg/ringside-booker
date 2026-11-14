// Deal health on the shipped default world (ECO8-05): half a year as Altura with no player action
// (the player's shows air without a result, at neutral quality). No shipped deal is cancelled for
// low viewers, rival deals that reach their end date renew, and nothing fails. Pins ECO8-02's
// calibration against regressions. A half-year run: in the slow suite (RB_SLOW_TESTS=1).
// Design: docs/design/broadcast.md#deal-health
import { beforeAll, describe, expect, it } from 'vitest';
import { createEngine, type Engine } from '../../../../src/core/api';
import { addDays, compareDates, type GameDate } from '../../../../src/core/date';
import type { Deal } from '../../../../src/model/entities/deal';
import {
  EXPIRING_SOON_GATE_ID,
  RELEASE_REQUESTED_GATE_ID,
} from '../../../../src/systems/contracts/gates';
import { defaultSystems } from '../../../../src/systems';
import { OWN_WORKER_INJURED_GATE_ID } from '../../../../src/systems/health/gate';
import { COUNTER_WAITING_GATE_ID } from '../../../../src/systems/negotiation/gates';
import { SHOWS_TONIGHT_GATE_ID } from '../../../../src/systems/shows/tonight';
import { SLOW_TESTS } from '../../../support/slow';
import { systemsWithoutGates } from '../../../support/systems';
import { startDefaultGame } from '../../calendar/default-game';

// 182 days after the first one: the run's last day is 5 Jul 2027, Cielo Alto's deal's end date.
const DAYS = 183;

let engine: Engine;
let shipped: readonly Deal[];
let start: GameDate;
let failures: readonly unknown[];

describe.runIf(SLOW_TESTS)('half a year of deal health on the default world', () => {
  beforeAll(async () => {
    const state = startDefaultGame();
    shipped = state.world.tables.deals;
    start = state.world.meta.currentDate;
    engine = createEngine({
      state,
      systems: systemsWithoutGates(defaultSystems, [
        SHOWS_TONIGHT_GATE_ID,
        OWN_WORKER_INJURED_GATE_ID,
        EXPIRING_SOON_GATE_ID,
        RELEASE_REQUESTED_GATE_ID,
        COUNTER_WAITING_GATE_ID,
      ]),
    });
    const advanced = await engine.advanceDays({ maxDays: DAYS });
    expect(advanced.daysAdvanced).toBe(DAYS);
    failures = advanced.failures;
  }, 300_000);

  it('runs with no failures', () => {
    expect(failures).toEqual([]);
  });

  it('cancels no shipped deal for low viewers or missed airings', () => {
    const deals = engine.exportState().world.tables.deals;
    const ended = deals.filter(
      (deal) =>
        shipped.some((original) => original.id === deal.id) &&
        (deal.endedReason === 'lowViewers' || deal.endedReason === 'missedAirings'),
    );
    expect(ended.map((deal) => [deal.id, deal.endedReason])).toEqual([]);
  });

  it('renews the rival deals that reached their end date', () => {
    const state = engine.exportState().world;
    const end = addDays(start, DAYS);
    const human = new Set(
      state.tables.promotions
        .filter((promotion) => promotion.controller.kind === 'human')
        .map((promotion) => promotion.id),
    );
    const due = shipped.filter(
      (deal) =>
        deal.status === 'active' &&
        !human.has(deal.promotionId) &&
        compareDates(deal.endsOn, end) < 0,
    );
    // Cielo Alto's shipped deal ends in July 2027, inside the run.
    expect(due.length).toBeGreaterThan(0);
    for (const original of due) {
      const now = state.tables.deals.find((deal) => deal.id === original.id);
      expect(now, original.id).toMatchObject({ status: 'active', endedOn: null });
      expect(now?.renegotiatedOn, original.id).not.toBeNull();
      expect(compareDates(now?.endsOn ?? original.endsOn, end), original.id).toBeGreaterThan(0);
    }
  });
});
