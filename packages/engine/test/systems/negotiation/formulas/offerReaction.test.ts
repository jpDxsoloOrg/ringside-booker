// How a worker reacts to an offer (ECO5-03). Design: docs/design/negotiation.md#reaction
import { describe, expect, it } from 'vitest';
import { inputOf } from '../../../../src/core/trace/helpers';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  FAR_BELOW_REASON,
  MATCHES_COUNTER_REASON,
  offerRatio,
  offerReaction,
  OUT_OF_PATIENCE_REASON,
  REFUSES_RENEWAL_CODE,
  REFUSES_RENEWAL_MESSAGE,
  type OfferReactionInputs,
} from '../../../../src/systems/negotiation';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

const ASK = 100;

function react(
  offer: number,
  inputs: Partial<Omit<OfferReactionInputs, 'offerValue' | 'askValue'>> = {},
  overrides: TunableOverrides = {},
) {
  const offerValue = inputOf('Offer', offer);
  const askValue = inputOf('Ask', ASK);
  const result = offerReaction(
    {
      offerValue,
      askValue,
      patience: 3,
      refusal: null,
      roleMismatch: null,
      matchesLastCounter: false,
      ...inputs,
    },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(offerRatio(offerValue, askValue));
  expectSerialisable(result);
  return result;
}

describe('offerReaction', () => {
  it('accepts from exactly 95% of the ask', () => {
    const result = react(95);
    expect(result.value).toBe('accept');
    expect(result.trace).toMatchObject({ kind: 'decision', label: 'How they react' });
    expectTraceContains(result, { kind: 'formula', label: 'Offer against their ask' });
    expect(react(94.9).value).toBe('counter');
  });

  it('counters from exactly 55% while patience lasts', () => {
    expect(react(55).value).toBe('counter');
    expect(react(54.9).value).toBe('reject');
    expect(react(80, { patience: 1 }).value).toBe('counter');
  });

  it('rejects from exactly 45% with more patience than a rejection costs', () => {
    expect(react(45).value).toBe('reject');
    expect(react(45, { patience: 2 }).value).toBe('reject');
    const tired = react(45, { patience: 1 });
    expect(tired.value).toBe('walkAway');
    expect(tired.trace).toMatchObject({ reason: OUT_OF_PATIENCE_REASON });
    const far = react(44.9);
    expect(far.value).toBe('walkAway');
    expect(far.trace).toMatchObject({ reason: FAR_BELOW_REASON });
  });

  it('walks away from anything short of an acceptance with no patience left', () => {
    for (const offer of [90, 55, 50, 10]) {
      const result = react(offer, { patience: 0 });
      expect(result.value).toBe('walkAway');
    }
    expect(react(95, { patience: 0 }).value).toBe('accept');
  });

  it('refuses on a refusal or a role they will not take, before anything else', () => {
    const refusal = { code: REFUSES_RENEWAL_CODE, message: REFUSES_RENEWAL_MESSAGE };
    const refused = react(200, { refusal, matchesLastCounter: true });
    expect(refused.value).toBe('refuse');
    expect(refused.trace).toMatchObject({ reason: REFUSES_RENEWAL_MESSAGE });
    const role = react(200, { roleMismatch: 'Wants to wrestle' });
    expect(role.value).toBe('refuse');
    expect(role.trace).toMatchObject({ reason: 'Wants to wrestle' });
  });

  it('accepts an offer that matches their counter-offer, whatever its share', () => {
    const result = react(80, { matchesLastCounter: true });
    expect(result.value).toBe('accept');
    expect(result.trace).toMatchObject({ reason: MATCHES_COUNTER_REASON });
  });

  it('loses the counter band when the counter line meets the accept line', () => {
    const merged = { 'contracts.react.counterRatio': 0.95 };
    expect(react(94, {}, merged).value).toBe('reject');
    expect(react(95, {}, merged).value).toBe('accept');
  });

  it('treats an ask of nothing as met by any offer', () => {
    const result = offerReaction(
      {
        offerValue: inputOf('Offer', 0),
        askValue: inputOf('Ask', 0),
        patience: 3,
        refusal: null,
        roleMismatch: null,
        matchesLastCounter: false,
      },
      { tunables: createEngineTunables() },
    );
    expect(result.value).toBe('accept');
    expectSerialisable(result);
  });
});
