// The deal commands (ECO8-05): propose, renegotiate and cancel, only for your own promotion, with
// refusals explained; and the deals queries. Design: docs/design/broadcast.md#commands
import { describe, expect, it } from 'vitest';
import { OMNISCIENT_VIEWER, type Engine } from '../../../../src/core/api';
import { addDays, addMonths } from '../../../../src/core/date';
import {
  NOT_YOUR_PROMOTION,
  type BroadcastValuationArgs,
  type ProposeDealArgs,
} from '../../../../src/systems/broadcast';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  addAirings,
  airedAt,
  COMPUTER,
  dealOf,
  dealWorld,
  endedEvents,
  engineFor,
  renegotiatedEvents,
  signedEvents,
  TODAY,
  YOU,
  YOU_ISSUING,
  type DealWorld,
} from '../deal-world';

function proposal(built: DealWorld, overrides: Partial<ProposeDealArgs> = {}): ProposeDealArgs {
  return {
    promotionId: built.you,
    networkId: built.network,
    eventDefinitionId: built.yourThursday,
    timeslot: 'evening',
    live: false,
    months: 24,
    ...overrides,
  };
}

function codes(result: { ok: boolean; reasons?: readonly { code: string }[] }): string[] {
  return result.ok ? [] : (result.reasons ?? []).map((reason) => reason.code);
}

function preview(engine: Engine, args: BroadcastValuationArgs) {
  const result = engine.query('broadcast.valuation', args, YOU);
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return result.data;
}

describe('broadcast.proposeDeal', () => {
  it('signs exactly the previewed terms and makes the show televised', () => {
    const built = dealWorld();
    const result = built.world.transact('untelevise', (tx) => {
      tx.update('eventDefinitions', built.yourThursday, { televised: false });
    });
    if (!result.ok) throw result.error;
    const engine = engineFor(built.world);
    const args = proposal(built);
    const valuation = preview(engine, args);
    expect(valuation.verdict).toBe('accept');
    expect(valuation.becomesTelevised).toBe(true);

    const signed = engine.command('broadcast.proposeDeal', args, YOU_ISSUING);
    if (!signed.ok) throw new Error(JSON.stringify(signed.reasons));
    const deal = dealOf(engine, signed.data.dealId);
    expect(deal).toMatchObject({
      status: 'active',
      promotionId: built.you,
      networkId: built.network,
      eventDefinitionId: built.yourThursday,
      offeredOn: TODAY,
      startsOn: valuation.startsOn,
      endsOn: valuation.endsOn,
      weekday: 3,
      timeslot: 'evening',
      live: false,
      endedOn: null,
      endedReason: null,
      terms: {
        feePerShow: valuation.terms.feePerShow.value,
        perThousandViewers: valuation.terms.perThousandViewers.value,
        costPerShow: valuation.terms.costPerShow.value,
      },
    });
    const definition = engine
      .exportState()
      .world.tables.eventDefinitions.find((row) => row.id === built.yourThursday);
    expect(definition?.televised).toBe(true);
    expect(signedEvents(engine)).toEqual([
      { dealId: signed.data.dealId, promotionId: built.you, networkId: built.network },
    ]);
    const log = engine.query('sim.commandLog', { limit: 5 }, OMNISCIENT_VIEWER);
    if (!log.ok) throw new Error('No command log');
    expect(log.data.at(-1)).toMatchObject({
      name: 'broadcast.proposeDeal',
      issuedBy: YOU_ISSUING,
      outcome: 'applied',
    });
    // The opening note: why the network signed.
    const listed = engine.query('broadcast.deal', { dealId: signed.data.dealId }, YOU);
    if (!listed.ok || listed.data.visibility !== 'own') throw new Error('Not own');
    expect(listed.data.deal.healthTraceRef).not.toBeNull();
  });

  it('refuses with every reason the network has and changes nothing', () => {
    const built = dealWorld();
    const engine = engineFor(built.world);
    const before = JSON.stringify(engine.exportState().world);
    // Your Monday already airs there, and a 2-month deal is too short.
    const args = proposal(built, { eventDefinitionId: built.yourShow, months: 2 });
    const refusals = preview(engine, args).refusals.map((refusal) => refusal.code);
    const result = engine.command('broadcast.proposeDeal', args, YOU_ISSUING);
    expect(codes(result)).toEqual(refusals);
    expect(refusals).toEqual(['alreadyOnNetwork', 'badLength']);
    if (result.ok) throw new Error('Expected a refusal');
    expect(result.reasons[0]?.subject).toEqual({ kind: 'network', id: built.network });
    expect(JSON.stringify(engine.exportState().world)).toBe(before);
  });

  it("refuses a rival's promotion and another promotion's show", () => {
    const built = dealWorld();
    const engine = engineFor(built.world);
    const rivals = proposal(built, {
      promotionId: built.rival,
      eventDefinitionId: built.rivalShow,
    });
    expect(codes(engine.command('broadcast.proposeDeal', rivals, YOU_ISSUING))).toEqual([
      NOT_YOUR_PROMOTION,
    ]);
    expect(
      codes(
        engine.command(
          'broadcast.proposeDeal',
          proposal(built, { eventDefinitionId: built.rivalShow }),
          YOU_ISSUING,
        ),
      ),
    ).toEqual(['notYourShow']);
    // The computer acts for its own promotions through the same command, never for yours.
    expect(codes(engine.command('broadcast.proposeDeal', proposal(built), COMPUTER))).toEqual([
      NOT_YOUR_PROMOTION,
    ]);
  });
});

