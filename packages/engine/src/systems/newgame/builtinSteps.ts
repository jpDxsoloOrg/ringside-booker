/**
 * The built-in new-game setup steps, registered in this fixed order:
 *
 * | Order | Step                           | Runs when                    |
 * | ----- | ------------------------------ | ---------------------------- |
 * | 100   | `wld.applyTunableOverrides`    | always                       |
 * | 200   | `wld.foundPromotion`           | the player founds a company  |
 * | 300   | `wld.assignControllers`        | always                       |
 * | 400   | `wld.contractExpiryFixup`      | always                       |
 * | 500   | `wld.randomiseContractLengths` | `randomiseContractLengths`   |
 * | 600   | `wld.equalStart`               | `equalStart`                 |
 * | 700   | `wld.rerollPotential`          | `rerollPotential`            |
 * | 800   | `wld.storeSettings`            | always                       |
 *
 * See docs/design/new-game.md#setup-steps.
 */

import { addDays, compareDates } from '../../core/date';
import { InvariantError } from '../../core/errors';
import { cents } from '../../core/money';
import { intBetween } from '../../core/rng/odds';
import type { RegionId } from '../../core/ids';
import type { GameTables } from '../../model/tables';
import type { Tx } from '../../model/tx';
import { reseedPotential } from '../world/people/reseed';
import { geographyOf } from '../world/geography';
import { createEngineTunables } from '../tunables';
import { contentIdOf } from './contentKeys';
import { foundPromotion } from './foundPromotion';
import { worldSettingsFrom } from './settings';
import { registerSetupStep, type SetupContext } from './steps';
import { CONTRACT_FIXUP_STREAM, CONTRACT_LENGTH_STREAM, POTENTIAL_STREAM } from './streams';

/** Built-in step ids, in run order. */
export const BUILT_IN_SETUP_STEPS = [
  { id: 'wld.applyTunableOverrides', order: 100 },
  { id: 'wld.foundPromotion', order: 200 },
  { id: 'wld.assignControllers', order: 300 },
  { id: 'wld.contractExpiryFixup', order: 400 },
  { id: 'wld.randomiseContractLengths', order: 500 },
  { id: 'wld.equalStart', order: 600 },
  { id: 'wld.rerollPotential', order: 700 },
  { id: 'wld.storeSettings', order: 800 },
] as const;

/** 100: the input's tunable overrides apply to every later step and are saved with the game. */
function applyTunableOverrides(_tx: Tx<GameTables>, ctx: SetupContext): void {
  const overrides = ctx.input.tunableOverrides ?? {};
  ctx.session.tunables = createEngineTunables(overrides);
  ctx.log(`Applied ${String(Object.keys(overrides).length)} tunable override(s)`);
}

/** 200: founds the player's promotion. */
function foundPlayerPromotion(tx: Tx<GameTables>, ctx: SetupContext): void {
  const choice = ctx.input.player;
  if (choice.mode !== 'found') {
    return;
  }
  const homeRegionId = contentIdOf(tx.view.meta, 'region', choice.homeRegionKey);
  if (homeRegionId === null) {
    throw new InvariantError(`Home region "${choice.homeRegionKey}" is not in the world`);
  }
  ctx.session.humanPromotionId = foundPromotion(ctx, {
    name: choice.name,
    shortName: choice.shortName,
    homeRegionId,
    style: choice.style,
    size: choice.size,
    color: choice.color,
    starterKit: choice.starterKit,
    weeklyShowDay: choice.weeklyShowDay,
  });
}

/**
 * 300 (design decision D-07): the player's promotion gets a human controller and every other
 * promotion the computer. Brands keep a null controller (run by their promotion's controller). The
 * world gets its name and its player list; nothing anywhere names "the player's promotion".
 */
function assignControllers(tx: Tx<GameTables>, ctx: SetupContext): void {
  const humanPromotionId = ctx.session.humanPromotionId;
  if (humanPromotionId === null) {
    throw new InvariantError('No promotion was chosen or founded for the player');
  }
  const { playerId, playerName, saveName } = ctx.input;
  tx.setMeta({ worldName: saveName, players: [{ playerId, displayName: playerName }] });
  for (const promotion of [...tx.view.tables.promotions.values()]) {
    tx.update('promotions', promotion.id, {
      controller:
        promotion.id === humanPromotionId ? { kind: 'human', playerId } : { kind: 'computer' },
    });
  }
  for (const brand of [...tx.view.tables.brands.values()]) {
    if (brand.controller !== null) {
      tx.update('brands', brand.id, { controller: null });
    }
  }
}

/**
 * 400: a running contract that ends on or before the first day gets a new end date a random
 * number of days after it, so a pack with stale dates does not empty rosters on day one.
 */
