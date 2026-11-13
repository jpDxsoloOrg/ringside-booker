/**
 * The rival desk's new-game setup step: a profile for every computer-run unit.
 *
 * Order 895 puts it after `wld.assignControllers` (300), so a founded or chosen human promotion
 * gets no profile, and after the calendar's opening schedule (810). See
 * docs/design/new-game.md#setup-steps and docs/design/rival-desk.md#profiles.
 */

import type { GameTables } from '../../model/tables';
import type { Tx } from '../../model/tx';
import { registerSetupStep, type SetupContext } from '../newgame/steps';
import { ensureProfile } from './profiles';
import { computerUnits } from './units';

export const AIP_CREATE_PROFILES_STEP = { id: 'aip.createProfiles', order: 895 } as const;

function createProfiles(tx: Tx<GameTables>, ctx: SetupContext): void {
  const units = computerUnits(ctx.read);
  for (const unit of units) {
    ensureProfile(tx, ctx.read, unit, ctx.startDate);
  }
  ctx.log(`Gave ${String(units.length)} rival unit(s) a profile`);
}

registerSetupStep({ ...AIP_CREATE_PROFILES_STEP, run: createProfiles });
