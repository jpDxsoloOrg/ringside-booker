// Deal targets, the ratings bonus, the Exceeding health and the renewal uplift (ECO8-10).
// Design: docs/design/broadcast.md#ratings-bonus
import { describe, expect, it } from 'vitest';
import { addDays, addMonths } from '../../../src/core/date';
import { constantOf } from '../../../src/core/trace';
import {
  dealHealth,
  dealTargets,
  DEAL_RISKS,
  EXCEEDING_REASON,
  ratingsBonusMemo,
  ratingsBonusShare,
  renewalValuation,
  revalueDeal,
  type DealHealthAiring,
  type DealHealthInputs,
} from '../../../src/systems/broadcast';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';
import {
  addAirings,
  advanceOneDay,
  airedAt,
  dealOf,
  dealWorld,
  engineFor,
  TODAY,
  YOU,
  YOU_ISSUING,
} from './deal-world';

const TUNABLES = createEngineTunables();

function ratio(value: number) {
  return constantOf('Viewers against what Local TV expects', value, 'Test ratio');
}

function share(value: number, overrides: Record<string, number> = {}): number | null {
  return (
    ratingsBonusShare(
      ratio(value),
      { networkName: 'Local TV' },
      { tunables: createEngineTunables(overrides) },
    )?.value ?? null
  );
}

describe('dealTargets', () => {
  it('turns the health and bonus lines into whole viewers, each with a Why?', () => {
    const expected = constantOf('What Local TV expects', 2_800_000, 'Test benchmark');
    const targets = dealTargets(
      expected,
      { networkName: 'Local TV', noun: 'viewers' },
      { tunables: TUNABLES },
    );
    expect(targets.expected).toBe(2_800_000);
    expect(targets.safe.viewers.value).toBe(2_100_000);
    expect(targets.safe.share).toBe(0.75);
    expect(targets.cancel.viewers.value).toBe(1_540_000);
    expect(targets.cancel.share).toBe(0.55);
    expect(targets.bonus.viewers.value).toBe(3_220_000);
    expect(targets.bonus.share).toBe(1.15);
    expectSerialisable(targets);
    expectTraceReplays(targets.bonus.viewers);
  });

  it('rounds up, so reaching a target exactly is always enough', () => {
    const expected = constantOf('What Local TV expects', 1_001, 'Test benchmark');
    const targets = dealTargets(
      expected,
      { networkName: 'Local TV', noun: 'viewers' },
      { tunables: TUNABLES },
    );
    expect(targets.bonus.viewers.value).toBe(1_152);
  });
});

describe('ratingsBonusShare', () => {
  it('pays nothing below the bonus line', () => {
    expect(share(1.14)).toBeNull();
  });

  it('pays 7% of the fee at the line, climbing to the 18% cap at 140%', () => {
    expect(share(1.15)).toBeCloseTo(0.07, 10);
    expect(share(1.275)).toBeCloseTo(0.125, 10);
    expect(share(1.4)).toBeCloseTo(0.18, 10);
    expect(share(3)).toBeCloseTo(0.18, 10);
  });

  it('is off when the cap is 0, and pays the cap from the line when the cap is reached there', () => {
    expect(share(2, { 'broadcast.bonus.max': 0 })).toBeNull();
    expect(share(1.15, { 'broadcast.bonus.fullAt': 1 })).toBeCloseTo(0.18, 10);
  });

  it('has a Why? that replays', () => {
    const traced = ratingsBonusShare(
      ratio(1.3),
      { networkName: 'Local TV' },
      { tunables: TUNABLES },
    );
    if (traced === null) throw new Error('Expected a bonus');
    expectTraceReplays(traced);
  });
});

