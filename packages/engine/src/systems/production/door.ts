/**
 * Changing a production level (ECO7-02): the one check and the one write door.
 *
 * - {@link checkLevelChange} works out the fee and every reason the change is not allowed. The
 *   `production.setLevel` command validates with it and the `production.changePreview` query
 *   shows it, so the change dialog can never promise a change the command refuses.
 * - {@link changeProductionLevel} is the only code that writes `promotions.production`. It
 *   re-runs the check (and throws on a reason, so a buggy caller's step rolls back), posts the fee
 *   through `postMoney` under the `production` category, writes the level and publishes
 *   `production.levelChanged`. The player's command and the rival desk (AIP8) both come through
 *   here, so everyone pays the same fee by the same rule (D-01).
 *
 * Design: docs/design/production.md#changing-a-level.
 */

import type { Reason } from '../../core/api/result';
import { addDays, type GameDate } from '../../core/date';
import { EntityNotFoundError, InvalidArgumentError } from '../../core/errors';
import type { PromotionId } from '../../core/ids';
import { cents } from '../../core/money';
import { startCalc } from '../../core/trace/calc';
import type { Traced } from '../../core/trace/types';
import {
  PRODUCTION_LEVEL_MAX,
  PRODUCTION_LEVEL_MIN,
  type ProductionArea,
} from '../../model/entities/promotion';
import type { GameWorldView } from '../../model/tables';
import { postMoney } from '../finance/post';
import { officeDateText } from '../office/dashboard/dateText';
import type { EngineTunables } from '../tunables';
import type { DoorContext } from '../workers/doors';
import { AREA_LABELS } from './areas';
import { activeBroadcastDeal } from './deals';
import type { ProductionChangeSource } from './events';
import { upgradeFee } from './formulas/upgradeFee';
import { moneyText, UPGRADE_FEE_DOC_REF } from './formulas/shared';

export const CHANGE_LEVEL_DOC_REF = 'docs/design/production.md#changing-a-level';

/** The reason codes a production level change can be refused with. */
export const PRODUCTION_CHANGE_REASON_CODES = [
  'production.promotionClosed',
  'production.outOfRange',
  'production.sameLevel',
  'production.tvDealCamera',
  'production.cannotAfford',
] as const;
export type ProductionChangeReasonCode = (typeof PRODUCTION_CHANGE_REASON_CODES)[number];

/** A change someone wants: one area of one promotion to one level. */
export interface LevelChangeRequest {
  promotionId: PromotionId;
  area: ProductionArea;
  level: number;
}

/** What {@link checkLevelChange} found. */
export interface LevelChangeCheck {
  /** The area's level now. */
  from: number;
  /** The upgrade fee, in cents (0 for lowering, and for a level out of range). */
  fee: Traced<number>;
  /** Every reason the change is not allowed; empty when it is. */
  reasons: Reason[];
}

function isProductionLevel(level: number): boolean {
  return Number.isInteger(level) && level >= PRODUCTION_LEVEL_MIN && level <= PRODUCTION_LEVEL_MAX;
}

function noFee(label: string): Traced<number> {
  return startCalc(label, 0, {
    unit: 'money',
    docRef: UPGRADE_FEE_DOC_REF,
    startLabel: 'No fee',
  }).done();
}

/**
 * The fee for the change and every reason it is not allowed on `date`. Reads only. Throws
 * `EntityNotFoundError` for an unknown promotion (callers check that first).
 */
export function checkLevelChange(
  read: GameWorldView,
  request: LevelChangeRequest,
  tunables: EngineTunables,
  date: GameDate,
): LevelChangeCheck {
  const promotion = read.tables.promotions.get(request.promotionId);
  if (promotion === undefined) {
    throw new EntityNotFoundError('promotion', request.promotionId);
  }
  const { area, level } = request;
  const label = AREA_LABELS[area];
  const from = promotion.production[area];
  const subject = { kind: 'promotion', id: promotion.id } as const;
  const reasons: Reason[] = [];

  if (promotion.status !== 'active') {
    reasons.push({
      code: 'production.promotionClosed',
      message:
        promotion.status === 'closed'
          ? `${promotion.name} has closed`
          : `${promotion.name} is not running shows, so its production can't change`,
      subject,
    });
  }

  if (!isProductionLevel(level)) {
    reasons.push({
      code: 'production.outOfRange',
      message: `${label} levels run from ${String(PRODUCTION_LEVEL_MIN)} to ${String(PRODUCTION_LEVEL_MAX)}`,
      field: 'level',
    });
    return { from, fee: noFee(`${label} ${String(from)} → ${String(level)}`), reasons };
  }

  const fee = upgradeFee({ area, from, to: level }, { tunables });

  if (level === from) {
    reasons.push({
      code: 'production.sameLevel',
      message: `${label} is already at level ${String(from)}`,
      field: 'level',
    });
  }

  const minCamera = tunables.get('production.tvDealMinCamera');
  if (area === 'camera' && level < minCamera && level < from) {
    const deal = activeBroadcastDeal(read, promotion.id, date);
    if (deal !== null) {
      const network = read.tables.networks.get(deal.networkId)?.name ?? 'a network';
      const lastDay = officeDateText(addDays(deal.endsOn, -1), date);
      reasons.push({
        code: 'production.tvDealCamera',
        message: `You have an active TV deal with ${network} until ${lastDay}: camera can't go below level ${String(minCamera)}`,
        subject: { kind: 'deal', id: deal.id },
      });
    }
  }

  if (tunables.get('production.feeNeedsCash') && fee.value > promotion.cash) {
    reasons.push({
      code: 'production.cannotAfford',
      message: `The fee is ${moneyText(fee.value)} and you have ${moneyText(promotion.cash)}`,
      subject,
    });
  }

  return { from, fee, reasons };
}

/** What {@link changeProductionLevel} is asked to do. */
export interface ChangeProductionLevelArgs extends LevelChangeRequest {
  source: ProductionChangeSource;
}

/**
 * Sets one production area of a promotion to `level`, paying the upgrade fee. Throws
 * `InvalidArgumentError` when {@link checkLevelChange} has any reason, so the caller's step rolls
 * back. Returns the fee paid, in cents.
 */
export function changeProductionLevel(
  ctx: DoorContext,
  args: ChangeProductionLevelArgs,
): { fee: number } {
  const { promotionId, area, level, source } = args;
  const check = checkLevelChange(ctx.read, { promotionId, area, level }, ctx.tunables, ctx.date);
  const refused = check.reasons[0];
  if (refused !== undefined) {
    throw new InvalidArgumentError(
      'changeProductionLevel',
      'level',
      level,
      `a change the rules allow (${refused.message})`,
    );
  }
  const { from, fee } = check;
  const label = AREA_LABELS[area];

  if (fee.value > 0) {
    const paid = startCalc(`${label} upgrade paid`, 0, {
      unit: 'money',
      docRef: CHANGE_LEVEL_DOC_REF,
      startLabel: 'Nothing paid yet',
    })
      .subtract(`Upgrade fee, ${label.toLowerCase()} ${String(from)} → ${String(level)}`, fee)
      .done();
    postMoney(ctx, {
      promotionId,
      category: 'production',
      amount: cents(paid.value),
      memo: `${label} upgrade: level ${String(from)} to ${String(level)}`,
      trace: paid,
    });
  }

  ctx.tx.update('promotions', promotionId, (previous) => ({
    ...previous,
    production: { ...previous.production, [area]: level },
  }));
  ctx.publish('production.levelChanged', {
    promotionId,
    area,
    from,
    to: level,
    fee: fee.value,
    source,
  });
  return { fee: fee.value };
}
