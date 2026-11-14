// The player's temporary automatic renewal (ECO4-02 stopgap until ECO5).
// Design: docs/design/contracts.md#player-renewals
import { describe, expect, it } from 'vitest';
import { addDays, diffDays } from '../../../src/core/date';
import type { PromotionId } from '../../../src/core/ids';
import { isFullTrace } from '../../../src/core/trace/store';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES, type GameWorld } from '../../../src/model/tables';
import {
  PLAYER_AUTO_RENEWAL_POLICY_ID,
  renewalPolicies,
  renewalTraceRef,
  SIMPLE_RIVAL_RENEWAL_POLICY_ID,
} from '../../../src/systems/contracts';
import { createEngine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { contractsSystem } from '../../../src/systems/contracts';
import { resetTestIds, TEST_PLAYER_ID, worldBuilder } from '../../support';
import { SLOW_TESTS } from '../../support/slow';
import { startDefaultGame } from '../calendar/default-game';
import { contractsRuntime, runDays, setEndsOn } from './contract-world';

const ROSTER = 12;

/** The player of `startDefaultGame`. */
const DEFAULT_GAME_PLAYER = { kind: 'human', playerId: 'local-player' } as const;

/** The player's 12 workers, end dates spread over the first year; one rival worker likewise. */
function playerWorld() {
  resetTestIds();
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({ controller: { kind: 'human', playerId: TEST_PLAYER_ID } }, (promotion) =>
      promotion.withRoster(ROSTER),
    )
    .withPromotion({}, (promotion) => promotion.withRoster(1))
    .build();
  const start = world.meta.currentDate;
  ids.employments.forEach((employmentId, index) => {
    setEndsOn(world, employmentId, addDays(start, 20 + index * 25));
  });
  const human = ids.promotions.A;
  if (human === undefined) {
    throw new Error('expected the player promotion');
  }
  return { world, human, ids, start };
}

function activeCount(world: GameWorld, promotionId: PromotionId): number {
  return world.tables.employments.lookup('byPromotionStatus', `${promotionId}|active`).length;
}

/** Runs `days` days of a fresh player world and returns its first contract. */
function runDaysWith(
  built: ReturnType<typeof playerWorld>,
  overrides: Record<string, number | boolean>,
  days: number,
) {
  runDays(contractsRuntime(built.world, { ...STOPGAP_ON, ...overrides }, [], false), days);
  const [first] = built.ids.employments;
  if (first === undefined) {
    throw new Error('expected a contract');
  }
  return built.world.tables.employments.require(first);
}

/** The stopgap is off by default since ECO5-05 (the player renews through talks); these turn it on. */
const STOPGAP_ON = { 'contracts.autoRenewPlayer': true } as const;

describe('contracts.playerAutoRenewal', () => {
  it('is off by default now that the player can renew through talks (ECO5-05)', () => {
    const built = playerWorld();
    runDays(contractsRuntime(built.world, {}, [], false), 365);
    expect(activeCount(built.world, built.human)).toBe(0);
  });

  it('is asked before the rival rule', () => {
    const ids = renewalPolicies().map((policy) => policy.id);
    expect(ids.indexOf(PLAYER_AUTO_RENEWAL_POLICY_ID)).toBeLessThan(
      ids.indexOf(SIMPLE_RIVAL_RENEWAL_POLICY_ID),
    );
  });

  it("when on, keeps the player's whole roster through a year, renewing for a year at a time", () => {
    const built = playerWorld();
    const [first] = built.ids.employments;
    if (first === undefined) {
      throw new Error('expected a contract');
    }
    const runtime = contractsRuntime(built.world, STOPGAP_ON, [], false);
    runDays(runtime, 21);
    // The first contract ended on day 20 and was renewed for contracts.autoRenewPlayerDays.
    const events = runtime.bus.recent({ types: ['contract.renewed'] });
    expect(events.map((event) => event.payload)).toEqual([
      {
        employmentId: first,
        personId: built.world.tables.employments.require(first).personId,
        promotionId: built.human,
        previousEndsOn: addDays(built.start, 20),
        endsOn: addDays(built.start, 385),
        source: 'player',
      },
    ]);
    // The player's renewal Why? is kept in full.
    const why = runtime.traces.get(renewalTraceRef(first, addDays(built.start, 20)));
    expect(why).toMatchObject({ value: 'renew' });
    expect(why !== undefined && isFullTrace(why)).toBe(true);
    expect(JSON.stringify(why)).toContain('until you can renew contracts yourself');

    runDays(runtime, 344);
    expect(activeCount(built.world, built.human)).toBe(ROSTER);
    expect(built.world.tables.employments.require(first).endsOn).toBe(addDays(built.start, 385));
    expect(checkWorld(built.world, TABLES, { validateRows: true }).issues).toEqual([]);
  });

  it('lets them run out with contracts.autoRenewPlayer off', () => {
    const built = playerWorld();
    runDays(contractsRuntime(built.world, { 'contracts.autoRenewPlayer': false }, [], false), 365);
    expect(activeCount(built.world, built.human)).toBe(0);
  });

  it('counts the length from today on a save loaded long after the end date', () => {
    const built = playerWorld();
    const [first] = built.ids.employments;
    if (first === undefined) {
      throw new Error('expected a contract');
    }
    // Move the clock past even the renewed end date (day 20 + 365) without running the lifecycle.
    const moved = built.world.transact('test: jump', (tx) => {
      tx.setMeta({ currentDate: addDays(built.start, 400) });
    });
    if (!moved.ok) {
      throw moved.error;
    }
    runDays(contractsRuntime(built.world, STOPGAP_ON, [], false), 1);
    const row = built.world.tables.employments.require(first);
    expect(row.status).toBe('active');
    expect(diffDays(addDays(built.start, 400), row.endsOn ?? built.start)).toBe(365);
  });

  it('adds contracts.autoRenewPlayerDays', () => {
    const built = playerWorld();
    expect(runDaysWith(built, { 'contracts.autoRenewPlayerDays': 30 }, 21).endsOn).toBe(
      addDays(built.start, 50),
    );
  });
});

describe.runIf(SLOW_TESTS)('the default world', () => {
  it("keeps the player's roster for a year, and loses it with the stopgap off", async () => {
    const count = async (autoRenewPlayer: boolean) => {
      const engine = createEngine({
        state: startDefaultGame(),
        systems: [simSystem, contractsSystem],
      });
      for (const [key, value] of Object.entries({
        'contracts.autoRenewPlayer': autoRenewPlayer,
        'contracts.expiringSoon.stopSkip': false,
      })) {
        const set = engine.command('tunables.setOverride', { key, value }, DEFAULT_GAME_PLAYER);
        expect(set.ok).toBe(true);
      }
      const activeNow = (): number => {
        const { world } = engine.exportState();
        const human = world.tables.promotions.find(
          (promotion) => promotion.controller.kind === 'human',
        );
        return world.tables.employments.filter(
          (row) => row.promotionId === human?.id && row.status === 'active',
        ).length;
      };
      const before = activeNow();
      const result = await engine.advanceDays({ maxDays: 365 });
      expect(result.daysAdvanced).toBe(365);
      return { before, after: activeNow() };
    };
    const kept = await count(true);
    expect(kept.before).toBeGreaterThan(0);
    expect(kept.after).toBe(kept.before);
    const lost = await count(false);
    expect(lost.after).toBeLessThan(lost.before);
  }, 180_000);
});
