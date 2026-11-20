// Trades (TRD-01, TRD-03). Design: docs/design/trades.md
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OMNISCIENT_VIEWER } from '../../../src/core/api/controller';
import { parseContentKey } from '../../../src/core/content-key';
import { addDays, addMonths } from '../../../src/core/date';
import { cents } from '../../../src/core/money';
import { MatchDraftSchema } from '../../../src/systems/booking';
import type { EmploymentId, TradeId } from '../../../src/core/ids';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import { tradeAnsweredGate, tradeOfferGate, tradeTunables } from '../../../src/systems/trades';
import { rivalAnswer } from '../../../src/systems/trades/answer';
import { hasNoTradeClause, wrestlerSay } from '../../../src/systems/trades/say';
import { valueDeal, workerPoints } from '../../../src/systems/trades/value';
import { TradeWorkerReader } from '../../../src/systems/trades/workers';
import { offerFromArgs } from '../../../src/systems/trades/views';
import {
  candidates,
  nextDay,
  PLAYER,
  PLAYER_VIEW,
  run,
  terms,
  tradable,
  tradeGame,
  tradeEngine,
  tradeState,
  tunables,
  worldNow,
  type TradeGame,
} from './trade-game';

const DOLLAR = 100;

function best(game: TradeGame) {
  const mine = tradable(candidates(game.engine, game.me, game.rival));
  const theirs = tradable(candidates(game.engine, game.rival, game.me));
  return { mine, theirs };
}

/** A deal the rival accepts as it stands: your best wrestler and cash for their least valued. */
function goodDeal(game: TradeGame) {
  const { mine, theirs } = best(game);
  const give = mine[0];
  const get = theirs[theirs.length - 1];
  if (give === undefined || get === undefined) {
    throw new Error('no tradable wrestlers');
  }
  return {
    give,
    get,
    args: terms(game, [give.employmentId], [get.employmentId], { give: 500_000 * DOLLAR }),
  };
}

function preview(game: TradeGame, args: ReturnType<typeof terms>) {
  return run(game.engine.query('trades.preview', args, PLAYER_VIEW));
}

function tradeRow(game: TradeGame, tradeId: TradeId) {
  return run(game.engine.query('trades.get', { tradeId }, PLAYER_VIEW));
}

describe('valuation', () => {
  it('values a worker from the draft value, contract control, cost and the star factor', () => {
    const game = tradeGame();
    const world = worldNow(game.engine);
    const read = world;
    const deps = { tunables: tunables() };
    const { theirs } = best(game);
    const top = theirs[0]!;
    const reader = new TradeWorkerReader(read, deps.tunables, world.meta.currentDate);
    const worker = reader.worker(top.employmentId)!;
    const received = workerPoints(worker, deps, false);
    const lost = workerPoints(worker, deps, true);
    expect(received.points.value).toBeGreaterThan(0);
    // Same inputs, same number.
    expect(workerPoints(worker, deps, false).points).toEqual(received.points);
    // A longer contract (full control) is worth more than a short one.
    const long = reader.worker(top.employmentId, {
      employmentId: top.employmentId,
      pay: null,
      lengthMonths: 36,
    })!;
    const short = reader.worker(top.employmentId, {
      employmentId: top.employmentId,
      pay: null,
      lengthMonths: 1,
    })!;
    expect(workerPoints(long, deps, false).points.value).toBeGreaterThan(
      workerPoints(short, deps, false).points.value,
    );
    // An overpaid contract is worth less than a bargain.
    const dear = reader.worker(top.employmentId, {
      employmentId: top.employmentId,
      pay: cents(Math.round(worker.marketMonthly * 3)),
      lengthMonths: null,
    })!;
    expect(workerPoints(dear, deps, false).points.value).toBeLessThan(received.points.value);
    // A top star is counted higher when the rival would give them up.
    if (lost.star) {
      expect(lost.points.value).toBeGreaterThan(received.points.value);
    } else {
      expect(lost.points.value).toBe(received.points.value);
    }
  });

  it('adds roster needs and cash to the deal value, with plain lines and a Why?', () => {
    const game = tradeGame();
    const { mine, theirs } = best(game);
    const world = worldNow(game.engine);
    const date = world.meta.currentDate;
    const args = terms(game, [mine[0]!.employmentId], [theirs[0]!.employmentId]);
    const offer = offerFromArgs(args, game.me);
    const plain = valueDeal(world, tunables(), date, offer, game.rival);
    const withCash = valueDeal(
      world,
      tunables(),
      date,
      offerFromArgs(
        terms(game, args.give.employmentIds, args.get.employmentIds, { give: 250_000 * DOLLAR }),
        game.me,
      ),
      game.rival,
    );
    expect(withCash.score.value - plain.score.value).toBeCloseTo(10, 5); // $250,000 ÷ $25,000 a point
    expect(plain.lines.some((line) => line.startsWith('They get '))).toBe(true);
    expect(plain.lines.some((line) => line.startsWith('They give up '))).toBe(true);
    expect(plain.score.trace.label).toContain('What the deal is worth to');
  });
});

