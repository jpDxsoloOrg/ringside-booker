// The "Offer answered" stop (ECO5-10). Design: docs/design/negotiation.md#offer-answered-stop
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { Controller } from '../../../src/core/api/controller';
import { addDays, type GameDate } from '../../../src/core/date';
import { isId } from '../../../src/core/ids';
import type { NegotiationId, PersonId, PromotionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import type { Negotiation } from '../../../src/model/entities/negotiation';
import { contractsSystem } from '../../../src/systems/contracts';
import { financeSystem } from '../../../src/systems/finance';
import {
  askTermsOf,
  COUNTER_WAITING_GATE_ID,
  negotiationSystem,
  OFFER_ANSWERED_ACTION_HINT,
  OFFER_ANSWERED_GATE_ID,
  type AskingTermsView,
  type Offer,
} from '../../../src/systems/negotiation';
import { workersSystem } from '../../../src/systems/workers';
import { anOffer } from '../../support';
import {
  negotiationWorld,
  OTHER_PLAYER,
  PLAYER,
  PLAYER_VIEW,
  type NegotiationWorld,
} from './negotiation-world';

const COMPUTER: Controller = { kind: 'computer' };
const SYSTEMS = [simSystem, financeSystem, workersSystem, contractsSystem, negotiationSystem];
/** Stops this file does not test. */
const QUIET = {
  'contracts.expiringSoon.stopSkip': false,
  'contracts.releaseRequest.stopSkip': false,
} as const;

function done<T>(result: { ok: true; data: T } | { ok: false; reasons: unknown }): T {
  if (!result.ok) {
    throw new Error(`refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

function engineFor(
  setup: NegotiationWorld,
  overrides: Record<string, number | boolean> = {},
): Engine {
  const engine = createEngine({ state: initialEngineState(setup.world), systems: SYSTEMS });
  for (const [key, value] of Object.entries({ ...QUIET, ...overrides })) {
    done(engine.command('tunables.setOverride', { key, value }, PLAYER));
  }
  return engine;
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

function askOf(engine: Engine, promotionId: PromotionId, personId: PersonId): AskingTermsView {
  return done(
    engine.query(
      'contracts.askingTerms',
      { promotionId, personId, kind: 'written', exclusive: true },
      PLAYER_VIEW,
    ),
  );
}

/** Their ask as an offer, with the wage (and bonus) scaled by `share`. */
function offerAt(ask: AskingTermsView, share: number): Offer {
  const terms = askTermsOf(ask);
  return anOffer({
    lengthMonths: ask.preferredLengthMonths.value,
    push: ask.expectedPush.value === 'none' ? 'midCard' : ask.expectedPush.value,
    terms: {
      ...terms,
      monthlyWage: cents(Math.round((terms.monthlyWage * share) / 100) * 100),
      signingBonus: cents(Math.round((terms.signingBonus * share) / 100) * 100),
    },
  });
}

function offerTo(
  engine: Engine,
  promotionId: PromotionId,
  personId: PersonId,
  share: number,
  issuedBy: Controller = PLAYER,
  askFrom: PromotionId = promotionId,
): NegotiationId {
  // The player's view reads only their own promotion's asks: a rival's offer is priced from it.
  const offer = offerAt(askOf(engine, askFrom, personId), share);
  return done(engine.command('contracts.makeOffer', { promotionId, personId, offer }, issuedBy))
    .negotiationId;
}

function pendingGates(engine: Engine) {
  return done(engine.query('sim.pendingGates', {}, PLAYER_VIEW)).hits;
}

describe('the Offer answered stop', () => {
  it('stops a skip when a worker walks away, says why, and clears when the talks are opened', async () => {
    const setup = negotiationWorld();
    const engine = engineFor(setup);
    const id = offerTo(engine, setup.human, setup.veteran, 0.4);
    const result = await engine.advanceDays({ maxDays: 5 });
    expect(result.daysAdvanced).toBe(1);
    expect(negotiationOf(engine, id)).toMatchObject({
      status: 'walkedAway',
      answerStopsSkip: true,
    });
    expect(result.stoppedBy).toMatchObject({
      kind: 'gate',
      hits: [
        {
          gateId: OFFER_ANSWERED_GATE_ID,
          actionHint: OFFER_ANSWERED_ACTION_HINT,
          subject: { kind: 'negotiation', id },
        },
      ],
    });
    const [hit] = pendingGates(engine);
    expect(hit?.reason).toMatch(/ walked away from your offer$/);
    // The Next Day summary says the same.
    const updates = done(
      engine.query(
        'contracts.offerUpdatesSince',
        { promotionId: setup.human, from: setup.today, to: today(engine) },
        PLAYER_VIEW,
      ),
    );
    expect(updates.walkedAway.map((update) => update.line)).toEqual([hit?.reason]);
    // The Offers list tells the screen there is an answer to mark as seen.
    const rows = done(engine.query('contracts.offers', { promotionId: setup.human }, PLAYER_VIEW));
    expect(rows.find((row) => row.negotiationId === id)?.answerUnseen).toBe(true);

    // Another player cannot clear it; the player can, and a skip then runs.
    expect(
      done(engine.command('contracts.markOffersSeen', { negotiationIds: [id] }, OTHER_PLAYER)),
    ).toEqual({ cleared: 0 });
    expect(
      done(engine.command('contracts.markOffersSeen', { negotiationIds: [id] }, PLAYER)),
    ).toEqual({ cleared: 1 });
    expect(pendingGates(engine)).toEqual([]);
    expect((await engine.advanceDays({ maxDays: 2 })).daysAdvanced).toBe(2);
  });

  it('names a signing without the money', async () => {
    const setup = negotiationWorld();
    const engine = engineFor(setup);
    const bonus = 2_500_000;
    const ask = askOf(engine, setup.human, setup.veteran);
    const offer = {
      ...offerAt(ask, 1),
      terms: { ...offerAt(ask, 1).terms, signingBonus: cents(bonus) },
    };
    const id = done(
      engine.command(
        'contracts.makeOffer',
        { promotionId: setup.human, personId: setup.veteran, offer },
        PLAYER,
      ),
    ).negotiationId;
    // Accepted on day 1, signed on the review day two days later.
    const result = await engine.advanceDays({ maxDays: 10 });
    expect(result.daysAdvanced).toBe(3);
    expect(negotiationOf(engine, id).status).toBe('signed');
    const [hit] = pendingGates(engine);
    expect(hit?.gateId).toBe(OFFER_ANSWERED_GATE_ID);
    expect(hit?.reason).toMatch(/ signed with you$/);
    expect(hit?.reason).not.toContain('$');
  });

  it('never stops for a counter-offer the player accepted', async () => {
    const setup = negotiationWorld();
    const engine = engineFor(setup);
    // A low offer is countered (its own stop), and accepting the counter signs at once.
    const mine = offerTo(engine, setup.human, setup.veteran, 0.6);
    const first = await engine.advanceDays({ maxDays: 3 });
    expect(first.stoppedBy).toMatchObject({
      kind: 'gate',
      hits: [{ gateId: COUNTER_WAITING_GATE_ID }],
    });
    done(
      engine.command(
        'contracts.respondToCounter',
        { negotiationId: mine, response: 'accept' },
        PLAYER,
      ),
    );
    expect(negotiationOf(engine, mine)).toMatchObject({
      status: 'signed',
      answerStopsSkip: false,
    });
  });

  it('never stops for a computer promotion', async () => {
    const setup = negotiationWorld();
    const engine = engineFor(setup);
    // The rival's walk-away answers a computer: nothing stops.
    const theirs = offerTo(engine, setup.rival, setup.veteran, 0.4, COMPUTER, setup.human);
    const result = await engine.advanceDays({ maxDays: 3 });
    expect(result).toMatchObject({ daysAdvanced: 3, stoppedBy: { kind: 'completed' } });
    expect(negotiationOf(engine, theirs).answerStopsSkip).toBe(false);
  });

  it('puts a signing on the news without the money, and keeps a walk-away private', async () => {
    const setup = negotiationWorld();
    const engine = engineFor(setup);
    const walked = offerTo(engine, setup.human, setup.person(setup.rivalEnding), 0.4);
    const mine = offerTo(engine, setup.human, setup.veteran, 0.6);
    await engine.advanceDays({ maxDays: 1 });
    expect(negotiationOf(engine, walked).status).toBe('walkedAway');
    done(
      engine.command(
        'contracts.respondToCounter',
        { negotiationId: mine, response: 'accept' },
        PLAYER,
      ),
    );
    const news = engine.exportState().world.tables.news;
    const aboutVeteran = news.filter((story) => story.refs.personIds.includes(setup.veteran));
    // The deal starts today, so the signing is public: a story that names who and where only.
    expect(aboutVeteran.map((story) => story.kind)).toEqual(['signing']);
    expect(JSON.stringify(aboutVeteran)).not.toMatch(/monthlyWage|signingBonus|\$/);
    const walker = setup.person(setup.rivalEnding);
    expect(news.filter((story) => story.refs.personIds.includes(walker))).toEqual([]);
  });

  it('stays off with contracts.answer.stopSkip off', async () => {
    const setup = negotiationWorld();
    const engine = engineFor(setup, { 'contracts.answer.stopSkip': false });
    const id = offerTo(engine, setup.human, setup.veteran, 0.4);
    const result = await engine.advanceDays({ maxDays: 3 });
    expect(result).toMatchObject({ daysAdvanced: 3, stoppedBy: { kind: 'completed' } });
    expect(negotiationOf(engine, id)).toMatchObject({
      status: 'walkedAway',
      answerStopsSkip: false,
    });
  });

  it('always finishes a skip through several answers, clearing each stop where it sends the player', async () => {
    const setup = negotiationWorld();
    const engine = engineFor(setup);
    const workers = [setup.veteran, setup.person(setup.rivalEnding), setup.person(setup.rivalFee)];
    // One walks away, the others are offered their ask: answers on different days.
    const ids = [
      offerTo(engine, setup.human, workers[0] ?? setup.veteran, 0.4),
      ...workers.slice(1).map((personId) => offerTo(engine, setup.human, personId, 1)),
    ];
    const skipDays = 20;
    const start = today(engine);
    let daysLeft = skipDays;
    let answered = 0;
    let runs = 0;
    while (daysLeft > 0) {
      runs += 1;
      expect(runs).toBeLessThan(skipDays + ids.length + 2);
      const result = await engine.advanceDays({ maxDays: daysLeft });
      daysLeft -= result.daysAdvanced;
      if (result.stoppedBy.kind !== 'gate') {
        expect(result.stoppedBy).toEqual({ kind: 'completed' });
        continue;
      }
      // Answers on the same day stop one after another: the player opens each in turn.
      for (let hits = pendingGates(engine); hits.length > 0; hits = pendingGates(engine)) {
        const [hit] = hits;
        const negotiationId = hit?.subject?.kind === 'negotiation' ? hit.subject.id : null;
        if (hit === undefined || !isId('negotiation', negotiationId)) {
          throw new Error(`unexpected stop: ${JSON.stringify(hits)}`);
        }
        if (hit.gateId === OFFER_ANSWERED_GATE_ID) {
          answered += 1;
          // What the Offers tab sends when the talks open.
          expect(
            done(
              engine.command(
                'contracts.markOffersSeen',
                { negotiationIds: [negotiationId] },
                PLAYER,
              ),
            ),
          ).toEqual({ cleared: 1 });
        } else {
          expect(hit.gateId).toBe(COUNTER_WAITING_GATE_ID);
          done(
            engine.command(
              'contracts.respondToCounter',
              { negotiationId, response: 'end' },
              PLAYER,
            ),
          );
        }
      }
      expect(pendingGates(engine)).toEqual([]);
    }
    expect(today(engine)).toBe(addDays(start, skipDays));
    // Every offer was answered by the worker, and each answer stopped the skip once.
    const statuses = ids.map((id) => negotiationOf(engine, id));
    expect(statuses.every((row) => row.closedOn !== null)).toBe(true);
    expect(statuses.every((row) => !row.answerStopsSkip)).toBe(true);
    expect(answered).toBeGreaterThanOrEqual(2);
  });
});
