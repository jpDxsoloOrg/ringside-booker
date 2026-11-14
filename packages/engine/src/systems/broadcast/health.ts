/**
 * Deal health in the day (ECO8-05): the network's verdict after every airing, cancellations,
 * warnings, expiry and the rivals' renewal. Design: docs/design/broadcast.md#deal-health.
 *
 * Phase `broadcast.dealHealth` (daily, `settlement` 45, after `broadcast.airings` at 40):
 *
 * 1. Every deal with an airing row dated today gets a fresh `dealHealth` verdict, stored at
 *    `dealHealthTraceRef(dealId)` (one trace per deal, replaced each time). Cancelling for missed
 *    airings ends the deal at once; cancelling for low viewers rolls the network's patience
 *    (`broadcast.health` stream) and ends it on a hit. The roll happens only on airing days, so a
 *    long skip with no shows never cancels a deal for low viewers.
 * 2. Every active deal: a closed network ends it (`networkClosed`); on or after `endsOn` it
 *    expires, or a computer promotion's deal renews through the same valuation the player's
 *    `broadcast.renegotiate` uses (`broadcast.rivals.autoRenew`).
 * 3. Human promotions' deals at risk, cancelling or ending soon are warned once per
 *    `broadcast.health.warnEveryDays` (`warnedOn`, `broadcast.dealWarned`). The warning never stops
 *    the day; the Networks screen shows the risk badge and ECO8-07 turns the event into mail.
 */

import { addMonths, compareDates, diffDays, type GameDate } from '../../core/date';
import type { DealId } from '../../core/ids';
import { cents } from '../../core/money';
import type { StepContext } from '../../core/pipeline/context';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import { rollChance } from '../../core/rng/rolls';
import { startCalc, startDecision } from '../../core/trace';
import type { Airing } from '../../model/entities/airing';
import type { Deal, DealEndReason, DealStatus } from '../../model/entities/deal';
import type { Network } from '../../model/entities/network';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import { dealCoversShow, dealInForce, networkOnAir } from './coverage';
import { dealHealth, HEALTH_DOC_REF, type DealHealth } from './formulas/dealHealth';
import { BONUS_DOC_REF } from './formulas/ratingsBonus';
import { BROADCAST_HEALTH_STREAM } from './streams';
import { dealHealthTraceRef, isHumanControlled } from './traces';
import {
  dealValuation,
  incomePerAiring,
  type DealValuation,
  type DealValuationRequest,
} from './valuation';

export const DEAL_HEALTH_PHASE_ID = 'broadcast.dealHealth';

/** The roll's label in the Why?. */
export const NETWORK_PATIENCE_LABEL = 'Network patience';

/** A deal's airings, newest first (by air date, then id). */
export function airingsNewestFirst(read: GameWorldView, dealId: DealId): Airing[] {
  return [...read.tables.airings.lookup('byDeal', dealId)].sort(
    (left, right) => compareDates(right.airDate, left.airDate) || compareIds(right.id, left.id),
  );
}

/**
 * The deal's shows still to come (after `today`) that are already cancelled, soonest first: each
 * will be a missed airing (EVT1 cancels shows).
 */
export function upcomingMissedAirings(
  read: GameWorldView,
  deal: Deal,
  network: Network,
  today: GameDate,
): GameDate[] {
  const dates: GameDate[] = [];
  for (const show of read.tables.eventInstances.lookup('byPromotion', deal.promotionId)) {
    if (
      show.status === 'cancelled' &&
      compareDates(show.airDate, today) > 0 &&
      dealInForce(deal, network, show.airDate) &&
      dealCoversShow(read, deal, network, show)
    ) {
      dates.push(show.airDate);
    }
  }
  return dates.sort(compareDates);
}

/** How the deal is doing today, from its stored airings. Deterministic; reads only. */
export function dealHealthOf(
  read: GameWorldView,
  tunables: EngineTunables,
  deal: Deal,
  network: Network,
  today: GameDate = read.meta.currentDate,
): DealHealth {
  const look = Math.max(
    tunables.get('broadcast.health.window'),
    tunables.get('broadcast.health.missedWindow'),
  );
  return dealHealth(
    {
      networkName: network.name,
      reachTier: network.reachTier,
      daysSinceStart: diffDays(deal.startsOn, today),
      recent: airingsNewestFirst(read, deal.id).slice(0, look),
      upcomingMissed: upcomingMissedAirings(read, deal, network, today).slice(
        0,
        tunables.get('broadcast.health.missedWindow'),
      ),
    },
    { tunables },
  );
}