describe('the Exceeding health', () => {
  const missedAiring: DealHealthAiring = {
    airDate: addDays(TODAY, 7),
    status: 'missed',
    viewers: 0,
    expectedViewers: 10_000,
  };

  function inputs(viewerRatio: number, missed = false): DealHealthInputs {
    const aired = Array.from({ length: 6 }, (_, index) => ({
      airDate: addDays(TODAY, -7 * index),
      status: 'aired' as const,
      viewers: Math.round(10_000 * viewerRatio),
      expectedViewers: 10_000,
    }));
    return {
      networkName: 'Local TV',
      reachTier: 0,
      daysSinceStart: 365,
      recent: missed ? [missedAiring, ...aired].slice(0, 8) : aired,
      upcomingMissed: [],
    };
  }

  it('sits above Safe, keeping every older code', () => {
    expect(DEAL_RISKS).toEqual(['exceeding', 'safe', 'watch', 'atRisk', 'cancelling']);
  });

  it('is Exceeding at the bonus line, with the reason in words', () => {
    const result = dealHealth(inputs(1.2), { tunables: TUNABLES });
    expect(result.value).toBe('exceeding');
    expect(result.reasons).toEqual([
      `${EXCEEDING_REASON}: viewers are 120% of what Local TV expects`,
    ]);
    expectSerialisable(result);
  });

  it('is Safe just under it', () => {
    expect(dealHealth(inputs(1.14), { tunables: TUNABLES }).value).toBe('safe');
  });

  it('is never Exceeding with something to watch, however good the viewers', () => {
    expect(dealHealth(inputs(2, true), { tunables: TUNABLES }).value).toBe('watch');
  });

  it('is not judged during the grace period', () => {
    const result = dealHealth({ ...inputs(2), daysSinceStart: 10 }, { tunables: TUNABLES });
    expect(result.value).toBe('safe');
  });
});

describe('the ratings bonus on an airing', () => {
  it('pays its own ledger row with a Why?, and adds it to the airing', async () => {
    const built = dealWorld();
    // Five airings far above what Local TV expects: Monday's airing is judged with them.
    addAirings(built, built.yourDeal, airedAt(10, 5));
    const engine = engineFor(built.world);
    for (let day = 0; day < 3; day += 1) {
      await advanceOneDay(engine);
    }
    const world = engine.exportState().world;
    const bonusRows = world.tables.ledgerEntries.filter(
      (entry) => entry.memo === ratingsBonusMemo('Local TV'),
    );
    // The cap (18%) of the 1,000.00 fee.
    expect(bonusRows.map((entry) => [entry.promotionId, entry.amount, entry.category])).toEqual([
      [built.you, 18_000, 'broadcast'],
    ]);
    expect(bonusRows[0]?.traceRef).not.toBeNull();
    expect(bonusRows[0]?.refs.dealId).toBe(built.yourDeal);

    const monday = world.tables.airings.find(
      (airing) => airing.dealId === built.yourDeal && airing.airDate === addDays(TODAY, 2),
    );
    if (monday === undefined) throw new Error('Monday did not air');
    const fees = world.tables.ledgerEntries
      .filter((entry) => entry.refs.dealId === built.yourDeal && entry.category === 'broadcast')
      .reduce((sum, entry) => sum + entry.amount, 0);
    // The airing's income is the network's whole payment: fee, per-thousand and the bonus.
    expect(monday.income).toBe(fees + monday.sharesPaid);
  });

  it('pays nothing when recent viewers are below the bonus line', async () => {
    const built = dealWorld();
    addAirings(built, built.yourDeal, airedAt(1, 5));
    const engine = engineFor(built.world, { 'broadcast.bonus.above': 5 });
    for (let day = 0; day < 3; day += 1) {
      await advanceOneDay(engine);
    }
    const memos = engine.exportState().world.tables.ledgerEntries.map((entry) => entry.memo);
    expect(memos).not.toContain(ratingsBonusMemo('Local TV'));
  });
});