describe('broadcast.renegotiate', () => {
  it('extends from endsOn at today’s valuation', () => {
    const built = dealWorld();
    const engine = engineFor(built.world);
    const oldEnd = dealOf(engine, built.yourDeal).endsOn;
    const valuation = preview(engine, {
      ...proposal(built, { eventDefinitionId: built.yourShow, months: 12 }),
      dealId: built.yourDeal,
    });
    const result = engine.command(
      'broadcast.renegotiate',
      { dealId: built.yourDeal, months: 12 },
      YOU_ISSUING,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.reasons));
    expect(result.data.endsOn).toBe(addMonths(oldEnd, 12));
    expect(dealOf(engine, built.yourDeal)).toMatchObject({
      endsOn: addMonths(oldEnd, 12),
      renegotiatedOn: TODAY,
      warnedOn: null,
      terms: {
        feePerShow: valuation.terms.feePerShow.value,
        perThousandViewers: valuation.terms.perThousandViewers.value,
        costPerShow: valuation.terms.costPerShow.value,
      },
    });
    expect(renegotiatedEvents(engine)).toEqual([
      { dealId: built.yourDeal, promotionId: built.you },
    ]);
  });

  it('extends from today when the end date has passed', () => {
    const built = dealWorld({ yourEndsOn: TODAY });
    const engine = engineFor(built.world);
    const result = engine.command(
      'broadcast.renegotiate',
      { dealId: built.yourDeal, months: 6 },
      YOU_ISSUING,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.reasons));
    expect(result.data.endsOn).toBe(addMonths(TODAY, 6));
  });

  it("refuses an ended deal, a rival's deal and a refused length", () => {
    const built = dealWorld();
    const engine = engineFor(built.world);
    expect(
      codes(
        engine.command(
          'broadcast.renegotiate',
          { dealId: built.rivalDeal, months: 12 },
          YOU_ISSUING,
        ),
      ),
    ).toEqual([NOT_YOUR_PROMOTION]);
    expect(
      codes(
        engine.command('broadcast.renegotiate', { dealId: built.yourDeal, months: 2 }, YOU_ISSUING),
      ),
    ).toEqual(['badLength']);
    const cancelled = engine.command(
      'broadcast.cancelDeal',
      { dealId: built.yourDeal },
      YOU_ISSUING,
    );
    expect(cancelled.ok).toBe(true);
    expect(
      codes(
        engine.command(
          'broadcast.renegotiate',
          { dealId: built.yourDeal, months: 12 },
          YOU_ISSUING,
        ),
      ),
    ).toEqual(['dealNotActive']);
  });
});