describe('the rival’s answer', () => {
  it('accepts a good deal the day after, and the workers and cash move', async () => {
    const game = tradeGame();
    const { give, get, args } = goodDeal(game);
    expect(preview(game, args).rival).toMatchObject({ lean: 'yes', likely: 'accept' });
    const before = worldNow(game.engine);
    const myCash = before.tables.promotions.require(game.me).cash;
    const theirCash = before.tables.promotions.require(game.rival).cash;
    const { tradeId } = run(game.engine.command('trades.propose', args, PLAYER));
    expect(tradeRow(game, tradeId)).toMatchObject({ status: 'open', awaitingYou: false });

    await nextDay(game.engine);
    const after = worldNow(game.engine);
    const view = tradeRow(game, tradeId);
    expect(view.status).toBe('completed');
    expect(view.answer?.kind).toBe('accept');
    expect(view.answer?.traceRef).not.toBeNull();
    expect(view.moves).toHaveLength(2);

    // Contracts: the old ones released (quietly), new ones active with the other side, same terms.
    const oldMine = after.tables.employments.require(give.employmentId);
    expect(oldMine).toMatchObject({ status: 'released', endedOn: before.meta.currentDate });
    const moved = view.moves.find((move) => move.fromEmploymentId === give.employmentId)!;
    const newMine = after.tables.employments.require(moved.toEmploymentId);
    expect(newMine).toMatchObject({
      status: 'active',
      promotionId: game.rival,
      personId: oldMine.personId,
      role: oldMine.role,
      push: oldMine.push,
      endsOn: oldMine.endsOn,
      ringName: oldMine.ringName,
    });
    expect(newMine.terms.monthlyWage).toBe(oldMine.terms.monthlyWage);
    expect(newMine.morale).toBe(Math.max(-100, Math.min(100, oldMine.morale + moved.moraleChange)));
    expect(after.tables.employments.require(get.employmentId).status).toBe('released');

    // Cash through the ledger: the player's buyout, the rival's other income.
    const paid = after.tables.ledgerEntries
      .lookup('byPromotion', game.me)
      .filter((row) => row.category === 'buyout');
    const received = after.tables.ledgerEntries
      .lookup('byPromotion', game.rival)
      .filter((row) => row.category === 'otherIncome' && (row.memo ?? '').startsWith('Trade with'));
    expect(paid.map((row) => row.amount)).toEqual([-500_000 * DOLLAR]);
    expect(received.map((row) => row.amount)).toEqual([500_000 * DOLLAR]);
    expect(after.tables.promotions.require(game.me).cash).toBe(myCash - 500_000 * DOLLAR);
    expect(after.tables.promotions.require(game.rival).cash).toBe(theirCash + 500_000 * DOLLAR);

    // News: one trade story per worker.
    const stories = after.tables.news
      .values()
      .filter((row) => row.headline.key === 'news.trade.headline');
    expect(stories).toHaveLength(2);

    // The stop: the rival answered, so the next skip stops until it is seen.
    expect(tradeAnsweredGate.check(after, after.meta.currentDate)?.reason).toMatch(
      /accepted your trade/,
    );
    run(game.engine.command('trades.markSeen', { tradeIds: [tradeId] }, PLAYER));
    const seen = worldNow(game.engine);
    expect(tradeAnsweredGate.check(seen, seen.meta.currentDate)).toBeNull();

    expect(checkWorld(seen, TABLES, { validateRows: true }).issues).toEqual([]);
  });

  it('refuses a deal that is far apart', async () => {
    const game = tradeGame();
    const { mine, theirs } = best(game);
    // Their three best for your least valued.
    const args = terms(
      game,
      [mine[mine.length - 1]!.employmentId],
      theirs.slice(0, 3).map((row) => row.employmentId),
    );
    expect(preview(game, args).rival).toMatchObject({ lean: 'far', likely: 'refuse' });
    const { tradeId } = run(game.engine.command('trades.propose', args, PLAYER));
    await nextDay(game.engine);
    const view = tradeRow(game, tradeId);
    expect(view).toMatchObject({ status: 'refused', outcome: { code: 'trades.refused' } });
    expect(view.answer?.lines.at(-1)).toMatch(/they refuse/);
  });

  it('counters a close deal with an offer it would accept, and you can accept the counter', async () => {
    const game = tradeGame();
    const { mine, theirs } = best(game);
    let found: ReturnType<typeof terms> | null = null;
    for (const give of mine) {
      for (const get of theirs) {
        const args = terms(game, [give.employmentId], [get.employmentId]);
        if (preview(game, args).rival?.likely === 'counter') {
          found = args;
          break;
        }
      }
      if (found !== null) {
        break;
      }
    }
    expect(found).not.toBeNull();
    const args = found!;
    const { tradeId } = run(game.engine.command('trades.propose', args, PLAYER));
    await nextDay(game.engine);
    const view = tradeRow(game, tradeId);
    expect(view).toMatchObject({ status: 'open', awaitingYou: true, rounds: 2, canAccept: true });
    expect(view.answer?.kind).toBe('counter');
    // The counter asks for more (cash or another worker) and clears the rival's own bar.
    const world = worldNow(game.engine);
    const counter = run(game.engine.query('trades.get', { tradeId }, OMNISCIENT_VIEWER));
    const answer = rivalAnswer(
      world,
      tunables(),
      world.meta.currentDate,
      world.tables.trades.require(tradeId).rounds.at(-1)!.offer,
      game.rival,
      1,
    );
    expect(answer.kind).toBe('accept');
    expect(
      counter.offer.sides.find((side) => side.promotionId === game.me)!.cash > 0 ||
        counter.offer.sides.find((side) => side.promotionId === game.me)!.workers.length > 1,
    ).toBe(true);
    // The counter stops the skip as an offer waiting for you.
    expect(tradeOfferGate.check(world, world.meta.currentDate)?.reason).toMatch(/counter-offer/);

    const accepted = run(
      game.engine.command('trades.respond', { tradeId, answer: 'accept' }, PLAYER),
    );
    expect(accepted.status).toBe('completed');
    expect(tradeRow(game, tradeId)).toMatchObject({ status: 'completed', stopsSkip: false });
  });

  it('lets you withdraw your offer, and keeps one open trade per pair', () => {
    const game = tradeGame();
    const { args } = goodDeal(game);
    const { tradeId } = run(game.engine.command('trades.propose', args, PLAYER));
    expect(run(game.engine.command('trades.withdraw', { tradeId }, PLAYER)).status).toBe(
      'withdrawn',
    );
    expect(
      game.engine.command('trades.respond', { tradeId, answer: 'accept' }, PLAYER),
    ).toMatchObject({
      ok: false,
      reasons: [{ code: 'trades.notOpen' }],
    });
    // One open trade per pair of promotions.
    run(game.engine.command('trades.propose', args, PLAYER));
    expect(game.engine.command('trades.propose', args, PLAYER)).toMatchObject({
      ok: false,
      reasons: [{ code: 'trades.talkOpen' }],
    });
  });
});

