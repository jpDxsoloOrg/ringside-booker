/**
 * The office system's new-game setup step: the baseline history row.
 *
 * Order 990: after every catalog setup step (the built-ins, calendar 810, finance 905 and the
 * later features up to SOC1 940), so the row records the world as the player first sees it. One
 * `baseline` row dated the start date for every active promotion, so the first week already has
 * something to compare with. A game that starts on a Monday turns this row into that Monday's
 * weekly row when the day is simulated. It then records every active promotion's headline
 * popularity Why? (DAY2-02). See docs/design/new-game.md#setup-steps and
 * docs/design/office.md#history.
 */

import type { GameTables } from '../../model/tables';
import type { Tx } from '../../model/tx';
import { registerSetupStep, type SetupContext } from '../newgame/steps';
import { writePromotionSnapshots } from './history/writeSnapshots';
import { recordAllHeadlinePopularity } from './popularity';

export const OFFICE_BASELINE_SNAPSHOT_STEP = { id: 'office.baselineSnapshot', order: 990 } as const;

function writeBaselineSnapshots(tx: Tx<GameTables>, ctx: SetupContext): void {
  const written = writePromotionSnapshots(tx, ctx.startDate, 'baseline', ['active'], ctx.tunables);
  ctx.log(`Recorded the opening snapshot of ${String(written.length)} promotion(s)`);
  // The headline popularity Why? (DAY2-02), so the top bar can explain its figure from day one.
  const traced = recordAllHeadlinePopularity(ctx);
  ctx.log(`Recorded the headline popularity of ${String(traced)} promotion(s)`);
}

registerSetupStep({ ...OFFICE_BASELINE_SNAPSHOT_STEP, run: writeBaselineSnapshots });