/** Ends a deal: status, `endedOn`, `endedReason`, and `broadcast.dealEnded`. */
export function endDeal(
  ctx: Pick<StepContext, 'tx' | 'publish' | 'date'>,
  deal: Deal,
  status: Extract<DealStatus, 'expired' | 'cancelled'>,
  reason: DealEndReason,
): void {
  ctx.tx.update('deals', deal.id, { status, endedOn: ctx.date, endedReason: reason });
  ctx.publish('broadcast.dealEnded', {
    dealId: deal.id,
    promotionId: deal.promotionId,
    networkId: deal.networkId,
    reason,
  });
}

/**
 * Writes a renegotiation: the valuation's terms (in cents), the weekday, the new end date and
 * `renegotiatedOn`, and clears `warnedOn`. The player's `broadcast.renegotiate` and the rivals'
 * renewal both come through here.
 */
export function applyRenegotiation(
  ctx: Pick<StepContext, 'tx' | 'publish' | 'date'>,
  deal: Deal,
  valuation: DealValuation,
  months: number,
): GameDate {
  const from = compareDates(deal.endsOn, ctx.date) > 0 ? deal.endsOn : ctx.date;
  const endsOn = addMonths(from, months);
  ctx.tx.update('deals', deal.id, {
    terms: {
      feePerShow: cents(valuation.terms.feePerShow.value),
      perThousandViewers: cents(valuation.terms.perThousandViewers.value),
      costPerShow: cents(valuation.terms.costPerShow.value),
    },
    weekday: valuation.weekday,
    endsOn,
    renegotiatedOn: ctx.date,
    warnedOn: null,
  });
  ctx.publish('broadcast.dealRenegotiated', { dealId: deal.id, promotionId: deal.promotionId });
  return endsOn;
}

/**
 * A renewal's valuation (ECO8-10): what the network would pay today for `request`, plus
 * `broadcast.bonus.renewalUplift` on the fee (the per-buy rate on pay-per-view) when it is the
 * deal's own network and the deal is Exceeding. The player's renewal preview, `broadcast.renegotiate`
 * and the rivals' renewal all come through here, so the preview is what the renewal signs.
 */
export function renewalValuation(
  read: GameWorldView,
  tunables: EngineTunables,
  deal: Deal,
  request: DealValuationRequest,
): DealValuation {
  const valuation = dealValuation(read, tunables, { ...request, excludeDealId: deal.id });
  const network = read.tables.networks.get(deal.networkId);
  const uplift = tunables.get('broadcast.bonus.renewalUplift');
  if (network === undefined || request.networkId !== deal.networkId || uplift <= 0) {
    return valuation;
  }
  if (dealHealthOf(read, tunables, deal, network).value !== 'exceeding') {
    return valuation;
  }
  const term = network.kind === 'ppv' ? 'perThousandViewers' : 'feePerShow';
  const termName = network.kind === 'ppv' ? 'per-buy rate' : 'fee';
  const reason = `Beating ${network.name}'s expectations: renewed ${termName} up ${String(Math.round(uplift * 100))}%`;
  const calc = startCalc(`Renewed ${termName}`, valuation.terms[term], {
    unit: 'money',
    docRef: BONUS_DOC_REF,
  });
  const share = calc.tunable(tunables, 'broadcast.bonus.renewalUplift');
  calc.multiply(reason, 1 + share).round('floor', 'Rounded down to whole cents');
  const terms = { ...valuation.terms, [term]: calc.done() };
  return {
    ...valuation,
    terms,
    incomePerAiring: incomePerAiring(network.kind, valuation.projectedViewers, terms),
    renewalUplift: { share, term, reason },
  };
}

/** The deal valued again for the same network, show, timeslot and live (renegotiation). */
export function revalueDeal(
  read: GameWorldView,
  tunables: EngineTunables,
  deal: Deal,
  months: number,
): DealValuation {
  return renewalValuation(read, tunables, deal, {
    promotionId: deal.promotionId,
    networkId: deal.networkId,
    eventDefinitionId: deal.eventDefinitionId,
    timeslot: deal.timeslot,
    live: deal.live,
    months,
  });
}