describe('the rules', () => {
  it('blocks a champion until the title is vacated or dropped', () => {
    const game = tradeGame();
    const world = worldNow(game.engine);
    const reign = world.tables.titleReigns
      .values()
      .find(
        (row) =>
          row.lostOn === null && world.tables.titles.get(row.titleId)?.promotionId === game.me,
      );
    expect(reign).toBeDefined();
    const champion = world.tables.employments
      .lookup('byPerson', reign!.holderIds[0]!)
      .find((row) => row.status === 'active' && row.promotionId === game.me)!;
    const { theirs } = best(game);
    const args = terms(game, [champion.id], [theirs.at(-1)!.employmentId]);
    const refused = game.engine.command('trades.propose', args, PLAYER);
    expect(refused.ok).toBe(false);
    const reasons = refused.ok ? [] : refused.reasons;
    expect(reasons.map((reason) => reason.code)).toContain('trades.champion');
    expect(reasons.find((reason) => reason.code === 'trades.champion')?.message).toMatch(
      /vacate it or have them drop it/,
    );
    expect(preview(game, args).problems.map((reason) => reason.code)).toContain('trades.champion');
    const row = candidates(game.engine, game.me, game.rival).find(
      (candidate) => candidate.employmentId === champion.id,
    );
    expect(row).toMatchObject({ tradable: false, reasons: [{ code: 'trades.champion' }] });
  });

  it('refuses empty trades, cash both ways, cash you do not have, and other people’s contracts', () => {
    const game = tradeGame();
    const { mine, theirs } = best(game);
    const codes = (args: ReturnType<typeof terms>) => {
      const result = game.engine.command('trades.propose', args, PLAYER);
      return result.ok ? [] : result.reasons.map((reason) => reason.code);
    };
    expect(codes(terms(game, [], []))).toContain('trades.empty');
    expect(
      codes(
        terms(game, [mine[0]!.employmentId], [theirs[0]!.employmentId], { give: 100, get: 100 }),
      ),
    ).toContain('trades.cashBothWays');
    expect(codes(terms(game, [mine[0]!.employmentId], [], { give: 999_999_999_999 }))).toContain(
      'trades.notEnoughCash',
    );
    expect(codes(terms(game, [theirs[0]!.employmentId], []))).toContain('trades.notOnRoster');
    expect(
      game.engine.command(
        'trades.propose',
        {
          ...terms(game, [mine[0]!.employmentId], []),
          promotionId: game.rival,
          partnerId: game.me,
        },
        PLAYER,
      ),
    ).toMatchObject({ ok: false, reasons: [{ code: 'notAllowed' }] });
  });
});

