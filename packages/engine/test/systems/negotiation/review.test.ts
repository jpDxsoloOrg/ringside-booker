// The review phase: reactions, counter-offers, walk-aways, lapses, reviews and signings (ECO5-05).
// Design: docs/design/negotiation.md#review
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { Controller } from '../../../src/core/api/controller';
import { addDays, addMonths, type GameDate } from '../../../src/core/date';
import type { AnyDomainEvent } from '../../../src/core/events';
import type { EmploymentId, NegotiationId, PersonId, PromotionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import { isFullTrace } from '../../../src/core/trace/store';
import type { TraceNode } from '../../../src/core/trace/types';
import { checkWorld } from '../../../src/model/integrity';
import type { Employment } from '../../../src/model/entities/employment';
import type { Negotiation } from '../../../src/model/entities/negotiation';
import { TABLES } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import { contractsSystem } from '../../../src/systems/contracts';
import { financeSystem } from '../../../src/systems/finance';
import {
  ANOTHER_OFFER_NOTE,
  askTermsOf,
  COOLDOWN_CODE,
  COUNTER_WAITING_GATE_ID,
  FULL_ASK_COUNTER_REASON,
  negotiationSystem,
  reviewTraceRef,
  type AskingTermsView,
  type Offer,
} from '../../../src/systems/negotiation';
import { workersSystem } from '../../../src/systems/workers';
import { anOffer, type DeepPartial } from '../../support';
import {
  negotiationWorld,
  OTHER_PLAYER,
  OTHER_VIEW,
  PLAYER,
  PLAYER_VIEW,
  RIVAL_NAME,
  type NegotiationWorld,
} from './negotiation-world';

const COMPUTER: Controller = { kind: 'computer' };
const SYSTEMS = [simSystem, financeSystem, workersSystem, contractsSystem, negotiationSystem];
/** Stops that would end a test skip early for reasons this file does not test. */
const QUIET = {
  'contracts.expiringSoon.stopSkip': false,
  'contracts.releaseRequest.stopSkip': false,
} as const;

interface ReviewEngine {
  readonly engine: Engine;
  readonly events: AnyDomainEvent[];
  readonly setup: NegotiationWorld;
}

function reviewEngine(
  setup: NegotiationWorld,
  overrides: Record<string, number | boolean> = {},
): ReviewEngine {
  const engine = createEngine({ state: initialEngineState(setup.world), systems: SYSTEMS });
  for (const [key, value] of Object.entries({ ...QUIET, ...overrides })) {
    done(engine.command('tunables.setOverride', { key, value }, PLAYER));
  }
  const events: AnyDomainEvent[] = [];
  engine.onEvent((event) => {
    events.push(event);
  });
  return { engine, events, setup };
}

function done<T>(result: { ok: true; data: T } | { ok: false; reasons: unknown }): T {
  if (!result.ok) {
    throw new Error(`refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

function today(engine: Engine): GameDate {
  return engine.exportState().world.meta.currentDate;
}

function negotiationOf(engine: Engine, id: NegotiationId): Negotiation {
  const row = engine.exportState().world.tables.negotiations.find((entry) => entry.id === id);
  if (row === undefined) {
    throw new Error(`missing negotiation ${id}`);
  }
  return row;
}

function employmentOf(engine: Engine, id: EmploymentId): Employment {
  const row = engine.exportState().world.tables.employments.find((entry) => entry.id === id);
  if (row === undefined) {
    throw new Error(`missing employment ${id}`);
  }
  return row;
}

function cashOf(engine: Engine, promotionId: PromotionId): number {
  const row = engine
    .exportState()
    .world.tables.promotions.find((promotion) => promotion.id === promotionId);
  return row?.cash ?? Number.NaN;
}

function askOf(
  engine: Engine,
  promotionId: PromotionId,
  personId: PersonId,
  view = PLAYER_VIEW,
): AskingTermsView {
  return done(
    engine.query(
      'contracts.askingTerms',
      { promotionId, personId, kind: 'written', exclusive: true },
      view,
    ),
  );
}

/** Their ask as an offer, with the wage (and bonus) scaled by `share`. */
function offerAt(ask: AskingTermsView, share: number, overrides: DeepPartial<Offer> = {}): Offer {
  const terms = askTermsOf(ask);
  const push = ask.expectedPush.value === 'none' ? 'midCard' : ask.expectedPush.value;
  return anOffer({
    lengthMonths: ask.preferredLengthMonths.value,
    push,
    ...overrides,
    terms: {
      ...terms,
      monthlyWage: cents(Math.round((terms.monthlyWage * share) / 100) * 100),
      signingBonus: cents(Math.round((terms.signingBonus * share) / 100) * 100),
      ...overrides.terms,
    },
  });
}

function makeOffer(
  engine: Engine,
  promotionId: PromotionId,
  personId: PersonId,
  offer: Offer,
  issuedBy: Controller = PLAYER,
): NegotiationId {
  return done(engine.command('contracts.makeOffer', { promotionId, personId, offer }, issuedBy))
    .negotiationId;
}

async function advance(engine: Engine, days: number): Promise<number> {
  return (await engine.advanceDays({ maxDays: days })).daysAdvanced;
}

function eventsOf(events: readonly AnyDomainEvent[], type: string): AnyDomainEvent[] {
  return events.filter((event) => event.type === type);
}

function integrityIssues(engine: Engine) {
  const world = documentToWorld({ state: { world: engine.exportState().world } }, TABLES);
  return checkWorld(world, TABLES, { validateRows: true }).issues;
}

describe('reactions', () => {
  it('signs an offer at their ask on the review day, paying the bonus and starting the contract', async () => {
    const { engine, events, setup } = reviewEngine(negotiationWorld());
    const ask = askOf(engine, setup.human, setup.veteran);
    const bonus = 2_500_000;
    const offer = offerAt(ask, 1, { terms: { signingBonus: cents(bonus) } });
    const id = makeOffer(engine, setup.human, setup.veteran, offer);
    const start = today(engine);

    expect(await advance(engine, 1)).toBe(1);
    const waiting = negotiationOf(engine, id);
    expect(waiting).toMatchObject({
      status: 'awaitingReview',
      reviewOn: addDays(start, 2),
      reactionTraceId: `${id}:1`,
    });
    expect(waiting.history[0]?.reaction).toBe('accept');

    await advance(engine, 1);
    const cashBefore = cashOf(engine, setup.human);
    await advance(engine, 1);
    const signed = negotiationOf(engine, id);
    expect(signed).toMatchObject({ status: 'signed', closedOn: addDays(start, 2) });
    expect(signed.outcome?.code).toBe('signed');
    const employment = employmentOf(engine, signed.employmentId);
    expect(employment.status).toBe('active');
    expect(employment.startsOn).toBe(addDays(start, 2));
    expect(employment.endsOn).toBe(addMonths(addDays(start, 2), offer.lengthMonths));

    const reviewDay = engine
      .exportState()
      .world.tables.ledgerEntries.filter(
        (row) => row.promotionId === setup.human && row.date === addDays(start, 2),
      );
    expect(
      reviewDay.filter((row) => row.category === 'signingBonuses').map((row) => row.amount),
    ).toEqual([-bonus]);
    // Cash moved by exactly the day's ledger rows, the bonus among them.
    const dayTotal = reviewDay.reduce((sum, row) => sum + row.amount, 0);
    expect(cashOf(engine, setup.human)).toBe(cashBefore + dayTotal);
    expect(eventsOf(events, 'contract.signed').map((event) => event.payload)).toEqual([
      {
        employmentId: signed.employmentId,
        personId: setup.veteran,
        promotionId: setup.human,
        brandId: null,
        renewal: false,
        negotiationId: id,
      },
    ]);
    expect(eventsOf(events, 'contract.started')).toHaveLength(1);
    expect(integrityIssues(engine)).toEqual([]);
  });

  it('counters an offer at 60% with terms between the offer and the ask', async () => {
    const { engine, events, setup } = reviewEngine(negotiationWorld());
    const ask = askOf(engine, setup.human, setup.veteran);
    const offer = offerAt(ask, 0.6);
    const id = makeOffer(engine, setup.human, setup.veteran, offer);
    const start = today(engine);
    await advance(engine, 1);
    const row = negotiationOf(engine, id);
    expect(row.status).toBe('countered');
    expect(row.counterExpiresOn).toBe(addDays(start, 7));
    expect(row.patience).toBe(row.startPatience - 1);
    expect(row.counterStopsSkip).toBe(false);
    const wage = row.lastCounter?.terms.monthlyWage ?? 0;
    expect(wage).toBeGreaterThan(offer.terms.monthlyWage);
    expect(wage).toBeLessThanOrEqual(ask.monthlyWage.value);
    expect(row.history.map((entry) => [entry.by, entry.reaction])).toEqual([
      ['promotion', 'counter'],
      ['worker', null],
    ]);
    expect(eventsOf(events, 'negotiation.countered')).toHaveLength(1);
  });

  it('signs their counter-offer once accepted, on the review day', async () => {
    const { engine, setup } = reviewEngine(negotiationWorld());
    const ask = askOf(engine, setup.human, setup.veteran);
    const id = makeOffer(engine, setup.human, setup.veteran, offerAt(ask, 0.6));
    await advance(engine, 1);
    const counter = negotiationOf(engine, id).lastCounter;
    done(
      engine.command(
        'contracts.respondToCounter',
        { negotiationId: id, response: 'accept' },
        PLAYER,
      ),
    );
    expect(negotiationOf(engine, id).status).toBe('awaitingReview');
    // Accepted on the day after the offer: they decide two days later.
    await advance(engine, 2);
    expect(negotiationOf(engine, id).status).toBe('awaitingReview');
    await advance(engine, 1);
    const row = negotiationOf(engine, id);
    expect(row.status).toBe('signed');
    expect(employmentOf(engine, row.employmentId).terms.monthlyWage).toBe(
      counter?.terms.monthlyWage,
    );
    // The review shows the agreed offer as their own counter-offer.
    const why = done(engine.query('trace.get', { ref: reviewTraceRef(id) }, PLAYER_VIEW));
    expect(JSON.stringify(why)).toContain('Matches their counter-offer');
  });

  it('answers a rejected offer with their full ask', async () => {
    const { engine, setup } = reviewEngine(negotiationWorld());
    const ask = askOf(engine, setup.human, setup.veteran);
    const id = makeOffer(engine, setup.human, setup.veteran, offerAt(ask, 0.5));
    await advance(engine, 1);
    const row = negotiationOf(engine, id);
    expect(row.status).toBe('countered');
    expect(row.history[0]?.reaction).toBe('reject');
    expect(row.lastCounter?.terms.monthlyWage).toBe(ask.monthlyWage.value);
    const counterWhy = done(
      engine.query('trace.get', { ref: { kind: 'contracts.counter', id: `${id}:1` } }, PLAYER_VIEW),
    );
    expect(JSON.stringify(counterWhy)).toContain(FULL_ASK_COUNTER_REASON);
  });

  it('walks away from a 40% offer: talks close and offers are refused until the cooldown ends', async () => {
    const { engine, events, setup } = reviewEngine(negotiationWorld());
    const ask = askOf(engine, setup.human, setup.veteran);
    const id = makeOffer(engine, setup.human, setup.veteran, offerAt(ask, 0.4));
    const start = today(engine);
    await advance(engine, 1);
    const row = negotiationOf(engine, id);
    expect(row).toMatchObject({
      status: 'walkedAway',
      closedOn: start,
      cooldownUntil: addDays(start, 30),
    });
    expect(employmentOf(engine, row.employmentId).status).toBe('declined');
    expect(
      eventsOf(events, 'negotiation.walkedAway').filter(
        (event) => (event.payload as { negotiationId: string }).negotiationId === id,
      ),
    ).toHaveLength(1);

    await advance(engine, 28);
    expect(today(engine)).toBe(addDays(start, 29));
    const refused = engine.command(
      'contracts.makeOffer',
      { promotionId: setup.human, personId: setup.veteran, offer: offerAt(ask, 1) },
      PLAYER,
    );
    expect(refused.ok ? [] : refused.reasons.map((reason) => reason.code)).toContain(COOLDOWN_CODE);
    await advance(engine, 1);
    expect(
      engine.command(
        'contracts.makeOffer',
        { promotionId: setup.human, personId: setup.veteran, offer: offerAt(ask, 1) },
        PLAYER,
      ).ok,
    ).toBe(true);
  });

  it('walks away once patience runs out after repeated low revisions (one point a round)', async () => {
    const { engine, setup } = reviewEngine(negotiationWorld());
    const ask = askOf(engine, setup.human, setup.veteran);
    const low = offerAt(ask, 0.6);
    const id = makeOffer(engine, setup.human, setup.veteran, low);
    const startPatience = negotiationOf(engine, id).startPatience;
    let counters = 0;
    for (let day = 0; day < 20; day += 1) {
      await advance(engine, 1);
      const row = negotiationOf(engine, id);
      if (row.status !== 'countered') {
        break;
      }
      counters += 1;
      done(
        engine.command(
          'contracts.respondToCounter',
          { negotiationId: id, response: 'revise', offer: low },
          PLAYER,
        ),
      );
    }
    expect(negotiationOf(engine, id).status).toBe('walkedAway');
    expect(counters).toBe(startPatience);
  });

  it('lets an unanswered counter-offer lapse after seven days', async () => {
    const { engine, events, setup } = reviewEngine(negotiationWorld());
    const ask = askOf(engine, setup.human, setup.veteran);
    const id = makeOffer(engine, setup.human, setup.veteran, offerAt(ask, 0.6));
    const start = today(engine);
    await advance(engine, 8);
    expect(negotiationOf(engine, id).status).toBe('countered');
    await advance(engine, 1);
    const row = negotiationOf(engine, id);
    expect(row).toMatchObject({
      status: 'lapsed',
      closedOn: addDays(start, 8),
      cooldownUntil: null,
    });
    expect(employmentOf(engine, row.employmentId).status).toBe('withdrawn');
    const updates = done(
      engine.query(
        'contracts.offerUpdatesSince',
        { promotionId: setup.human, from: start, to: today(engine) },
        PLAYER_VIEW,
      ),
    );
    expect(updates.countered.map((line) => line.negotiationId)).toEqual([id]);
    expect(updates.lapsed.map((line) => line.outcomeMessage)).toEqual([
      'They stopped waiting for your answer',
    ]);
    expect(
      eventsOf(events, 'negotiation.closed')
        .map((event) => event.payload as { negotiationId: string; outcomeCode: string })
        .filter((payload) => payload.negotiationId === id)
        .map((payload) => payload.outcomeCode),
    ).toEqual(['lapsed']);
  });

  it("answers a computer promotion's counter-offer in the same phase", async () => {
    const { engine, setup } = reviewEngine(negotiationWorld());
    const ask = askOf(engine, setup.human, setup.veteran);
    const offer = offerAt(ask, 0.6);
    const id = makeOffer(engine, setup.rival, setup.veteran, offer, COMPUTER);
    await advance(engine, 1);
    const row = negotiationOf(engine, id);
    expect(row.status).toBe('awaitingReview');
    expect(row.round).toBe(2);
    expect(row.history.map((entry) => entry.by)).toEqual(['promotion', 'worker', 'promotion']);
  });
});

describe('reviews', () => {
  async function biddingWar(
    myShare: number,
    rivalShare: number,
    seed?: string,
  ): Promise<{
    engine: Engine;
    mine: NegotiationId;
    theirs: NegotiationId;
    setup: NegotiationWorld;
  }> {
    const setup = negotiationWorld({ rivalController: OTHER_PLAYER });
    if (seed !== undefined) {
      const reseeded = setup.world.transact('test seed', (tx) => {
        tx.setMeta({ seed });
      });
      if (!reseeded.ok) {
        throw reseeded.error;
      }
    }
    const { engine } = reviewEngine(setup);
    const myAsk = askOf(engine, setup.human, setup.veteran);
    const rivalAsk = askOf(engine, setup.rival, setup.veteran, OTHER_VIEW);
    const mine = makeOffer(engine, setup.human, setup.veteran, offerAt(myAsk, myShare));
    const theirs = makeOffer(
      engine,
      setup.rival,
      setup.veteran,
      offerAt(rivalAsk, rivalShare),
      OTHER_PLAYER,
    );
    await advance(engine, 3);
    return { engine, mine, theirs, setup };
  }

  it('signs the offer worth more of its own ask; the loser learns who won, not for how much', async () => {
    const { engine, mine, theirs, setup } = await biddingWar(1.1, 1);
    expect(negotiationOf(engine, mine).status).toBe('signed');
    const lost = negotiationOf(engine, theirs);
    expect(lost).toMatchObject({
      status: 'declined',
      outcome: { code: 'lostToOtherOffer', otherPromotionId: setup.human },
      reviewTraceId: `${theirs}:review`,
    });
    expect(employmentOf(engine, lost.employmentId).status).toBe('declined');

    const winnerWage = negotiationOf(engine, mine).offer.terms.monthlyWage;
    const [row] = done(
      engine.query('contracts.offers', { promotionId: setup.rival }, OTHER_VIEW),
    ).filter((entry) => entry.negotiationId === theirs);
    expect(row?.outcome?.message).toBe('Signed with My Wrestling instead');
    const seen = row?.reviewTrace ?? null;
    expect(seen).not.toBeNull();
    const text = JSON.stringify(seen);
    expect(text).toContain(ANOTHER_OFFER_NOTE);
    expect(text).toContain(RIVAL_NAME);
    expect(text).not.toContain(String(winnerWage));
    expect(text).not.toContain(mine);
    const fetched = done(engine.query('trace.get', { ref: reviewTraceRef(theirs) }, OTHER_VIEW));
    expect(fetched !== null && isFullTrace(fetched) ? fetched.trace : null).toEqual(seen);
    // Their talks are not yours: the winner's review is hidden from the loser.
    expect(done(engine.query('trace.get', { ref: reviewTraceRef(mine) }, OTHER_VIEW))).toBeNull();
    // The winner sees its own score in full; the other offer is only a note for them too.
    const winnerView = done(engine.query('trace.get', { ref: reviewTraceRef(mine) }, PLAYER_VIEW));
    const winnerTrace: TraceNode | null =
      winnerView !== null && isFullTrace(winnerView) ? winnerView.trace : null;
    expect(winnerTrace?.kind === 'decision' ? winnerTrace.considered : []).toHaveLength(1);
    // The test world does not list the second player in meta.players; nothing else may be wrong.
    expect(integrityIssues(engine).filter((issue) => issue.code !== 'ref.unknownPlayer')).toEqual(
      [],
    );
  });

  it('breaks an exact tie with a seeded roll, the same every time', async () => {
    const first = await biddingWar(1, 1, 'tie-seed');
    const second = await biddingWar(1, 1, 'tie-seed');
    const winner = (run: typeof first): string =>
      negotiationOf(run.engine, run.mine).status === 'signed' ? 'mine' : 'theirs';
    expect(winner(first)).toBe(winner(second));
    const why = done(
      first.engine.query('trace.get', { ref: reviewTraceRef(first.mine) }, PLAYER_VIEW),
    );
    expect(JSON.stringify(why)).toContain('Which of the tied offers');
    const winners = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      winners.add(winner(await biddingWar(1, 1, seed)));
    }
    expect([...winners].sort()).toEqual(['mine', 'theirs']);
  });

  it('cuts a per-appearance deal elsewhere short when the worker goes exclusive', async () => {
    const setup = negotiationWorld();
    const { engine } = reviewEngine(setup, { 'ai.contracts.simpleRenewals': false });
    const person = setup.person(setup.rivalFee);
    const ask = askOf(engine, setup.human, person);
    const startsOn = addDays(today(engine), 20);
    const id = makeOffer(engine, setup.human, person, offerAt(ask, 1, { startsOn }));
    await advance(engine, 3);
    const signed = negotiationOf(engine, id);
    expect(signed.status).toBe('signed');
    expect(employmentOf(engine, signed.employmentId)).toMatchObject({
      status: 'signed',
      startsOn,
    });
    expect(employmentOf(engine, setup.rivalFee).endsOn).toBe(startsOn);
    const why = done(engine.query('trace.get', { ref: reviewTraceRef(id) }, PLAYER_VIEW));
    expect(JSON.stringify(why)).toContain('Went exclusive with My Wrestling');
    await advance(engine, 18);
    expect(employmentOf(engine, setup.rivalFee).status).toBe('expired');
    expect(employmentOf(engine, signed.employmentId).status).toBe('active');
    expect(integrityIssues(engine)).toEqual([]);
  });

  it('renews a contract in place: a later end date, push through the door, morale untouched', async () => {
    const setup = negotiationWorld();
    const { engine, events } = reviewEngine(setup, { 'contracts.renewal.windowDays': 365 });
    const before = employmentOf(engine, setup.mine);
    const ask = done(
      engine.query(
        'contracts.askingTerms',
        {
          promotionId: setup.human,
          personId: before.personId,
          kind: 'written',
          exclusive: true,
          renewalOf: setup.mine,
        },
        PLAYER_VIEW,
      ),
    );
    const offer = offerAt(ask, 1.05, { push: 'mainEvent' });
    const id = done(
      engine.command('contracts.offerRenewal', { employmentId: setup.mine, offer }, PLAYER),
    ).negotiationId;
    await advance(engine, 3);
    expect(negotiationOf(engine, id).status).toBe('signed');
    const after = employmentOf(engine, setup.mine);
    expect(after.endsOn).toBe(addMonths(before.endsOn ?? today(engine), offer.lengthMonths));
    expect(after.push).toBe('mainEvent');
    expect(after.morale).toBe(before.morale);
    expect(after.terms.monthlyWage).toBe(offer.terms.monthlyWage);
    expect(eventsOf(events, 'employment.pushChanged')).toHaveLength(1);
    expect(eventsOf(events, 'employment.moraleChanged')).toHaveLength(0);
    const signedEvent = eventsOf(events, 'contract.signed')[0]?.payload;
    expect(signedEvent).toMatchObject({ renewal: true, employmentId: setup.mine });
    expect(eventsOf(events, 'contract.renewed')).toHaveLength(1);
  });

  it('closes renewal talks when the contract ends first', async () => {
    const setup = negotiationWorld();
    const { engine } = reviewEngine(setup, { 'contracts.renewal.windowDays': 365 });
    const before = employmentOf(engine, setup.mine);
    const ask = done(
      engine.query(
        'contracts.askingTerms',
        { promotionId: setup.human, personId: before.personId, renewalOf: setup.mine },
        PLAYER_VIEW,
      ),
    );
    const id = done(
      engine.command(
        'contracts.offerRenewal',
        { employmentId: setup.mine, offer: offerAt(ask, 0.6) },
        PLAYER,
      ),
    ).negotiationId;
    const preview = done(
      engine.query('contracts.releasePreview', { employmentId: setup.mine }, PLAYER_VIEW),
    );
    if (preview.kind !== 'ok') {
      throw new Error('expected a release preview');
    }
    done(
      engine.command(
        'contracts.release',
        { employmentId: setup.mine, expectedSeverance: preview.severance.value },
        PLAYER,
      ),
    );
    expect(negotiationOf(engine, id)).toMatchObject({
      status: 'declined',
      outcome: { code: 'contractEnded' },
    });
    expect(integrityIssues(engine)).toEqual([]);
  });
});

describe('the counter-offer stop', () => {
  it('stops a skip while a counter-offer waits, only when contracts.counter.stopSkip is on', async () => {
    for (const stopSkip of [true, false]) {
      const { engine, setup } = reviewEngine(negotiationWorld(), {
        'contracts.counter.stopSkip': stopSkip,
      });
      const ask = askOf(engine, setup.human, setup.veteran);
      const id = makeOffer(engine, setup.human, setup.veteran, offerAt(ask, 0.6));
      const result = await engine.advanceDays({ maxDays: 5 });
      if (stopSkip) {
        expect(result.daysAdvanced).toBe(1);
        expect(result.stoppedBy).toEqual({
          kind: 'gate',
          hits: [
            {
              gateId: COUNTER_WAITING_GATE_ID,
              reason: `Counter-offer from ${employmentOf(engine, negotiationOf(engine, id).employmentId).ringName} is waiting for your answer`,
              subject: { kind: 'person', id: setup.veteran },
              actionHint: 'contracts',
            },
          ],
        });
        // Answering clears it.
        done(
          engine.command(
            'contracts.respondToCounter',
            { negotiationId: id, response: 'end' },
            PLAYER,
          ),
        );
        expect((await engine.advanceDays({ maxDays: 2 })).daysAdvanced).toBe(2);
      } else {
        expect(result.daysAdvanced).toBe(5);
      }
    }
  });

  it('never stops for a computer promotion', async () => {
    const { engine, setup } = reviewEngine(negotiationWorld(), {
      'contracts.counter.stopSkip': true,
    });
    const ask = askOf(engine, setup.human, setup.veteran);
    makeOffer(engine, setup.rival, setup.veteran, offerAt(ask, 0.6), COMPUTER);
    expect((await engine.advanceDays({ maxDays: 5 })).daysAdvanced).toBe(5);
  });
});
