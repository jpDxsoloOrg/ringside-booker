/**
 * The day's work of `contracts.unhappyWorkers` (ECO4-03): unhappy clocks, release requests and
 * walk-outs.
 *
 * For every active contract in id order (owners never ask to leave, closed promotions are skipped):
 *
 * 1. a refused request: morale above `contracts.quit.threshold` + `contracts.walkout.recoverMargin`
 *    settles the worker down (request and clock cleared, a log line, no event); otherwise the
 *    walk-out chance (`walkoutChance`) is rolled on `contracts.walkout`, and a hit ends the
 *    contract as a quit (`walkedOut`, no severance). A chance of 0 (iron-clad, hot storyline) draws
 *    no roll at all;
 * 2. an open request past its answer-by date is refused by the system ("Release request ignored");
 * 3. the unhappy clock: morale at or below the threshold adds a day, unless the worker is in a hot
 *    storyline (D-09), which pauses it; morale above it clears the clock (while no request is
 *    waiting). When the clock reaches `contracts.quit.days` and there is no request yet, the worker
 *    asks to leave: the player's workers get an open request; a rival answers at once by its keep
 *    rule (`aiReleaseDecision`) and grants or refuses.
 *
 * A request refused today is first rolled tomorrow. Clock and walk-out traces are stored for the
 * player's promotions only; a rival's answer is stored once per decision.
 *
 * Design: docs/design/contracts.md#unhappy-workers, #walk-outs and #rival-rules.
 */

