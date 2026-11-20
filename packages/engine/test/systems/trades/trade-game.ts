/**
 * Trade games for the trade tests (TRD-01, TRD-03): the shipped default world without a draft, run
 * by an engine with only the systems a trade needs (the sim, booking for the card writer, and
 * trades), so a day passes in a moment and no show-night stop gets in the way.
 */

import { createEngine, type Engine, type EngineState } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { OMNISCIENT_VIEWER } from '../../../src/core/api/controller';
import type { EmploymentId, PromotionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { GameWorld } from '../../../src/model/tables';
import { bookingSystem } from '../../../src/systems/booking';
import { tradesSystem } from '../../../src/systems/trades';
import type { TradeCandidateView, TradeTermsArgs } from '../../../src/systems/trades';
import { createEngineTunables, type EngineTunables } from '../../../src/systems/tunables';
import { PLAYER, PLAYER_VIEW, run, startDraftGame, worldOf } from '../draft/draft-game';

export { PLAYER, PLAYER_VIEW, run, worldOf };

export interface TradeGame {
  readonly engine: Engine;
  readonly me: PromotionId;
  readonly rival: PromotionId;
}

/** A new default-world game (no draft), seed `trades`. */
export function tradeState(seed = 'trades'): EngineState {
  return startDraftGame({ settings: { draftStart: false }, seed });
}

/** The trade engine on `state` with `overrides`. */
export function tradeEngine(state: EngineState, overrides: TunableOverrides = {}): Engine {
  return createEngine({
    state: { ...state, tunableOverrides: { ...state.tunableOverrides, ...overrides } },
    systems: [simSystem, bookingSystem, tradesSystem],
  });
}

/** The player's promotion and the first active rival by id. */
export function sidesOf(engine: Engine, rivalIndex = 0): { me: PromotionId; rival: PromotionId } {
  const promotions = engine.exportState().world.tables.promotions;
  const me = promotions.find((row) => row.controller.kind === 'human');
  const rivals = promotions.filter(
    (row) => row.controller.kind === 'computer' && row.status === 'active',
  );
  const rival = rivals[rivalIndex];
  if (me === undefined || rival === undefined) {
    throw new Error('default world has no player or rival');
  }
  return { me: me.id, rival: rival.id };
}

export function tradeGame(overrides: TunableOverrides = {}, rivalIndex = 0): TradeGame {
  const engine = tradeEngine(tradeState(), overrides);
  return { engine, ...sidesOf(engine, rivalIndex) };
}

/** Every worker of `promotionId` as a trade with `partnerId` sees them, best value first. */
export function candidates(
  engine: Engine,
  promotionId: PromotionId,
  partnerId: PromotionId,
): TradeCandidateView[] {
  return run(
    engine.query('trades.candidates', { promotionId, partnerId, limit: 500 }, OMNISCIENT_VIEWER),
  ).rows;
}

export function tradable(rows: readonly TradeCandidateView[]): TradeCandidateView[] {
  return rows.filter((row) => row.tradable && !row.noTradeClause && row.role === 'wrestler');
}

/** An offer from the player's side. */
export function terms(
  game: Pick<TradeGame, 'me' | 'rival'>,
  give: readonly EmploymentId[],
  get: readonly EmploymentId[],
  cash: { give?: number; get?: number } = {},
): TradeTermsArgs {
  return {
    promotionId: game.me,
    partnerId: game.rival,
    give: { employmentIds: [...give], cash: cents(cash.give ?? 0) },
    get: { employmentIds: [...get], cash: cents(cash.get ?? 0) },
  };
}

export function worldNow(engine: Engine): GameWorld {
  return worldOf(engine.exportState());
}

export function tunables(overrides: TunableOverrides = {}): EngineTunables {
  return createEngineTunables(overrides);
}

/** Advances one day, failing the test if a gate stopped it before the day ran. */
export async function nextDay(engine: Engine): Promise<void> {
  const result = await engine.advanceDays({ maxDays: 1 });
  if (result.daysAdvanced !== 1) {
    throw new Error(`The day did not run: ${JSON.stringify(result.stoppedBy)}`);
  }
}

export { PLAYER as PLAYER_CONTROLLER };
