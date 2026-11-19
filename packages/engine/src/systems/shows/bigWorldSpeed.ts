/**
 * Big world speed (POL4-13): **Full detail** or **Fast**, Full detail by default.
 *
 * Chosen at new game and changeable in Settings (`world.setBigWorldSpeed`). Stored by key in
 * `WorldMeta.settings.extra`, only when it is Fast: a world on Full detail stores exactly what it
 * stored before the setting existed, so its results (and its world hash) are the same as before.
 *
 * - **Full detail** simulates every show in the world in full: today's behaviour.
 * - **Fast** runs *distant* rival shows on a light path ({@link isDistantShow}). Winners, title
 *   changes, the show score, attendance and money, injuries and news are worked out as usual. What
 *   is lighter: the segment traces keep only a summary, and the popularity a show moves (each
 *   competitor's and the promotion's) changes in the show's region only, without spreading to
 *   neighbours, TV regions and the rest of the map.
 *
 * Same seed and same setting give the same world. Changing the setting mid-game is allowed; the
 * future then plays out differently. Design: docs/design/show-night.md#big-world-speed.
 */

import { z } from 'zod';
import { defineCommand } from '../../core/api/command';
import { defineQuery } from '../../core/api/query';
import type { Controller } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import { isId, type PromotionId, type RegionId } from '../../core/ids';
import type { Promotion } from '../../model/entities/promotion';
import { isOpenNegotiationStatus } from '../../model/entities/negotiation';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { reachOf } from '../finance/reach';
import { getSetting, registerNewGameSetting, type NewGameSettingDef } from '../newgame/settings';
import type { EngineTunables } from '../tunables';
import type { ShowContext } from './context';

/** How much detail rival shows far from the player get. */
export const BIG_WORLD_SPEEDS = ['full', 'fast'] as const;
export type BigWorldSpeed = (typeof BIG_WORLD_SPEEDS)[number];

declare module '../../core/api/maps' {
  interface QueryMap {
    'world.bigWorldSpeed': { args: Record<string, never>; result: { speed: BigWorldSpeed } };
  }
  interface CommandMap {
    'world.setBigWorldSpeed': {
      args: { speed: BigWorldSpeed };
      result: { speed: BigWorldSpeed };
    };
  }
}

declare module '../newgame/settings' {
  interface NewGameSettingMap {
    bigWorldSpeed: BigWorldSpeed;
  }
}

export const BIG_WORLD_SPEED_SETTING: Readonly<NewGameSettingDef> = Object.freeze({
  key: 'bigWorldSpeed',
  kind: 'enum',
  options: [...BIG_WORLD_SPEEDS],
  default: 'full',
  label: 'Big world speed',
  description:
    'Full detail simulates every show; Fast simulates rival shows far from you more lightly, so long skips in big worlds are quicker.',
  group: 'world',
});

registerNewGameSetting(BIG_WORLD_SPEED_SETTING, { storeDefault: false });

/** The world's Big world speed (Full detail for a world from before the setting). */
export function bigWorldSpeedOf(read: Pick<GameWorldView, 'meta'>): BigWorldSpeed {
  return getSetting(read, 'bigWorldSpeed');
}

/** Employment statuses that tie a worker to a promotion: offered, signed or working. */
const TIED_EMPLOYMENT_STATUSES: ReadonlySet<string> = new Set(['offered', 'signed', 'active']);

/** The promotions a human runs: by their own controller or through one of their brands. */
function playerPromotionIds(read: GameWorldView): Set<PromotionId> {
  const ids = new Set<PromotionId>();
  for (const promotion of read.tables.promotions.values()) {
    if (promotion.controller.kind === 'human') {
      ids.add(promotion.id);
    }
  }
  for (const brand of read.tables.brands.values()) {
    if (brand.controller?.kind === 'human') {
      ids.add(brand.promotionId);
    }
  }
  return ids;
}

/** A promotion's regions: its home region and every region where it has at least `minPop`. */
function regionsOf(promotion: DeepReadonly<Promotion>, minPop: number): Set<RegionId> {
  const regions = new Set<RegionId>([promotion.homeRegionId]);
  for (const [regionId, popularity] of Object.entries(promotion.regionalPop)) {
    if (popularity >= minPop && isId('region', regionId)) {
      regions.add(regionId);
    }
  }
  return regions;
}

