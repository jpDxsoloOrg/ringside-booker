/**
 * The draft's flow without the board: whose turn it is (from the picks and the stored pool
 * counts, so a command's checks stay cheap), finishing the draft and releasing an unsigned pick.
 *
 * Design: docs/design/draft.md#commands.
 */

import type { PersonId, PromotionId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import type { Draft, DraftCategory, DraftPick } from '../../model/entities/draft';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { AskingContext } from '../negotiation/asking';
import { nextTurn, type Turn } from './order';
import { DraftRun, isHumanPromotion, loadDraft, picksOf, signAtAsk } from './session';
import type { DraftCandidate } from './candidates';

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

/** Whose turn it is, from the picks and the stored pool counts; null when the draft is complete. */
export function turnOf(read: GameWorldView, draft: DeepReadonly<Draft>): Turn | null {
  if (draft.status !== 'running') {
    return null;
  }
  const counts = rosterCounts(picksOf(read, draft.id));
  return nextTurn(draft, draft.turn, read.meta.seed, (promotionId) => {
    const count = counts.get(promotionId);
    return wantsCategory(draft, count, 'wrestler') || wantsCategory(draft, count, 'staff');
  });
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
}

/**
 * Finishes the draft: the computer makes the rivals' remaining picks and passes the players'
 * remaining turns; under "Negotiate contracts after the draft" each rival then signs its unsigned
 * picks at their ask, best pick first, while their monthly cost stays under
 * `draft.ai.payrollShare` of its cash, and releases the rest to the pool. Then the draft is
 * `finished` and day 1 can start.
 */
export function finishDraft(ctx: PhaseContext, draft: DeepReadonly<Draft>): FinishSummary {
  const summary: FinishSummary = { picksMade: 0, passed: 0, signed: 0, released: 0 };
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
  ctx.tx.update('drafts', draft.id, { status: 'finished', finishedOn: ctx.date });
  return summary;
}

function settleRivalPicks(
  ctx: PhaseContext,
  draft: DeepReadonly<Draft>,
): { signed: number; released: number } {
  const { read, tunables } = ctx;
  const share = tunables.get('draft.ai.payrollShare');
  const contexts = new Map<PromotionId, AskingContext>();
  const spent = new Map<PromotionId, number>();
  let signed = 0;
  let released = 0;
  const reserved = picksOf(read, draft.id).filter(
    (pick) =>
      pick.status === 'reserved' &&
      read.tables.promotions.get(pick.promotionId)?.controller.kind === 'computer',
  );
  // Best pick first within each promotion: the pick order is the order they wanted them.
  for (const pick of reserved) {
    const promotion = read.tables.promotions.require(pick.promotionId);
    const budget = promotion.cash * share;
    const person = read.tables.people.require(pick.personId);
    const candidate: Pick<DraftCandidate, 'personId' | 'role' | 'heel'> = {
      personId: pick.personId,
      role: pick.role,
      heel: person.traits.includes('naturalHeel'),
    };
    const employmentId = signAtAsk(ctx, tunables, contexts, pick.promotionId, candidate);
    const employment = read.tables.employments.require(employmentId);
    const cost = monthlyCost(employment.terms);
    const total = (spent.get(pick.promotionId) ?? 0) + cost;
    if (total <= budget) {
      spent.set(pick.promotionId, total);
      ctx.tx.update('draftPicks', pick.id, { status: 'signed', employmentId, reservedUntil: null });
      signed += 1;
    } else {
      ctx.tx.delete('employments', employmentId);
      ctx.tx.update('draftPicks', pick.id, { status: 'released', reservedUntil: null });
      released += 1;
    }
  }
  return { signed, released };
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
