/**
 * How a computer promotion answers a worker's counter-offer (ECO5-05), so talks never stall when
 * nothing else answers them (ECO6 absent, or skipping this one).
 *
 * The default rule, the same for every computer controller (D-01): accept when the counter's pay
 * (the monthly wage, or the fee for a per-appearance deal) is at most the worker's ask ×
 * `contracts.ai.acceptCounterUpTo`, else end the talks. A counter never asks above the ask, so at
 * the default 1 every counter is accepted. ECO6 replaces it with `registerCounterResponder`: the
 * first responder (by order, then id) with an answer wins, and the rule answers when none does.
 * The answer goes through ECO5-04's `answerCounter` like a player's would.
 *
 * Each answer is stored as a summary at `contracts.counter` / `<negotiationId>:<round>:answer`.
 *
 * Design: docs/design/negotiation.md#review.
 */

import { type Controller } from '../../core/api/controller';
import { RegistryError } from '../../core/errors';
import type { PhaseContext } from '../../core/pipeline/context';
import { PHASE_ID_PATTERN } from '../../core/pipeline/phase';
import { startDecision } from '../../core/trace/decision';
import type { Traced } from '../../core/trace/types';
import type { Negotiation } from '../../model/entities/negotiation';
import type { DeepReadonly } from '../../model/world';
import { askedMoney } from './counter';
import { evaluateOffer } from './evaluate';
import { moneyText } from './formulas/shared';
import type { Offer } from './offer';
import { answerCounter, answerCounterReasons, copyOffer, type CounterResponse } from './submit';
import { NEGOTIATION_TRACE_KINDS, roundTraceId } from './traceKinds';

const COMPUTER: Controller = { kind: 'computer' };
export const COUNTER_ANSWER_DOC_REF = 'negotiation.md#review';

/** A responder's answer: accept, end, or revise with a new offer. */
export interface CounterAnswer {
  readonly response: CounterResponse;
  readonly offer?: Offer | undefined;
  /** Why, for the Why?. */
  readonly trace: Traced<string>;
}

/** Something that answers computer promotions' counter-offers (ECO6). */
export interface CounterResponder {
  /** `system.camelName`, for example `aiHiring.counterResponder`. */
  readonly id: string;
  /** Lower asks first; equal orders go by id. Default 100. */
  readonly order?: number;
  /** The answer to this counter-offer, or null to leave it to the next responder. */
  readonly respond: (
    ctx: PhaseContext,
    negotiation: DeepReadonly<Negotiation>,
  ) => CounterAnswer | null;
}

const responders = new Map<string, CounterResponder>();

/**
 * Adds a counter responder. Returns a function that removes it again.
 *
 * @throws RegistryError for a malformed or repeated id.
 */
export function registerCounterResponder(responder: CounterResponder): () => void {
  if (!PHASE_ID_PATTERN.test(responder.id)) {
    throw new RegistryError(
      `Counter responder "${responder.id}": the id must look like "system.camelName"`,
      { id: responder.id },
    );
  }
  if (responders.has(responder.id)) {
    throw new RegistryError(`Counter responder "${responder.id}" is already registered`, {
      id: responder.id,
    });
  }
  const stored = { ...responder };
  responders.set(responder.id, stored);
  return () => {
    if (responders.get(responder.id) === stored) {
      responders.delete(responder.id);
    }
  };
}

/** Every registered counter responder, in the order they are asked. */
export function counterResponders(): CounterResponder[] {
  return [...responders.values()].sort(
    (left, right) =>
      (left.order ?? 100) - (right.order ?? 100) ||
      (left.id === right.id ? 0 : left.id < right.id ? -1 : 1),
  );
}

/** The built-in rule: accept a counter that pays no more than the ask × the tunable. */
export function defaultCounterAnswer(
  ctx: PhaseContext,
  negotiation: DeepReadonly<Negotiation>,
): CounterAnswer {
  const counter = negotiation.lastCounter ?? negotiation.offer;
  const evaluation = evaluateOffer(ctx.read, ctx.tunables, {
    promotionId: negotiation.promotionId,
    personId: negotiation.personId,
    offer: copyOffer(counter),
    negotiation,
    date: ctx.date,
  });
  const decision = startDecision<CounterResponse>('Answer to their counter-offer', {
    docRef: COUNTER_ANSWER_DOC_REF,
  });
  const perAppearance = counter.terms.kind === 'perAppearance';
  const asked = askedMoney(evaluation.ask);
  const askedPay = perAppearance ? asked.perAppearanceFee : asked.monthlyWage;
  const pay = perAppearance ? counter.terms.perAppearanceFee : counter.terms.monthlyWage;
  const upTo = decision.tunable(ctx.tunables, 'contracts.ai.acceptCounterUpTo');
  const limit = Math.floor(askedPay * upTo);
  const accept = pay <= limit;
  decision.rule(
    `Their counter pays ${moneyText(pay)}; the most this promotion pays is ${moneyText(limit)}`,
    accept,
  );
  const response: CounterResponse = accept ? 'accept' : 'end';
  return {
    response,
    trace: decision.choose(response, accept ? 'Within what it pays' : 'More than it pays'),
  };
}

/** A computer promotion answers the counter-offer waiting in `negotiation`. */
export function answerComputerCounter(
  ctx: PhaseContext,
  negotiation: DeepReadonly<Negotiation>,
): void {
  let answer: CounterAnswer | null = null;
  for (const responder of counterResponders()) {
    answer = responder.respond(ctx, negotiation);
    if (answer !== null) {
      break;
    }
  }
  answer ??= defaultCounterAnswer(ctx, negotiation);
  const args = { negotiationId: negotiation.id, response: answer.response, offer: answer.offer };
  const refused = answerCounterReasons(ctx.read, ctx.tunables, args, negotiation, COMPUTER);
  const final =
    refused.length === 0 ? args : { ...args, response: 'end' as const, offer: undefined };
  ctx.recordTrace(
    {
      kind: NEGOTIATION_TRACE_KINDS.counter,
      id: `${roundTraceId(negotiation.id, negotiation.round)}:answer`,
    },
    ctx.date,
    answer.trace,
    { summaryOnly: true },
  );
  answerCounter(ctx, final, COMPUTER);
}