/** True when the card has anyone, any title or any storyline tied to a player's promotion. */
function cardTouchesPlayers(
  read: GameWorldView,
  show: ShowContext,
  players: ReadonlySet<PromotionId>,
): boolean {
  for (const { segment, sides } of show.segments) {
    if (segment.kind === 'match') {
      for (const titleId of segment.match.titleIds) {
        const title = read.tables.titles.get(titleId);
        if (title !== undefined && players.has(title.promotionId)) {
          return true;
        }
      }
    }
    for (const storylineId of segment.storylineIds) {
      const storyline = read.tables.storylines.get(storylineId);
      if (storyline !== undefined && players.has(storyline.promotionId)) {
        return true;
      }
    }
    for (const side of sides) {
      for (const personId of side.personIds) {
        const tied = read.tables.employments
          .lookup('byPerson', personId)
          .some(
            (employment) =>
              players.has(employment.promotionId) &&
              TIED_EMPLOYMENT_STATUSES.has(employment.status),
          );
        const courted = read.tables.negotiations
          .lookup('byPerson', personId)
          .some(
            (negotiation) =>
              players.has(negotiation.promotionId) && isOpenNegotiationStatus(negotiation.status),
          );
        if (tied || courted) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Why a show runs in full detail, or `distant` when Fast runs it on the light path. Checked in this
 * order; the first that applies is the answer.
 */
export const SHOW_DETAIL_VERDICTS = [
  'fullDetailSetting',
  'playerShow',
  'playerPromotion',
  'sharedRegion',
  'playerLink',
  'bigReach',
  'distant',
] as const;
export type ShowDetailVerdict = (typeof SHOW_DETAIL_VERDICTS)[number];

/**
 * Whether a show is **distant** from every player, so Fast runs it on the light path, and if not,
 * why not. A show is distant when all of these hold (anything else stays in full detail):
 *
 * 1. Big world speed is Fast (`fullDetailSetting`), and no human runs the show (`playerShow`).
 * 2. Its promotion is not a player's promotion, nor the parent or a child of one
 *    (`playerPromotion`).
 * 3. Its regions (the show's region, the promotion's home region and every region where the
 *    promotion has at least `bigWorld.regionPopularity`) do not overlap the players' regions (each
 *    player promotion's home region, its neighbours and every region where it has at least
 *    `bigWorld.regionPopularity`) (`sharedRegion`).
 * 4. Nobody on the card works for, is signed or offered to, or is negotiating with a player's
 *    promotion, and no title or storyline on the card belongs to one (`playerLink`).
 * 5. Its promotion's reach is below `bigWorld.fullDetailReach` (`bigReach`).
 *
 * In a world nobody plays, every computer show is distant in Fast. Reads only.
 */
export function showDetailVerdict(
  read: GameWorldView,
  show: ShowContext,
  tunables: EngineTunables,
): ShowDetailVerdict {
  if (bigWorldSpeedOf(read) !== 'fast') {
    return 'fullDetailSetting';
  }
  if (show.humanShow) {
    return 'playerShow';
  }
  const promotion = read.tables.promotions.require(show.promotionId);
  const players = playerPromotionIds(read);
  if (
    players.has(promotion.id) ||
    (promotion.parentPromotionId !== null && players.has(promotion.parentPromotionId))
  ) {
    return 'playerPromotion';
  }
  const minPop = tunables.get('bigWorld.regionPopularity');
  const playerRegions = new Set<RegionId>();
  for (const playerId of players) {
    const player = read.tables.promotions.require(playerId);
    if (player.parentPromotionId === promotion.id) {
      return 'playerPromotion';
    }
    for (const regionId of regionsOf(player, minPop)) {
      playerRegions.add(regionId);
    }
    const home = read.tables.regions.get(player.homeRegionId);
    for (const neighbourId of home?.neighbourRegionIds ?? []) {
      playerRegions.add(neighbourId);
    }
  }
  const rivalRegions = regionsOf(promotion, minPop);
  rivalRegions.add(show.regionId);
  for (const regionId of rivalRegions) {
    if (playerRegions.has(regionId)) {
      return 'sharedRegion';
    }
  }
  if (cardTouchesPlayers(read, show, players)) {
    return 'playerLink';
  }
  // Last, as it is the dearest check: one popularity roll-up.
  const reach = reachOf(read, promotion.id, tunables).reach.value;
  return reach >= tunables.get('bigWorld.fullDetailReach') ? 'bigReach' : 'distant';
}

/** True when Fast runs this show on the light path ({@link showDetailVerdict} is `distant`). */
export function isDistantShow(
  read: GameWorldView,
  show: ShowContext,
  tunables: EngineTunables,
): boolean {
  return showDetailVerdict(read, show, tunables) === 'distant';
}

/**
 * Who may change Big world speed: a human listed in `meta.players`, or anyone in a world with no
 * players (the same rule as Show night and the tunables).
 */
function settingPermission(read: GameWorldView, issuedBy: Controller): Reason[] {
  if (read.meta.players.length === 0) {
    return [];
  }
  if (
    issuedBy.kind === 'human' &&
    read.meta.players.some((player) => player.playerId === issuedBy.playerId)
  ) {
    return [];
  }
  return [{ code: 'notAllowed', message: 'Only a player in this game can change this setting.' }];
}

/**
 * Changes Big world speed mid-game. Full detail removes the stored value again, so the world's
 * settings read as if it had never left the default; the days already played stay as they were.
 */
export const setBigWorldSpeedCommand = defineCommand('world.setBigWorldSpeed', {
  args: z.strictObject({ speed: z.enum(BIG_WORLD_SPEEDS) }),
  validate: (read, _args, issuedBy) => settingPermission(read, issuedBy),
  apply: (ctx, args) => {
    const { settings } = ctx.read.meta;
    const entries = Object.entries(settings.extra).filter(([key]) => key !== 'bigWorldSpeed');
    if (args.speed !== BIG_WORLD_SPEED_SETTING.default) {
      entries.push(['bigWorldSpeed', args.speed]);
    }
    // Kept sorted by key, as a new game writes them.
    const extra = Object.fromEntries(
      entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    );
    ctx.tx.setMeta({ settings: { ...settings, season: { ...settings.season }, extra } });
    ctx.log(`Big world speed is now ${args.speed}`);
    return { speed: args.speed };
  },
});

/** `world.bigWorldSpeed`: the world's Big world speed, for the Settings screen. Public. */
export const bigWorldSpeedQuery = defineQuery('world.bigWorldSpeed', {
  args: z.strictObject({}),
  run: (ctx) => ({ speed: bigWorldSpeedOf(ctx.read) }),
});