describe('the wrestler’s say', () => {
  it('derives a no-trade clause that never changes, always for creative control', () => {
    const game = tradeGame();
    const world = worldNow(game.engine);
    const reader = new TradeWorkerReader(world, tunables(), world.meta.currentDate);
    const mainEventers = world.tables.employments
      .values()
      .filter((row) => row.status === 'active' && row.push === 'mainEvent')
      .map((row) => reader.worker(row.id)!);
    const clauses = mainEventers.map((worker) => hasNoTradeClause(world, tunables(), worker));
    expect(mainEventers.map((worker) => hasNoTradeClause(world, tunables(), worker))).toEqual(
      clauses,
    );
    expect(clauses.some(Boolean)).toBe(true);
    expect(clauses.every(Boolean)).toBe(false);
    const none = tunables({
      'trades.noTrade.chanceMainEvent': 0,
      'trades.noTrade.chanceUpperCard': 0,
      'trades.noTrade.creativeControl': false,
    });
    expect(mainEventers.some((worker) => hasNoTradeClause(world, none, worker))).toBe(false);
    const worker = mainEventers[0]!;
    const withControl = {
      ...worker,
      employment: {
        ...worker.employment,
        terms: {
          ...worker.employment.terms,
          perks: { ...worker.employment.terms.perks, creativeControl: true },
        },
      },
    };
    expect(hasNoTradeClause(world, none, withControl)).toBe(false);
    expect(
      hasNoTradeClause(world, tunables({ 'trades.noTrade.creativeControl': true }), withControl),
    ).toBe(true);
  });

  it('is unhappy moved to a smaller spot, happy to move up, and a pay rise helps', () => {
    const game = tradeGame();
    const world = worldNow(game.engine);
    const reader = new TradeWorkerReader(world, tunables(), world.meta.currentDate);
    const { mine } = best(game);
    const worker = reader.worker(mine[0]!.employmentId)!;
    const promotions = world.tables.promotions.values();
    const lowest = [...promotions].sort((left, right) => left.prestige - right.prestige)[0]!;
    const highest = [...promotions].sort((left, right) => right.prestige - left.prestige)[0]!;
    const down = wrestlerSay(world, tunables(), worker, lowest.id);
    const up = wrestlerSay(world, tunables(), worker, highest.id);
    expect(down.feeling.value).toBeLessThan(up.feeling.value);
    expect(down.moraleChange).toBeLessThan(0);
    expect(Math.abs(down.moraleChange)).toBeLessThanOrEqual(15);
    const raise = reader.worker(worker.employmentId, {
      employmentId: worker.employmentId,
      pay: cents(worker.pay * 2),
      lengthMonths: null,
    })!;
    expect(wrestlerSay(world, tunables(), raise, lowest.id).feeling.value).toBeGreaterThan(
      down.feeling.value,
    );
    expect(down.feeling.trace.label).toMatch(/How .* feels about moving/);
  });

  it('a no-trade clause stops the trade when they do not want to go', () => {
    const game = tradeGame({
      'trades.noTrade.chanceMainEvent': 1,
      'trades.noTrade.chanceUpperCard': 1,
      'trades.say.uprootCost': 50,
    });
    const world = worldNow(game.engine);
    const star = world.tables.employments
      .lookup('byPromotionStatus', `${game.me}|active`)
      .find(
        (row) =>
          row.push === 'mainEvent' &&
          !world.tables.titleReigns
            .lookup('byHolder', row.personId)
            .some((reign) => reign.lostOn === null),
      )!;
    const result = game.engine.command('trades.propose', terms(game, [star.id], []), PLAYER);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.reasons.map((reason) => reason.code)).toContain(
      'trades.noTradeClause',
    );
  });

  it('applies the contract change in the deal: new pay and length on the new contract', async () => {
    const game = tradeGame();
    const { give, get, args } = goodDeal(game);
    const world = worldNow(game.engine);
    const pay = Math.round(get.contract.pay * 1.2);
    const { tradeId } = run(
      game.engine.command(
        'trades.propose',
        {
          ...args,
          adjustments: [{ employmentId: get.employmentId, pay: cents(pay), lengthMonths: 18 }],
        },
        PLAYER,
      ),
    );
    await nextDay(game.engine);
    const view = tradeRow(game, tradeId);
    expect(view.status).toBe('completed');
    const move = view.moves.find((row) => row.fromEmploymentId === get.employmentId)!;
    const after = worldNow(game.engine);
    const contract = after.tables.employments.require(move.toEmploymentId);
    const main =
      contract.terms.kind === 'perAppearance'
        ? contract.terms.perAppearanceFee
        : contract.terms.monthlyWage;
    expect(main).toBe(pay);
    expect(contract.endsOn).toBe(addMonths(world.meta.currentDate, 18));
    expect(contract.startsOn).toBe(world.meta.currentDate);
    expect(give.employmentId).not.toBe(get.employmentId);
  });
});