describe('renewing an Exceeding deal', () => {
  it('adds the uplift to the fee in the preview, with the reason, and signs it', () => {
    const built = dealWorld();
    addAirings(built, built.yourDeal, airedAt(1.5, 6));
    const deal = built.world.tables.deals.require(built.yourDeal);
    const plain = revalueDeal(
      built.world,
      createEngineTunables({ 'broadcast.bonus.renewalUplift': 0 }),
      deal,
      12,
    );
    const renewal = revalueDeal(built.world, TUNABLES, deal, 12);
    expect(plain.renewalUplift).toBeNull();
    expect(renewal.renewalUplift).toEqual({
      share: 0.1,
      term: 'feePerShow',
      reason: "Beating Local TV's expectations: renewed fee up 10%",
    });
    expect(renewal.terms.feePerShow.value).toBe(Math.floor(plain.terms.feePerShow.value * 1.1));
    expect(renewal.incomePerAiring.value).toBeGreaterThan(plain.incomePerAiring.value);
    expectTraceReplays(renewal.terms.feePerShow);

    const engine = engineFor(built.world);
    const preview = engine.query(
      'broadcast.valuation',
      {
        promotionId: built.you,
        networkId: deal.networkId,
        eventDefinitionId: deal.eventDefinitionId,
        timeslot: deal.timeslot,
        live: deal.live,
        months: 12,
        dealId: deal.id,
      },
      YOU,
    );
    if (!preview.ok) throw new Error(JSON.stringify(preview.reasons));
    expect(preview.data.terms.feePerShow.value).toBe(renewal.terms.feePerShow.value);
    expect(preview.data.renewalUplift?.share).toBe(0.1);

    const signed = engine.command(
      'broadcast.renegotiate',
      { dealId: deal.id, months: 12 },
      YOU_ISSUING,
    );
    if (!signed.ok) throw new Error(JSON.stringify(signed.reasons));
    expect(dealOf(engine, deal.id).terms.feePerShow).toBe(renewal.terms.feePerShow.value);
  });

  it('gives no uplift to a deal that is only Safe', () => {
    const built = dealWorld();
    addAirings(built, built.yourDeal, airedAt(1, 6));
    const deal = built.world.tables.deals.require(built.yourDeal);
    expect(
      renewalValuation(built.world, TUNABLES, deal, {
        promotionId: deal.promotionId,
        networkId: deal.networkId,
        eventDefinitionId: deal.eventDefinitionId,
        timeslot: deal.timeslot,
        live: deal.live,
        months: 12,
      }).renewalUplift,
    ).toBeNull();
  });

  it("renews a rival's Exceeding deal the same way", async () => {
    const built = dealWorld({ rivalEndsOn: TODAY });
    addAirings(built, built.rivalDeal, airedAt(1.5, 6));
    const rivalDeal = built.world.tables.deals.require(built.rivalDeal);
    const expected = revalueDeal(built.world, TUNABLES, rivalDeal, 24);
    expect(expected.renewalUplift).not.toBeNull();
    const engine = engineFor(built.world);
    await advanceOneDay(engine);
    const renewed = dealOf(engine, built.rivalDeal);
    expect(renewed.endsOn).toBe(addMonths(TODAY, 24));
    expect(renewed.terms.feePerShow).toBe(expected.terms.feePerShow.value);
  });
});

describe('deal rows', () => {
  it('carry the targets in viewers and the Exceeding health', () => {
    const built = dealWorld();
    addAirings(built, built.yourDeal, airedAt(1.5, 6));
    const engine = engineFor(built.world);
    const result = engine.query(
      'broadcast.deals',
      { promotionId: built.you, include: 'active' },
      YOU,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.reasons));
    const [row] = result.data;
    expect(row?.risk).toBe('exceeding');
    const expected = row?.expectedViewers?.value ?? 0;
    expect(expected).toBeGreaterThan(0);
    expect(row?.targets?.expected).toBe(expected);
    expect(row?.targets?.bonus.viewers.value).toBe(Math.ceil(expected * 1.15));
    expectSerialisable(result.data);
  });
});
