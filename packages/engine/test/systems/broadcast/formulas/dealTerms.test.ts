// Deal terms (ECO8-03): the fee, the per-thousand rate and the airtime cost a network offers.
// Design: docs/design/broadcast.md#valuation
import { describe, expect, it } from 'vitest';
import { inputOf, type Traced } from '../../../../src/core/trace';
import type { NetworkKind } from '../../../../src/model/entities/network';
import {
  dealTerms,
  NO_BENCHMARK_NOTE,
  PPV_NO_FEE_NOTE,
  STREAMING_NO_PER_THOUSAND_NOTE,
  type DealTermsInputs,
  type DealTermsResult,
} from '../../../../src/systems/broadcast';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { expectTraceContains, expectTraceReplays } from '../../../support/trace';

const DEFAULTS = createEngineTunables();

function viewers(label: string, value: number): Traced<number> {
  return inputOf(label, value, undefined, 'count');
}

function inputs(overrides: Partial<DealTermsInputs> = {}): DealTermsInputs {
  return {
    kind: 'tv',
    live: false,
    projected: viewers('Projected', 2_000),
    benchmark: viewers('Expected', 1_000),
    coveredPopulation: 31_300_000,
    reachTier: 0,
    networkName: 'Test TV',
    ...overrides,
  };
}

function termsOf(
  overrides: Partial<DealTermsInputs> = {},
  tunables: EngineTunables = DEFAULTS,
): DealTermsResult {
  const result = dealTerms(inputs(overrides), { tunables });
  for (const amount of [
    result.feePerShow,
    result.perThousandViewers,
    result.costPerShow,
    result.ratio,
  ]) {
    expectTraceReplays(amount);
  }
  return result;
}

describe('dealTerms on TV', () => {
  it('pays the flat part of the rate for the valued viewers and the rest per thousand', () => {
    // 2,000 viewers against 1,000 expected: ratio 2, every viewer valued, no shortfall.
    // Fee = 2 × 5,000 × (1 − 0.1) = 9,000 cents; per thousand = 5,000 × 0.1 = 500 cents.
    const terms = termsOf();
    expect(terms.ratio.value).toBe(2);
    expect(terms.feePerShow.value).toBe(9_000);
    expect(terms.perThousandViewers.value).toBe(500);
  });

  it('pays the live bonus on both parts of the rate', () => {
    const terms = termsOf({ live: true });
    expect(terms.feePerShow.value).toBe(9_900);
    expect(terms.perThousandViewers.value).toBe(550);
    expectTraceContains(terms.feePerShow, { kind: 'multiply', label: 'Live show' });
  });

  it('caps the valued viewers at valuedViewersCap × the benchmark', () => {
    // 20,000 projected against 1,000 expected: only 5 × 1,000 are valued.
    const capped = termsOf({ projected: viewers('Projected', 20_000) });
    expect(capped.feePerShow.value).toBe(5 * 5_000 * 0.9);
    const node = expectTraceContains(capped.feePerShow, {
      kind: 'min',
      label: 'No more than the most it pays for',
    });
    expect(node.applied).toBe(true);
    const lowerCap = createEngineTunables({ 'broadcast.value.valuedViewersCap': 1.5 });
    expect(termsOf({ projected: viewers('Projected', 20_000) }, lowerCap).feePerShow.value).toBe(
      1.5 * 5_000 * 0.9,
    );
  });

  it('scales the fee by the shortfall when the audience is under the benchmark', () => {
    // 500 against 1,000: 500 valued × 5 per viewer × 0.9 × shortfall 0.5 = 1,125 cents.
    const short = termsOf({ projected: viewers('Projected', 500) });
    expect(short.ratio.value).toBe(0.5);
    expect(short.feePerShow.value).toBe(1_125);
    expect(short.perThousandViewers.value).toBe(500);
  });

  it('gives a ratio of 0 with a note, and no fee, when the network expects nobody', () => {
    const none = termsOf({ benchmark: viewers('Expected', 0) });
    expect(none.ratio.value).toBe(0);
    expect(none.ratio.trace.children?.[0]?.label).toBe(NO_BENCHMARK_NOTE);
    expect(none.feePerShow.value).toBe(0);
  });

  it('rounds the fee down to the cent', () => {
    const odd = termsOf({ projected: viewers('Projected', 1_234), benchmark: viewers('E', 1_000) });
    expect(Number.isInteger(odd.feePerShow.value)).toBe(true);
    expect(odd.feePerShow.value).toBe(Math.floor(1.234 * 5_000 * 0.9));
  });
});