describe('bookings and stables', () => {
  it('takes the worker off the old promotion’s future cards safely', async () => {
    const game = tradeGame();
    const { give, args } = goodDeal(game);
    const world = worldNow(game.engine);
    const show = world.tables.eventInstances
      .lookup('byPromotion', game.me)
      .filter((row) => row.status === 'scheduled' && row.date > world.meta.currentDate)
      .sort((left, right) => (left.date < right.date ? -1 : 1))[0]!;
    const others = world.tables.employments
      .lookup('byPromotionStatus', `${game.me}|active`)
      .filter((row) => row.role === 'wrestler' && row.id !== give.employmentId)
      .slice(0, 2);
    const singles = run(
      game.engine.command(
        'booking.addSegment',
        {
          eventInstanceId: show.id,
          preShow: false,
          slot: 0,
          draft: MatchDraftSchema.parse({
            kind: 'match',
            label: null,
            match: { matchTypeKey: parseContentKey('match.singles') },
            participants: [
              { personId: give.personId, side: 0, role: 'competitor', teamId: null },
              { personId: others[0]!.personId, side: 1, role: 'competitor', teamId: null },
            ],
            outcome: null,
          }),
        },
        PLAYER,
      ),
    );
    const handicap = run(
      game.engine.command(
        'booking.addSegment',
        {
          eventInstanceId: show.id,
          preShow: false,
          slot: 1,
          draft: MatchDraftSchema.parse({
            kind: 'match',
            label: null,
            match: { matchTypeKey: parseContentKey('match.handicap') },
            participants: [
              { personId: others[1]!.personId, side: 0, role: 'competitor', teamId: null },
              { personId: give.personId, side: 1, role: 'competitor', teamId: null },
              { personId: others[0]!.personId, side: 1, role: 'competitor', teamId: null },
            ],
            outcome: null,
          }),
        },
        PLAYER,
      ),
    );
    run(game.engine.command('trades.propose', args, PLAYER));
    await nextDay(game.engine);
    const after = worldNow(game.engine);
    expect(after.tables.segments.get(singles.segmentId)).toBeUndefined();
    const kept = after.tables.participants.lookup('bySegment', handicap.segmentId);
    expect(kept.map((row) => row.personId).sort()).toEqual(
      [others[0]!.personId, others[1]!.personId].sort(),
    );
    expect(checkWorld(after, TABLES, { validateRows: true }).issues).toEqual([]);
  });
});