/** Today's verdict on one deal that aired (or missed) today; ends it when the network pulls it. */
function judgeAiredDeal(ctx: StepContext, deal: Deal, network: Network): DealHealth {
  const health = dealHealthOf(ctx.read, ctx.tunables, deal, network, ctx.date);
  const ref = dealHealthTraceRef(deal.id);
  if (health.value !== 'cancelling' || health.cause === null) {
    ctx.recordTrace(ref, ctx.date, health);
    return health;
  }
  if (health.cause === 'missedAirings') {
    ctx.recordTrace(ref, ctx.date, health);
    endDeal(ctx, deal, 'cancelled', 'missedAirings');
    return health;
  }
  const roll = rollChance(
    ctx.rng(BROADCAST_HEALTH_STREAM),
    health.cancelChance,
    NETWORK_PATIENCE_LABEL,
  );
  const verdict = startDecision<'cancel' | 'keep'>(`Does ${network.name} cancel?`, {
    docRef: HEALTH_DOC_REF,
  })
    .include('How the deal is doing', health)
    .roll(roll.roll);
  const outcome = roll.value
    ? verdict.choose('cancel', `${network.name} cancelled the deal for low viewers`)
    : verdict.choose('keep', `${network.name} kept the deal this time`);
  ctx.recordTrace(ref, ctx.date, outcome);
  if (roll.value) {
    endDeal(ctx, deal, 'cancelled', 'lowViewers');
  }
  return health;
}

/** On or after `endsOn`: a rival's deal renews when the network would still sign; else it expires. */
function expireOrRenew(ctx: StepContext, deal: Deal, human: boolean): void {
  const { read, tunables } = ctx;
  if (!human && tunables.get('broadcast.rivals.autoRenew')) {
    const network = read.tables.networks.require(deal.networkId);
    const months = tunables.get('broadcast.deal.defaultMonths');
    const valuation = revalueDeal(read, tunables, deal, months);
    const health = dealHealthOf(read, tunables, deal, network, ctx.date);
    if (valuation.verdict === 'accept' && health.value !== 'cancelling') {
      applyRenegotiation(ctx, deal, valuation, months);
      ctx.log(`Renewed ${deal.id} with ${network.name}`);
      return;
    }
  }
  endDeal(ctx, deal, 'expired', 'expired');
}

/** True when the promotion should be warned about the deal today. */
function warningDue(deal: Deal, today: GameDate, tunables: EngineTunables): boolean {
  return (
    deal.warnedOn === null ||
    diffDays(deal.warnedOn, today) >= tunables.get('broadcast.health.warnEveryDays')
  );
}

/** True when the deal ends within `broadcast.deal.expiryWarningDays`. */
function endingSoon(deal: Deal, today: GameDate, tunables: EngineTunables): boolean {
  const left = diffDays(today, deal.endsOn);
  return left > 0 && left <= tunables.get('broadcast.deal.expiryWarningDays');
}

/** Daily: judges today's airings, ends, renews and warns. See the module comment. */
export const dealHealthPhase: PhaseDefinition = definePhase({
  id: DEAL_HEALTH_PHASE_ID,
  group: 'settlement',
  order: 45,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    const { read, tunables, date } = ctx;
    // (1) The verdict on every deal that aired (or missed) today.
    const judged = new Map<DealId, DealHealth>();
    const airedToday = [
      ...new Set(read.tables.airings.lookup('byAirDate', date).map((row) => row.dealId)),
    ].sort(compareIds);
    for (const dealId of airedToday) {
      const deal = read.tables.deals.get(dealId);
      const network = deal === undefined ? undefined : read.tables.networks.get(deal.networkId);
      if (deal?.status !== 'active' || network === undefined) {
        continue;
      }
      judged.set(deal.id, judgeAiredDeal(ctx, deal, network));
    }

    // (2) and (3): every deal still active.
    const active = read.tables.deals
      .values()
      .filter((deal) => deal.status === 'active')
      .sort((left, right) => compareIds(left.id, right.id));
    let ended = 0;
    for (const deal of active) {
      const network = read.tables.networks.get(deal.networkId);
      const promotion = read.tables.promotions.get(deal.promotionId);
      if (network === undefined || promotion === undefined) {
        continue;
      }
      if (!networkOnAir(network, date)) {
        endDeal(ctx, deal, 'cancelled', 'networkClosed');
        ended += 1;
        continue;
      }
      const human = isHumanControlled(promotion);
      if (compareDates(date, deal.endsOn) >= 0) {
        expireOrRenew(ctx, deal, human);
        continue;
      }
      if (!human || !warningDue(deal, date, tunables)) {
        continue;
      }
      const health = judged.get(deal.id);
      const atRisk =
        health !== undefined && (health.value === 'atRisk' || health.value === 'cancelling');
      if (!atRisk && !endingSoon(deal, date, tunables)) {
        continue;
      }
      const risk = (health ?? dealHealthOf(read, tunables, deal, network, date)).value;
      ctx.tx.update('deals', deal.id, { warnedOn: date });
      ctx.publish('broadcast.dealWarned', {
        dealId: deal.id,
        promotionId: deal.promotionId,
        risk,
      });
    }
    if (ended > 0) {
      ctx.log(`Ended ${String(ended)} deal(s) on closed networks`);
    }
  },
});