import { compareDates } from '../../core/date';
import type { PromotionId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import { rollChance } from '../../core/rng/rolls';
import { startCalc } from '../../core/trace/calc';
import { startDecision } from '../../core/trace/decision';
import type { ContractConcern } from '../../model/entities/contract-concern';
import type { Employment } from '../../model/entities/employment';
import type { Promotion } from '../../model/entities/promotion';
import type { DeepReadonly } from '../../model/world';
import { endEmployment } from './endEmployment';
import { aiReleaseDecision } from './formulas/aiReleaseDecision';
import { WALKOUTS_DOC_REF } from './formulas/walkoutChance';
import {
  grantRequest,
  raiseRequest,
  refuseRequest,
  UNHAPPY_DOC_REF,
  WALKOUT_REASON_KEY,
  walkoutChanceFor,
  writeConcern,
} from './requests';
import { hotStorylineFor, hotStorylineText, type HotStoryline } from './storyPause';
import { WALKOUT_STREAM } from './streams';
import { titlesHeldBy } from './titles';
import { aiReleaseTraceRef, unhappyTraceRef, walkoutTraceRef } from './traceKinds';

type UnhappyClockState = 'counting' | 'paused';

function signed(value: number): string {
  return value > 0 ? `+${String(value)}` : String(value);
}

/** The clock's Why? for one of the player's workers. */
function recordClock(
  ctx: PhaseContext,
  employment: DeepReadonly<Employment>,
  hot: HotStoryline | null,
  days: number,
): void {
  const decision = startDecision<UnhappyClockState>('Unhappy clock', { docRef: UNHAPPY_DOC_REF });
  const threshold = decision.tunable(ctx.tunables, 'contracts.quit.threshold');
  decision.rule(
    `Morale ${signed(employment.morale)} at or below ${signed(threshold)}`,
    employment.morale <= threshold,
  );
  decision.rule(
    hot === null ? 'Not in a hot storyline' : `${hotStorylineText(hot)}: clock paused (D-09)`,
    hot === null,
  );
  const quitDays = decision.tunable(ctx.tunables, 'contracts.quit.days');
  decision.note(`Day ${String(days)} of ${String(quitDays)}`);
  const result =
    hot === null
      ? decision.choose('counting', 'Unhappy and not shielded by a story')
      : decision.choose('paused', 'A hot storyline keeps them going (D-09)');
  ctx.recordTrace(unhappyTraceRef(employment.id), ctx.date, result);
}

/** Step 1 for one refused request. */
function walkoutStep(
  ctx: PhaseContext,
  employment: DeepReadonly<Employment>,
  human: boolean,
): void {
  const threshold = ctx.tunables.get('contracts.quit.threshold');
  const margin = ctx.tunables.get('contracts.walkout.recoverMargin');
  if (employment.morale > threshold + margin) {
    writeConcern(ctx, employment, { request: null, unhappy: null });
    ctx.log(`${employment.ringName} settled down: no longer at risk of walking out`);
    return;
  }
  const chance = walkoutChanceFor(ctx.read, employment, ctx.tunables);
  if (chance.value <= 0) {
    if (human) {
      ctx.recordTrace(walkoutTraceRef(employment.id), ctx.date, chance);
    }
    return;
  }
  const roll = rollChance(ctx.rng(WALKOUT_STREAM), chance.value, 'Walk-out roll');
  if (human) {
    const rolled = startCalc('Walk-out roll', chance, {
      unit: 'probability',
      docRef: WALKOUTS_DOC_REF,
    })
      .roll(roll.roll)
      .note(roll.value ? 'Walked out' : 'Stayed today')
      .done();
    ctx.recordTrace(walkoutTraceRef(employment.id), ctx.date, rolled);
  }
  if (roll.value) {
    endEmployment(ctx, {
      employmentId: employment.id,
      to: 'quit',
      how: 'walkedOut',
      reasonKey: WALKOUT_REASON_KEY,
      source: 'system',
      severance: null,
    });
  }
}

/** A rival answers its worker's new request at once. */
function rivalAnswers(ctx: PhaseContext, employment: DeepReadonly<Employment>): void {
  const titles = titlesHeldBy(ctx.read, employment.personId, employment.promotionId).map(
    (id) => ctx.read.tables.titles.get(id)?.name ?? 'a title',
  );
  const decision = aiReleaseDecision({ push: employment.push, titles }, { tunables: ctx.tunables });
  ctx.recordTrace(aiReleaseTraceRef(employment.id), ctx.date, decision);
  if (decision.value === 'grant') {
    grantRequest(ctx, employment.id, 'ai');
    return;
  }
  raiseRequest(ctx, employment, false);
  refuseRequest(ctx, employment.id, 'ai', ctx.date);
}

/** Step 3 for one worker with no answered request. */
function clockStep(
  ctx: PhaseContext,
  employment: DeepReadonly<Employment>,
  concern: DeepReadonly<ContractConcern> | undefined,
  human: boolean,
): void {
  const threshold = ctx.tunables.get('contracts.quit.threshold');
  const request = concern?.request ?? null;
  const clock = concern?.unhappy ?? null;
  if (employment.morale > threshold) {
    if (clock !== null && request === null) {
      writeConcern(ctx, employment, { unhappy: null });
    }
    return;
  }
  const hot = hotStorylineFor(ctx.read, employment.personId, employment.promotionId, ctx.tunables);
  const days = hot === null ? (clock?.days ?? 0) + 1 : (clock?.days ?? 0);
  if (hot === null) {
    writeConcern(ctx, employment, { unhappy: { since: clock?.since ?? ctx.date, days } });
  }
  if (human) {
    recordClock(ctx, employment, hot, days);
  }
  if (hot !== null || request !== null || days < ctx.tunables.get('contracts.quit.days')) {
    return;
  }
  if (human) {
    raiseRequest(ctx, employment, true);
  } else {
    rivalAnswers(ctx, employment);
  }
}

/** The whole day's work. Runs once a day (it counts days, so it is not idempotent). */
export function runUnhappyWorkers(ctx: PhaseContext): void {
  const promotions = new Map<PromotionId, DeepReadonly<Promotion> | undefined>();
  for (const employment of ctx.read.tables.employments.lookup('byStatus', 'active')) {
    if (!promotions.has(employment.promotionId)) {
      promotions.set(
        employment.promotionId,
        ctx.read.tables.promotions.get(employment.promotionId),
      );
    }
    const promotion = promotions.get(employment.promotionId);
    if (
      promotion === undefined ||
      promotion.status === 'closed' ||
      promotion.ownerPersonId === employment.personId
    ) {
      continue;
    }
    const human = promotion.controller.kind === 'human';
    const concern = ctx.read.tables.contractConcerns.lookupOne('byEmployment', employment.id);
    const request = concern?.request ?? null;
    if (request?.status === 'refused') {
      walkoutStep(ctx, employment, human);
      continue;
    }
    if (request?.status === 'open' && compareDates(request.answerBy, ctx.date) < 0) {
      refuseRequest(ctx, employment.id, 'system', ctx.date);
      continue;
    }
    clockStep(ctx, employment, concern, human);
  }
}