describe('rival trade offers (TRD-03)', () => {
  async function playYear(overrides = {}) {
    const engine = tradeEngine(tradeState(), overrides);
    for (let guard = 0; guard < 400; guard += 1) {
      const result = await engine.advanceDays({
        maxDays: 365 - engine.exportState().world.meta.daysSimulated,
      });
      const open = engine
        .exportState()
        .world.tables.trades.filter((row) => row.stopsSkip)
        .map((row) => row.id);
      if (open.length > 0) {
        run(engine.command('trades.markSeen', { tradeIds: open }, PLAYER));
      }
      if (
        result.stoppedBy.kind === 'completed' ||
        engine.exportState().world.meta.daysSimulated >= 365
      ) {
        break;
      }
    }
    return engine.exportState().world;
  }

  it('are rare: never in the first weeks, at most about one a month, and deterministic', async () => {
    const world = await playYear();
    const rivalOffers = world.tables.trades
      .filter(
        (row) =>
          world.tables.promotions.find((promotion) => promotion.id === row.initiatorId)?.controller
            .kind === 'computer',
      )
      .map((row) => row.rounds[0]!.on)
      .sort();
    expect(rivalOffers.length).toBeGreaterThan(0);
    expect(rivalOffers.length).toBeLessThanOrEqual(12);
    const start = world.meta.startDate;
    expect(rivalOffers[0]! >= addDays(start, 60)).toBe(true);
    for (let index = 1; index < rivalOffers.length; index += 1) {
      expect(rivalOffers[index]! >= addDays(rivalOffers[index - 1]!, 30)).toBe(true);
    }
    const again = await playYear();
    expect(again.tables.trades).toEqual(world.tables.trades);
  }, 120_000);

  it('can be turned off, and an offer you leave unanswered lapses', async () => {
    const off = await playYear({ 'trades.rivalOffer.weeklyChance': 0 });
    expect(off.tables.trades).toEqual([]);
    const on = await playYear({
      'trades.rivalOffer.weeklyChance': 1,
      'trades.rivalOffer.graceDays': 0,
    });
    expect(on.tables.trades.length).toBeGreaterThan(0);
    expect(on.tables.trades.every((row) => row.status === 'lapsed' || row.status === 'open')).toBe(
      true,
    );
  }, 120_000);

  it('is answered with trades.respond: accept, refuse or counter', async () => {
    const engine = tradeEngine(tradeState(), {
      'trades.rivalOffer.weeklyChance': 1,
      'trades.rivalOffer.graceDays': 0,
    });
    let tradeId: TradeId | undefined;
    for (let day = 0; day < 14 && tradeId === undefined; day += 1) {
      await engine.advanceDays({ maxDays: 1 });
      tradeId = engine.exportState().world.tables.trades.find((row) => row.status === 'open')?.id;
    }
    expect(tradeId).toBeDefined();
    const world = worldOf(engine);
    expect(tradeOfferGate.check(world, world.meta.currentDate)?.reason).toMatch(
      /offered you a trade/,
    );
    const view = run(engine.query('trades.get', { tradeId: tradeId! }, PLAYER_VIEW));
    expect(view).toMatchObject({ rivalInitiated: true, awaitingYou: true, canRefuse: true });
    // The rival's offer clears its own bar.
    const own = rivalAnswer(
      world,
      tunables(),
      world.meta.currentDate,
      world.tables.trades.require(tradeId!).rounds[0]!.offer,
      view.initiatorId,
      1,
    );
    expect(own.kind).toBe('accept');
    expect(
      run(engine.command('trades.respond', { tradeId: tradeId!, answer: 'refuse' }, PLAYER)).status,
    ).toBe('refused');
  }, 60_000);
});