function contractExpiryFixup(tx: Tx<GameTables>, ctx: SetupContext): void {
  const stream = ctx.rng(CONTRACT_FIXUP_STREAM);
  const minDays = ctx.tunables.get('newgame.contractFixup.minDays');
  const maxDays = ctx.tunables.get('newgame.contractFixup.maxDays');
  let fixed = 0;
  for (const employment of [...tx.view.tables.employments.values()]) {
    if (
      employment.status !== 'active' ||
      employment.endsOn === null ||
      compareDates(employment.endsOn, ctx.startDate) > 0
    ) {
      continue;
    }
    const days = intBetween(stream, Math.min(minDays, maxDays), Math.max(minDays, maxDays));
    tx.update('employments', employment.id, { endsOn: addDays(ctx.startDate, days) });
    fixed += 1;
  }
  ctx.log(`Moved ${String(fixed)} contract end date(s) past the start date`);
}

/** 500: every running contract with an end date gets a new random one. */
function randomiseContractLengths(tx: Tx<GameTables>, ctx: SetupContext): void {
  const stream = ctx.rng(CONTRACT_LENGTH_STREAM);
  const minDays = ctx.tunables.get('newgame.contractLength.minDays');
  const maxDays = ctx.tunables.get('newgame.contractLength.maxDays');
  for (const employment of [...tx.view.tables.employments.values()]) {
    if (employment.status !== 'active' || employment.endsOn === null) {
      continue;
    }
    const days = intBetween(stream, Math.min(minDays, maxDays), Math.max(minDays, maxDays));
    tx.update('employments', employment.id, { endsOn: addDays(ctx.startDate, days) });
  }
}

/**
 * 600: the one-time equal start reset. Every promotion gets the same cash and prestige, the same
 * popularity in every region of its home country and none elsewhere, and every deal is removed.
 * Separate from the lasting `levelPlayingField` setting (design decision D-01).
 */
function equalStart(tx: Tx<GameTables>, ctx: SetupContext): void {
  const geography = geographyOf(tx.view);
  const cash = cents(ctx.tunables.get('newgame.equalStart.cash'));
  const homePopularity = ctx.tunables.get('newgame.equalStart.homePopularity');
  const prestige = ctx.tunables.get('newgame.equalStart.prestige');
  for (const promotion of [...tx.view.tables.promotions.values()]) {
    const regionalPop: Record<RegionId, number> = {};
    if (homePopularity > 0) {
      const homeCountry = geography.countryOf(promotion.homeRegionId);
      for (const region of geography.regionsOf(homeCountry.id)) {
        regionalPop[region.id] = homePopularity;
      }
    }
    tx.update('promotions', promotion.id, { cash, prestige, regionalPop });
  }
  const dealIds = tx.view.tables.deals.ids();
  for (const dealId of [...dealIds]) {
    tx.delete('deals', dealId);
  }
  ctx.log(`Reset every promotion and removed ${String(dealIds.length)} deal(s)`);
}

/** 700: fresh potential for everyone (WLD-07 `reseedPotential`). */
function rerollPotential(tx: Tx<GameTables>, ctx: SetupContext): void {
  const results = reseedPotential(tx, {}, ctx.rng(POTENTIAL_STREAM), {
    library: ctx.library,
    tunables: ctx.tunables,
  });
  ctx.log(`Re-rolled potential for ${String(results.length)} people`);
}

/**
 * 800: stores every setting in `WorldMeta.settings` and re-asserts the season length, so the stored
 * setting and season 1 can never disagree.
 */
function storeSettings(tx: Tx<GameTables>, ctx: SetupContext): void {
  tx.setMeta({ settings: worldSettingsFrom(ctx.settings, ctx.seasonLengthDays) });
}

registerSetupStep({ ...BUILT_IN_SETUP_STEPS[0], run: applyTunableOverrides });
registerSetupStep({
  ...BUILT_IN_SETUP_STEPS[1],
  when: (_settings, input) => input.player.mode === 'found',
  run: foundPlayerPromotion,
});
registerSetupStep({ ...BUILT_IN_SETUP_STEPS[2], run: assignControllers });
registerSetupStep({ ...BUILT_IN_SETUP_STEPS[3], run: contractExpiryFixup });
registerSetupStep({
  ...BUILT_IN_SETUP_STEPS[4],
  when: (settings) => settings['randomiseContractLengths'] === true,
  run: randomiseContractLengths,
});
registerSetupStep({
  ...BUILT_IN_SETUP_STEPS[5],
  when: (settings) => settings['equalStart'] === true,
  run: equalStart,
});
registerSetupStep({
  ...BUILT_IN_SETUP_STEPS[6],
  when: (settings) => settings['rerollPotential'] === true,
  run: rerollPotential,
});
registerSetupStep({ ...BUILT_IN_SETUP_STEPS[7], run: storeSettings });
