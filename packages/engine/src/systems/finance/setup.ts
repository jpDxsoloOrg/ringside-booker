/**
 * The finance system's new-game setup step: the opening cash Why?.
 *
 * Order 905: after the built-in steps (whose controllers and equal-start cash it reads) and before
 * ECO3's 920. It records the cash trace of every human-controlled promotion, so the top bar's cash
 * has a Why? ("Opening balance") before the first ledger row is posted. See
 * docs/design/new-game.md#setup-steps and docs/design/finances.md#queries.
 */

import type { GameTables } from '../../model/tables';
import type { Tx } from '../../model/tx';
import { registerSetupStep, type SetupContext } from '../newgame/steps';
import { recordCashTrace } from './cashTrace';

export const FINANCE_OPENING_BALANCE_STEP = { id: 'finance.openingBalance', order: 905 } as const;

function recordOpeningBalances(_tx: Tx<GameTables>, ctx: SetupContext): void {
  let recorded = 0;
  for (const promotion of ctx.read.tables.promotions.values()) {
    if (promotion.status === 'closed' || promotion.controller.kind !== 'human') {
      continue;
    }
    recordCashTrace(ctx, promotion.id, { opening: true });
    recorded += 1;
  }
  ctx.log(`Recorded the opening cash of ${String(recorded)} promotion(s)`);
}

registerSetupStep({ ...FINANCE_OPENING_BALANCE_STEP, run: recordOpeningBalances });