describe('saves', () => {
  it('round-trips open and completed trades through a save', async () => {
    const game = tradeGame();
    const { args } = goodDeal(game);
    const { tradeId } = run(game.engine.command('trades.propose', args, PLAYER));
    await nextDay(game.engine);
    const state = game.engine.exportState();
    const copy = tradeEngine(structuredClone(state));
    expect(copy.exportState().world.tables.trades).toEqual(state.world.tables.trades);
    expect(run(copy.query('trades.get', { tradeId }, PLAYER_VIEW))).toEqual(
      run(game.engine.query('trades.get', { tradeId }, PLAYER_VIEW)),
    );
  });
});

function worldOf(engine: TradeGame['engine']) {
  return worldNow(engine);
}

export type { EmploymentId };

describe('docs', () => {
  it('lists every trade tunable and every anchor the trade code points at', () => {
    const doc = readFileSync(
      new URL('../../../../../docs/design/trades.md', import.meta.url),
      'utf8',
    );
    const table = readFileSync(
      new URL('../../../../../docs/design/tunables.md', import.meta.url),
      'utf8',
    );
    const anchors = new Set(
      [...doc.matchAll(/^#{2,3} (.+)$/gm)].map((match) =>
        (match[1] ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9 -]/g, '')
          .trim()
          .replace(/ /g, '-'),
      ),
    );
    for (const [key, def] of Object.entries(tradeTunables)) {
      expect(table, key).toContain(`\`${key}\``);
      const anchor = def.docRef?.split('#')[1];
      expect(anchors, `${key} → ${String(anchor)}`).toContain(anchor);
    }
  });
});