describe('broadcast.cancelDeal', () => {
  it('posts the previewed exit fee and ends the deal', () => {
    const built = dealWorld();
    addAirings(built, built.yourDeal, airedAt(1, 2), addDays(TODAY, -1));
    const engine = engineFor(built.world);
    const cashBefore = built.world.tables.promotions.require(built.you).cash;
    const shown = engine.query('broadcast.cancelPreview', { dealId: built.yourDeal }, YOU);
    if (!shown.ok) throw new Error(JSON.stringify(shown.reasons));
    const deal = dealOf(engine, built.yourDeal);
    const shows = createEngineTunables().get('broadcast.deal.exitFeeShows');
    // The last airing drew 10,000 viewers.
    const perShow = deal.terms.feePerShow + Math.floor(10 * deal.terms.perThousandViewers);
    expect(shown.data.exitFee).toBe(perShow * shows);

    const result = engine.command('broadcast.cancelDeal', { dealId: built.yourDeal }, YOU_ISSUING);
    if (!result.ok) throw new Error(JSON.stringify(result.reasons));
    expect(result.data.exitFee).toBe(shown.data.exitFee);
    const state = engine.exportState().world.tables;
    const fee = state.ledgerEntries.find((row) => row.refs.dealId === built.yourDeal);
    expect(fee).toMatchObject({
      category: 'otherCost',
      amount: -shown.data.exitFee,
      memo: 'Early exit: Local TV',
    });
    expect(state.promotions.find((row) => row.id === built.you)?.cash).toBe(
      cashBefore - shown.data.exitFee,
    );
    expect(dealOf(engine, built.yourDeal)).toMatchObject({
      status: 'cancelled',
      endedOn: TODAY,
      endedReason: 'byPromotion',
    });
    expect(endedEvents(engine)).toEqual([
      {
        dealId: built.yourDeal,
        promotionId: built.you,
        networkId: built.network,
        reason: 'byPromotion',
      },
    ]);
  });

  it('posts nothing when the exit fee is 0', () => {
    const built = dealWorld();
    const engine = engineFor(built.world, { 'broadcast.deal.exitFeeShows': 0 });
    const result = engine.command('broadcast.cancelDeal', { dealId: built.yourDeal }, YOU_ISSUING);
    if (!result.ok) throw new Error(JSON.stringify(result.reasons));
    expect(result.data.exitFee).toBe(0);
    expect(engine.exportState().world.tables.ledgerEntries).toEqual([]);
  });

  it("refuses a rival's deal", () => {
    const built = dealWorld();
    const engine = engineFor(built.world);
    expect(
      codes(engine.command('broadcast.cancelDeal', { dealId: built.rivalDeal }, YOU_ISSUING)),
    ).toEqual([NOT_YOUR_PROMOTION]);
    expect(
      codes(engine.query('broadcast.cancelPreview', { dealId: built.rivalDeal }, YOU)),
    ).toEqual([NOT_YOUR_PROMOTION]);
  });
});

describe('the deals queries', () => {
  it('lists your deals with their health; ended ones only with include all', () => {
    const built = dealWorld();
    addAirings(built, built.yourDeal, airedAt(1.2, 3));
    const engine = engineFor(built.world);
    const active = engine.query(
      'broadcast.deals',
      { promotionId: built.you, include: 'active' },
      YOU,
    );
    if (!active.ok) throw new Error(JSON.stringify(active.reasons));
    const [row] = active.data;
    expect(active.data).toHaveLength(1);
    expect(row).toMatchObject({
      dealId: built.yourDeal,
      networkName: 'Local TV',
      showName: 'Your Monday',
      status: 'active',
      risk: 'safe',
      daysLeft: 300,
      lastAiring: { airDate: TODAY, viewers: 12_000, expectedViewers: 10_000 },
    });
    expect(row?.recent.map((airing) => airing.airDate)).toEqual([
      addDays(TODAY, -14),
      addDays(TODAY, -7),
      TODAY,
    ]);
    expect(row?.expectedViewers?.value).toBeGreaterThan(0);

    engine.command('broadcast.cancelDeal', { dealId: built.yourDeal }, YOU_ISSUING);
    const after = engine.query(
      'broadcast.deals',
      { promotionId: built.you, include: 'active' },
      YOU,
    );
    const all = engine.query('broadcast.deals', { promotionId: built.you, include: 'all' }, YOU);
    if (!after.ok || !all.ok) throw new Error('Query failed');
    expect(after.data).toEqual([]);
    expect(all.data[0]).toMatchObject({
      status: 'cancelled',
      endedReason: 'byPromotion',
      risk: null,
      riskReasons: [],
    });
  });

  it("refuses a rival's deals list and shows a rival's deal without its money", () => {
    const built = dealWorld();
    const engine = engineFor(built.world);
    expect(
      codes(engine.query('broadcast.deals', { promotionId: built.rival, include: 'all' }, YOU)),
    ).toEqual([NOT_YOUR_PROMOTION]);
    const rival = engine.query('broadcast.deal', { dealId: built.rivalDeal }, YOU);
    if (!rival.ok) throw new Error(JSON.stringify(rival.reasons));
    expect(rival.data.visibility).toBe('public');
    expect(Object.keys(rival.data.deal).sort()).toEqual(
      [
        'dealId',
        'endsOn',
        'kind',
        'live',
        'networkName',
        'showName',
        'startsOn',
        'timeslot',
        'weekday',
      ].sort(),
    );
    const own = engine.query('broadcast.deal', { dealId: built.yourDeal }, YOU);
    if (!own.ok || own.data.visibility !== 'own') throw new Error('Not own');
    expect(own.data.deal.airings).toEqual([]);
  });
});
