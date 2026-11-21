/**
 * The draft's flow without the board: whose turn it is (from the picks and the stored pool
 * counts, so a command's checks stay cheap), finishing the draft and releasing an unsigned pick.
 *
 * Design: docs/design/draft.md#commands.
 */

import type { PersonId, PromotionId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import type { Draft, DraftCategory, DraftPick } from '../../model/entities/draft';
import { promotionStatusKey } from '../../model/entities/employment';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { compareIds } from '../../model/table';
import { compareCandidates, type DraftCandidate } from './candidates';
import { nextTurn, type Turn } from './order';
import { DraftPricer } from './pricing';
import { runningCostsOf } from './reserve';
import { DraftRun, isHumanPromotion, loadDraft, picksOf, signAtAsk } from './session';

/** Roster counts by category from a draft's held picks. */
export function rosterCounts(
  picks: readonly DeepReadonly<DraftPick>[],
): Map<PromotionId, Record<DraftCategory, number>> {
  const counts = new Map<PromotionId, Record<DraftCategory, number>>();
  for (const pick of picks) {
    if (pick.status === 'released') {
      continue;
    }
    const entry = counts.get(pick.promotionId) ?? { wrestler: 0, staff: 0 };
    entry[pick.category] += 1;
    counts.set(pick.promotionId, entry);
  }
  return counts;
}

/** True when this roster still wants someone in `category` the pool has. */
export function wantsCategory(
  draft: DeepReadonly<Draft>,
  count: Record<DraftCategory, number> | undefined,
  category: DraftCategory,
): boolean {
  if (category === 'wrestler') {
    return (count?.wrestler ?? 0) < draft.settings.rosterTarget && draft.poolLeft.wrestlers > 0;
  }
  return (count?.staff ?? 0) < draft.settings.staffTarget && draft.poolLeft.staff > 0;
}

/**
 * Whether a promotion still takes turns: it wants someone the pool has and its turns have not
 * ended for lack of money (DRF-10).
 */
export function needsFrom(
  draft: DeepReadonly<Draft>,
  counts: ReadonlyMap<PromotionId, Record<DraftCategory, number>>,
): (promotionId: PromotionId) => boolean {
  const broke = new Set<string>(draft.outOfMoney);
  return (promotionId) => {
    if (broke.has(promotionId)) {
      return false;
    }
    const count = counts.get(promotionId);
    return wantsCategory(draft, count, 'wrestler') || wantsCategory(draft, count, 'staff');
  };
}

/** Whose turn it is, from the picks and the stored pool counts; null when the draft is complete. */
export function turnOf(read: GameWorldView, draft: DeepReadonly<Draft>): Turn | null {
  if (draft.status !== 'running') {
    return null;
  }
  const counts = rosterCounts(picksOf(read, draft.id));
  return nextTurn(draft, draft.turn, read.meta.seed, needsFrom(draft, counts));
}

/** The monthly cost of a contract for a rival's budget: wage plus four appearances' fees. */
function monthlyCost(terms: { monthlyWage: number; perAppearanceFee: number }): number {
  return terms.monthlyWage + 4 * terms.perAppearanceFee;
}

export interface FinishSummary {
  /** Picks made while finishing (rivals' remaining picks). */
  picksMade: number;
  /** Players whose remaining turns were passed because the draft was finished early. */
  passed: number;
  /** Rival picks signed after the draft (negotiate-after only). */
  signed: number;
  /** Rival picks released back to the pool (negotiate-after only). */
  released: number;
  /** Free agents rivals signed on per-appearance deals to fill rosters they could not afford. */
  filled: number;
}

/**
 * Finishes the draft: the computer makes the rivals' remaining picks and passes the players'
 * remaining turns; under "Negotiate contracts after the draft" each rival then signs its unsigned
 * picks at their ask, best pick first, while their monthly cost stays under
 * `draft.ai.payrollShare` of its cash, and releases the rest to the pool. Then the draft is
 * `finished` and day 1 can start.
 */
export function finishDraft(ctx: PhaseContext, draft: DeepReadonly<Draft>): FinishSummary {
  const summary: FinishSummary = { picksMade: 0, passed: 0, signed: 0, released: 0, filled: 0 };
  if (draft.status === 'running') {
    const loaded = loadDraft(ctx.read, ctx.tunables, draft, ctx.date);
    const run = new DraftRun(ctx, loaded);
    // Players' remaining turns are passed: they keep the roster they have.
    for (const promotionId of draft.order) {
      if (isHumanPromotion(ctx.read, promotionId) && loaded.board.needs(promotionId)) {
        loaded.board.close(promotionId);
        summary.passed += 1;
      }
    }
    run.runUntil(() => false, true);
    run.save();
    summary.picksMade = run.made.length;
  }
  const current = ctx.read.tables.drafts.require(draft.id);
  if (current.settings.negotiateAfter) {
    const result = settleRivalPicks(ctx, current);
    summary.signed = result.signed;
    summary.released = result.released;
  }
  summary.filled = fillShortRosters(ctx, ctx.read.tables.drafts.require(draft.id));
  ctx.tx.update('drafts', draft.id, { status: 'finished', finishedOn: ctx.date });
  return summary;
}

function settleRivalPicks(
  ctx: PhaseContext,
  draft: DeepReadonly<Draft>,
): { signed: number; released: number } {
  const { read, tunables } = ctx;
  const share = tunables.get('draft.ai.payrollShare');
  const pricer = new DraftPricer(read, tunables, ctx.date);
  const spent = new Map<PromotionId, number>();
  let signed = 0;
  let released = 0;
  const reserved = picksOf(read, draft.id).filter(
    (pick) =>
      pick.status === 'reserved' &&
      read.tables.promotions.get(pick.promotionId)?.controller.kind === 'computer',
  );
  // DRF-11: and the cash must still cover `draft.ai.reserveMonths` of running costs plus wages.
  const months = tunables.get('draft.ai.reserveMonths');
  const running = new Map<PromotionId, number>();
  const runningOf = (promotionId: PromotionId): number => {
    let cost = running.get(promotionId);
    if (cost === undefined) {
      const headcount =
        read.tables.employments.lookup(
          'byPromotionStatus',
          promotionStatusKey(promotionId, 'active'),
        ).length + reserved.filter((pick) => pick.promotionId === promotionId).length;
      cost = runningCostsOf(read, tunables, promotionId, ctx.date, headcount).total;
      running.set(promotionId, cost);
    }
    return cost;
  };
  // Best pick first within each promotion: the pick order is the order they wanted them.
  for (const pick of reserved) {
    const promotion = read.tables.promotions.require(pick.promotionId);
    const budget = promotion.cash * share;
    const price = pricer.price(pick.promotionId, pick.personId);
    const cost = monthlyCost(price.terms);
    const total = (spent.get(pick.promotionId) ?? 0) + cost;
    const keeps = months <= 0 || months * (runningOf(pick.promotionId) + total) <= promotion.cash;
    if (total <= budget && keeps) {
      const person = read.tables.people.require(pick.personId);
      const candidate: Pick<DraftCandidate, 'personId' | 'role' | 'heel'> = {
        personId: pick.personId,
        role: pick.role,
        heel: person.traits.includes('naturalHeel'),
      };
      const employmentId = signAtAsk(ctx, pick.promotionId, candidate, {
        terms: price.terms,
        expectedPush: price.expectedPush,
        prepaid: false,
      });
      spent.set(pick.promotionId, total);
      ctx.tx.update('draftPicks', pick.id, { status: 'signed', employmentId, reservedUntil: null });
      signed += 1;
    } else {
      ctx.tx.update('draftPicks', pick.id, { status: 'released', reservedUntil: null });
      released += 1;
    }
  }
  return { signed, released };
}

/**
 * After the draft (DRF-10): every rival below its roster target (it ran out of money, or released
 * picks it could not pay) signs free agents from what is left of the pool on per-appearance deals,
 * cheapest fee first, until it reaches its targets or the pool runs out. Nothing is paid up front
 * for these, so cash never blocks them; the fees are charged when they appear.
 *
 * Cheap in a big world: the pool is ordered by fee once, priced by the first short rival, and
 * each rival prices only the people it signs. Returns how many were signed.
 */
export function fillShortRosters(ctx: PhaseContext, draft: DeepReadonly<Draft>): number {
  const { read, tunables } = ctx;
  const counts = rosterCounts(picksOf(read, draft.id));
  const shortOf = (promotionId: PromotionId, category: DraftCategory): number => {
    const count = counts.get(promotionId);
    const target =
      category === 'wrestler' ? draft.settings.rosterTarget : draft.settings.staffTarget;
    return Math.max(0, target - (count?.[category] ?? 0));
  };
  const short = draft.order.filter(
    (promotionId) =>
      read.tables.promotions.get(promotionId)?.controller.kind === 'computer' &&
      (shortOf(promotionId, 'wrestler') > 0 || shortOf(promotionId, 'staff') > 0),
  );
  const [first] = short;
  if (first === undefined) {
    return 0;
  }
  const loaded = loadDraft(read, tunables, draft, ctx.date);
  const pricer = new DraftPricer(read, tunables, ctx.date);
  const fee = new Map<string, number>();
  for (const candidate of loaded.board.poolMembers()) {
    const terms = pricer.perAppearance(first, candidate.personId)?.terms;
    if (terms !== undefined) {
      fee.set(candidate.personId, terms.perAppearanceFee);
    }
  }
  const byFee = (category: DraftCategory): DraftCandidate[] =>
    loaded.board
      .poolMembers()
      .filter((candidate) => candidate.category === category && fee.has(candidate.personId))
      .sort(
        (left, right) =>
          (fee.get(left.personId) ?? 0) - (fee.get(right.personId) ?? 0) ||
          compareCandidates(left, right) ||
          compareIds(left.personId, right.personId),
      );
  const queues: Record<DraftCategory, DraftCandidate[]> = {
    wrestler: byFee('wrestler'),
    staff: byFee('staff'),
  };
  const wanted = new Map<PromotionId, Record<DraftCategory, number>>(
    short.map((promotionId) => [
      promotionId,
      { wrestler: shortOf(promotionId, 'wrestler'), staff: shortOf(promotionId, 'staff') },
    ]),
  );
  let filled = 0;
  // Round by round in draft order, so the cheapest free agents are shared out.
  for (let progress = true; progress;) {
    progress = false;
    for (const promotionId of short) {
      const need = wanted.get(promotionId);
      if (need === undefined) {
        continue;
      }
      for (const category of ['wrestler', 'staff'] as const) {
        if (need[category] <= 0) {
          continue;
        }
        const queue = queues[category];
        let signedOne = false;
        while (queue.length > 0 && !signedOne) {
          const candidate = queue.shift();
          if (candidate === undefined) {
            break;
          }
          const deal = pricer.perAppearance(promotionId, candidate.personId);
          if (deal === null) {
            continue;
          }
          signAtAsk(ctx, promotionId, candidate, { ...deal, prepaid: false });
          need[category] -= 1;
          filled += 1;
          signedOne = true;
          progress = true;
        }
      }
    }
  }
  if (filled > 0) {
    ctx.log(`Draft ${draft.id}: rivals signed ${String(filled)} free agent(s) per appearance`);
  }
  return filled;
}

/** The unsigned pick of `personId` held by one of `promotionIds`, or undefined. */
export function reservedPickOf(
  read: GameWorldView,
  personId: PersonId,
  promotionIds: readonly PromotionId[],
): DeepReadonly<DraftPick> | undefined {
  return read.tables.draftPicks
    .lookup('byPerson', personId)
    .find((pick) => pick.status === 'reserved' && promotionIds.includes(pick.promotionId));
}

/** Releases an unsigned pick back to the pool (`draft.release`). */
export function releasePick(ctx: PhaseContext, pick: DeepReadonly<DraftPick>): void {
  ctx.tx.update('draftPicks', pick.id, { status: 'released', reservedUntil: null });
  const draft = ctx.read.tables.drafts.require(pick.draftId);
  if (draft.status !== 'finished') {
    const poolLeft = {
      wrestlers: draft.poolLeft.wrestlers + (pick.category === 'wrestler' ? 1 : 0),
      staff: draft.poolLeft.staff + (pick.category === 'staff' ? 1 : 0),
    };
    ctx.tx.update('drafts', draft.id, {
      poolLeft,
      ...(draft.status === 'complete' ? { status: 'running' } : {}),
    });
  }
}