describe('dealTerms on streaming and pay-per-view', () => {
  it('pays streaming all as the flat fee, with no per-thousand part', () => {
    const terms = termsOf({ kind: 'streaming' });
    expect(terms.feePerShow.value).toBe(2 * 3_125);
    expect(terms.perThousandViewers.value).toBe(0);
    expect(terms.perThousandViewers.trace.children?.[0]?.label).toBe(
      STREAMING_NO_PER_THOUSAND_NOTE,
    );
  });

  it('never pays a pay-per-view fee, only a rate per thousand buys scaled by the shortfall', () => {
    for (const projected of [100, 1_000, 50_000]) {
      const terms = termsOf({ kind: 'ppv', projected: viewers('Buys', projected) });
      expect(terms.feePerShow.value).toBe(0);
      expect(terms.feePerShow.trace.children?.[0]?.label).toBe(PPV_NO_FEE_NOTE);
      expect(terms.perThousandViewers.value).toBe(
        Math.floor(180_000 * Math.min(projected / 1_000, 1)),
      );
    }
  });
});

describe('dealTerms airtime', () => {
  const cases: readonly (readonly [NetworkKind, number, number, number])[] = [
    // kind, people covered, tier, airtime in cents
    // 31.3 × 1,875 × 1 = 58,687.5 → 58,687 → 58,600 (odd cents dropped).
    ['tv', 31_300_000, 0, 58_600],
    // Pay-per-view keeps its own, higher rate (ECO8-09): 31.3 × 15,000 × 4.
    ['ppv', 31_300_000, 3, 1_878_000],
    // 3,333,333 people, tier 2, streaming: 3.333333 × 1,875 × 3 × 0.1 = 1,874.99 → 1,800.
    ['streaming', 3_333_333, 2, 1_800],
    ['tv', 1_234_567, 1, 4_600],
  ];

  it.each(cases)('charges %s airtime by people covered and tier', (kind, people, tier, cost) => {
    const terms = termsOf({ kind, coveredPopulation: people, reachTier: tier });
    expect(terms.costPerShow.value).toBe(cost);
    expect(terms.costPerShow.value % 100).toBe(0);
  });
});

describe('dealTerms with each rate at 0 (0 means 0)', () => {
  it('pays no TV fee and no per-thousand rate when the TV rate is 0', () => {
    const terms = termsOf({}, createEngineTunables({ 'broadcast.value.tvPerThousand': 0 }));
    expect(terms.feePerShow.value).toBe(0);
    expect(terms.perThousandViewers.value).toBe(0);
  });

  it('pays no streaming fee when the streaming rate is 0', () => {
    const tunables = createEngineTunables({ 'broadcast.value.streamingPerThousand': 0 });
    expect(termsOf({ kind: 'streaming' }, tunables).feePerShow.value).toBe(0);
  });

  it('pays nothing per buy when the pay-per-view rate is 0', () => {
    const tunables = createEngineTunables({ 'broadcast.value.ppvPerThousandBuys': 0 });
    expect(termsOf({ kind: 'ppv' }, tunables).perThousandViewers.value).toBe(0);
  });

  it('charges no airtime when its rate or the streaming factor is 0, each kind on its own rate', () => {
    const noAirtime = createEngineTunables({ 'broadcast.value.airtimePerMillion': 0 });
    expect(termsOf({}, noAirtime).costPerShow.value).toBe(0);
    expect(termsOf({ kind: 'ppv' }, noAirtime).costPerShow.value).toBeGreaterThan(0);
    const noPpvAirtime = createEngineTunables({ 'broadcast.value.ppvAirtimePerMillion': 0 });
    expect(termsOf({ kind: 'ppv' }, noPpvAirtime).costPerShow.value).toBe(0);
    expect(termsOf({}, noPpvAirtime).costPerShow.value).toBeGreaterThan(0);
    const freeStreaming = createEngineTunables({ 'broadcast.value.streamingAirtimeFactor': 0 });
    expect(termsOf({ kind: 'streaming' }, freeStreaming).costPerShow.value).toBe(0);
  });

  it('pays everything flat when the bonus share is 0, and no flat fee when the cap is 0', () => {
    const allFlat = termsOf({}, createEngineTunables({ 'broadcast.value.tvBonusShare': 0 }));
    expect(allFlat.feePerShow.value).toBe(10_000);
    expect(allFlat.perThousandViewers.value).toBe(0);
    const noCap = termsOf({}, createEngineTunables({ 'broadcast.value.valuedViewersCap': 0 }));
    expect(noCap.feePerShow.value).toBe(0);
  });
});

describe('dealTerms determinism', () => {
  it('gives the same terms and traces for the same inputs', () => {
    expect(termsOf({ live: true })).toStrictEqual(termsOf({ live: true }));
  });
});
