// The offer commands (ECO5-04). Design: docs/design/negotiation.md#rounds and #commands
import { describe, expect, it } from 'vitest';
import { createEngine, type Engine, type EngineState } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { Controller } from '../../../src/core/api/controller';
import type { Reason } from '../../../src/core/api/result';
import { addDays, addMonths, type GameDate } from '../../../src/core/date';
import type { EmploymentId, NegotiationId, PersonId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import type { Employment } from '../../../src/model/entities/employment';
import type { Negotiation, NegotiationRound } from '../../../src/model/entities/negotiation';
import { contractsSystem } from '../../../src/systems/contracts';
import { financeSystem } from '../../../src/systems/finance';
import {
  askTraceRef,
  cappedHistory,
  negotiationSystem,
  validateOffer,
  type Offer,
} from '../../../src/systems/negotiation';
import { createEngineTunables } from '../../../src/systems/tunables';
import { workersSystem } from '../../../src/systems/workers';
import { initialEngineState } from '../../../src/core/api';
import { anOffer, TEST_START_DATE, testId, type DeepPartial } from '../../support';
import {
  ask,
  negotiationEngine,
  negotiationWorld,
  OTHER_PLAYER,
  OTHER_VIEW,
  PLAYER,
  PLAYER_VIEW,
  RIVAL_NAME,
  setMorale,
  type NegotiationWorld,
} from './negotiation-world';

const COMPUTER: Controller = { kind: 'computer' };
const SYSTEMS = [simSystem, financeSystem, workersSystem, contractsSystem, negotiationSystem];

function offer(overrides: DeepPartial<Offer> = {}): Offer {
  return anOffer({ terms: { monthlyWage: cents(900_000) }, ...overrides });
}

function codes(result: { ok: boolean; reasons?: readonly Reason[] }): string[] {
  return result.ok ? [] : (result.reasons ?? []).map((reason) => reason.code);
}

function refusal(result: { ok: true } | { ok: false; reasons: readonly Reason[] }): Reason {
  if (result.ok) {
    throw new Error('expected a refusal');
  }
  const [first] = result.reasons;
  if (first === undefined) {
    throw new Error('refused without a reason');
  }
  return first;
}

function done<T>(result: { ok: true; data: T } | { ok: false; reasons: unknown }): T {
  if (!result.ok) {
    throw new Error(`command refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
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

function setOverride(engine: Engine, key: string, value: number | boolean): void {
  done(engine.command('tunables.setOverride', { key, value }, PLAYER));
}

function makeOffer(
  engine: Engine,
  setup: NegotiationWorld,
  personId: PersonId,
  terms: DeepPartial<Offer> = {},
  issuedBy: Controller = PLAYER,
) {
  return engine.command(
    'contracts.makeOffer',
    { promotionId: setup.human, personId, offer: offer(terms) },
    issuedBy,
  );
}

/**
 * The worker's counter-offer, written the way the day's reaction (ECO5-05) will: the state is
 * edited and a new engine loads it.
 */
function withCounter(
  engine: Engine,
  negotiationId: NegotiationId,
  counter: Offer,
  patience: number,
  today: GameDate,
): Engine {
  const state: EngineState = engine.exportState();
  const rows = state.world.tables.negotiations;
  const index = rows.findIndex((row) => row.id === negotiationId);
  const row = rows[index];
  if (row === undefined) {
    throw new Error('missing negotiation');
  }
  rows[index] = {
    ...row,
    status: 'countered',
    patience,
    lastCounter: counter,
    counterExpiresOn: addDays(today, 7),
    history: [
      ...row.history,
      { round: row.round, date: today, by: 'worker', offer: counter, reaction: null },
    ],
  };
  return createEngine({ state, systems: SYSTEMS });
}

describe('contracts.makeOffer', () => {
  it('opens talks: one offered employment, one submitted negotiation and the ask trace', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const before = ask(
      engine.query(
        'contracts.offerPreview',
        { promotionId: setup.human, personId: setup.veteran, offer: offer() },
        PLAYER_VIEW,
      ),
    );

    const made = done(makeOffer(engine, setup, setup.veteran));

    const negotiation = negotiationOf(engine, made.negotiationId);
    expect(negotiation).toMatchObject({
      kind: 'signing',
      personId: setup.veteran,
      promotionId: setup.human,
      status: 'submitted',
      round: 1,
      patience: before.startPatience,
      startPatience: before.startPatience,
      openedOn: setup.today,
      closedOn: null,
    });
    expect(negotiation.history).toEqual([
      { round: 1, date: setup.today, by: 'promotion', offer: offer(), reaction: null },
    ]);
    const employment = employmentOf(engine, negotiation.employmentId);
    expect(employment).toMatchObject({
      personId: setup.veteran,
      promotionId: setup.human,
      status: 'offered',
      offeredOn: setup.today,
      startsOn: setup.today,
      endsOn: addMonths(setup.today, 12),
      role: 'wrestler',
      push: 'midCard',
      brandId: null,
      gimmickKey: null,
      alignment: 'face',
      morale: 0,
      momentum: null,
      endedOn: null,
      leave: null,
    });
    expect(employment.terms).toEqual(offer().terms);
    const offered = engine
      .exportState()
      .world.tables.employments.filter(
        (row) => row.personId === setup.veteran && row.status === 'offered',
      );
    expect(offered).toHaveLength(1);
    expect(
      ask(engine.query('trace.get', { ref: askTraceRef(made.negotiationId, 1) }, PLAYER_VIEW)),
    ).not.toBeNull();
    // The preview the command returns is contracts.offerPreview's, to the cent.
    expect(made.preview).toEqual({
      offerValue: before.offerValue,
      askValue: before.askValue,
      ratio: before.ratio,
      reaction: before.reaction,
      band: before.band,
      label: before.label,
      patienceLeft: before.patienceLeft,
    });
    // And the preview inside the talks now says the same.
    const inside = ask(
      engine.query(
        'contracts.offerPreview',
        {
          promotionId: setup.human,
          personId: setup.veteran,
          offer: offer(),
          negotiationId: made.negotiationId,
        },
        PLAYER_VIEW,
      ),
    );
    expect(inside.offerValue).toBe(made.preview.offerValue);
    expect(inside.reaction).toBe(made.preview.reaction);
    expect(inside.patienceLeft).toBe(made.preview.patienceLeft);
  });

  it('starts no earlier than their deal elsewhere allows', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const personId = setup.person(setup.rivalEnding);
    const made = done(makeOffer(engine, setup, personId));
    const employment = employmentOf(engine, negotiationOf(engine, made.negotiationId).employmentId);
    expect(employment.startsOn).toBe(addDays(setup.today, 20));
    expect(employment.endsOn).toBe(addMonths(addDays(setup.today, 20), 12));
  });

  it('refuses an offer from someone who does not run the promotion, and logs it as rejected', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const worldBefore = JSON.stringify(engine.exportState().world);

    for (const issuer of [OTHER_PLAYER, COMPUTER]) {
      const result = makeOffer(engine, setup, setup.veteran, {}, issuer);
      expect(codes(result)).toEqual(['contracts.notYourPromotion']);
    }
    // The player cannot act for the computer's promotion either.
    const forRival = engine.command(
      'contracts.makeOffer',
      { promotionId: setup.rival, personId: setup.veteran, offer: offer() },
      PLAYER,
    );
    expect(codes(forRival)).toEqual(['contracts.notYourPromotion']);

    expect(JSON.stringify(engine.exportState().world)).toBe(worldBefore);
    const log = engine.exportState().commandLog.entries;
    expect(log.at(-1)).toMatchObject({
      name: 'contracts.makeOffer',
      outcome: 'rejected',
      reasonCodes: ['contracts.notYourPromotion'],
    });
  });

  it('lets the computer make an offer for its own promotion through the same command', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const made = done(
      engine.command(
        'contracts.makeOffer',
        { promotionId: setup.rival, personId: setup.veteran, offer: offer() },
        COMPUTER,
      ),
    );
    expect(negotiationOf(engine, made.negotiationId).promotionId).toBe(setup.rival);
    // A rival's ask is kept as a summary only.
    const trace = ask(
      engine.query('trace.get', { ref: askTraceRef(made.negotiationId, 1) }, PLAYER_VIEW),
    );
    expect(trace?.summaryOnly).toBe(true);
  });

  it('refuses workers who will not talk: retired, or under an exclusive deal elsewhere', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const retired = refusal(makeOffer(engine, setup, setup.retired));
    expect(retired.code).toBe('contracts.unavailable');
    expect(retired.message).toBe('Retired');
    const locked = refusal(makeOffer(engine, setup, setup.person(setup.rivalLocked)));
    expect(locked.code).toBe('contracts.unavailable');
    expect(locked.message).toContain(`Under an exclusive contract with ${RIVAL_NAME}`);
    const mine = refusal(makeOffer(engine, setup, setup.person(setup.mine)));
    expect(mine.code).toBe('contracts.unavailable');
    expect(mine.message).toBe('Already under contract with you: offer a renewal instead');
  });

  it('refuses while they are cooling off after walking away', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const reason = refusal(makeOffer(engine, setup, setup.free));
    expect(reason.code).toBe('contracts.cooldown');
    expect(reason.message).toMatch(/^Walked away from talks: try again after /);
  });

  it('refuses a second offer while talks are open (one offer per reply)', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const made = done(makeOffer(engine, setup, setup.veteran));
    const reason = refusal(makeOffer(engine, setup, setup.veteran, { lengthMonths: 24 }));
    expect(reason.code).toBe('contracts.alreadyNegotiating');
    expect(reason.subject).toEqual({ kind: 'negotiation', id: made.negotiationId });
  });

  it('refuses a written deal below the reach it needs', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    setOverride(engine, 'contracts.kind.writtenMinReach', 100);
    const reason = refusal(makeOffer(engine, setup, setup.veteran));
    expect(reason.code).toBe('contracts.kindNotAllowed');
    expect(reason.message).toMatch(/^Written contracts need a reach of 100; yours is \d+$/);
  });

  it('refuses an exclusive deal below the reach it needs', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    setOverride(engine, 'contracts.kind.exclusiveMinReach', 100);
    const result = makeOffer(engine, setup, setup.veteran);
    expect(codes(result)).toEqual(['contracts.exclusiveNotAllowed']);
    done(makeOffer(engine, setup, setup.veteran, { terms: { exclusive: false } }));
  });

  it('refuses bad terms, naming the field', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    setOverride(engine, 'contracts.offer.maxLengthMonths', 24);
    const cases: [DeepPartial<Offer>, string][] = [
      [
        { terms: { kind: 'perAppearance', exclusive: false, perAppearanceFee: cents(50_000) } },
        'offer.terms.monthlyWage',
      ],
      [{ lengthMonths: 36 }, 'offer.lengthMonths'],
      [{ startsOn: addDays(setup.today, -1) }, 'offer.startsOn'],
      [{ terms: { shares: { broadcastBp: 500 } } }, 'offer.terms.shares.broadcastBp'],
    ];
    for (const [terms, field] of cases) {
      const reason = refusal(makeOffer(engine, setup, setup.veteran, terms));
      expect(reason).toMatchObject({ code: 'contracts.badTerms', field });
    }
    // Negative money and a zero cap never pass the arguments, and the shared rule says why too.
    const tunables = createEngineTunables({});
    const base = offer();
    const bad: Offer = {
      ...base,
      terms: { ...base.terms, signingBonus: cents(-1), appearanceCap: 0 },
    };
    const reasons = validateOffer(
      setup.world,
      tunables,
      { promotionId: setup.human, personId: setup.veteran, offer: bad },
      PLAYER,
    );
    expect(reasons.map((reason) => reason.field)).toEqual([
      'offer.terms.signingBonus',
      'offer.terms.appearanceCap',
    ]);
  });

  it('refuses a brand that is not the promotion’s', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const reason = refusal(
      makeOffer(engine, setup, setup.veteran, {
        brand: { kind: 'brand', brandId: testId('brand', 99) },
      }),
    );
    expect(reason).toMatchObject({ code: 'contracts.badBrand', field: 'offer.brand.brandId' });
  });

  it('refuses a role the worker has never held, and a wrestler offered a crew job', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    setOverride(engine, 'contracts.react.refuseCrewRoleRating', 0);
    const crew = refusal(
      makeOffer(engine, setup, setup.veteran, { role: 'referee', push: 'none' }),
    );
    expect(crew).toMatchObject({ code: 'contracts.refusesRole', message: 'Wants to wrestle' });

    const other = negotiationWorld();
    const edited = other.world.transact('announcer only', (tx) => {
      tx.update('people', other.veteran, { roles: ['occasionalWrestler', 'announcer'] });
    });
    expect(edited.ok).toBe(true);
    const announcerEngine = negotiationEngine(other.world);
    const role = refusal(
      makeOffer(announcerEngine, other, other.veteran, { role: 'referee', push: 'none' }),
    );
    expect(role).toMatchObject({
      code: 'contracts.badRole',
      message: 'Has never worked as a referee',
    });
  });

  it('refuses extra terms a contract kind does not have', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const reason = refusal(makeOffer(engine, setup, setup.veteran, { extra: { tourDates: 3 } }));
    expect(reason).toMatchObject({ code: 'contracts.badKindExtra', field: 'offer.extra' });
  });
});

describe('contracts.offerRenewal', () => {
  it('opens renewal talks on the live contract inside the window, creating no employment', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    setOverride(engine, 'contracts.renewal.windowDays', 365);
    const employmentsBefore = engine.exportState().world.tables.employments.length;
    const made = done(
      engine.command(
        'contracts.offerRenewal',
        { employmentId: setup.mine, offer: offer({ lengthMonths: 24 }) },
        PLAYER,
      ),
    );
    expect(negotiationOf(engine, made.negotiationId)).toMatchObject({
      kind: 'renewal',
      employmentId: setup.mine,
      status: 'submitted',
    });
    expect(engine.exportState().world.tables.employments).toHaveLength(employmentsBefore);
    const preview = ask(
      engine.query(
        'contracts.offerPreview',
        {
          promotionId: setup.human,
          personId: setup.person(setup.mine),
          offer: offer({ lengthMonths: 24 }),
          negotiationId: made.negotiationId,
        },
        PLAYER_VIEW,
      ),
    );
    expect(preview.offerValue).toBe(made.preview.offerValue);
    expect(preview.askValue).toBe(made.preview.askValue);
  });

  it('opens only inside the renewal window', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const reason = refusal(
      engine.command(
        'contracts.offerRenewal',
        { employmentId: setup.mine, offer: offer() },
        PLAYER,
      ),
    );
    expect(reason.code).toBe('contracts.renewalNotOpen');
    expect(reason.message).toMatch(
      /^Talks open 180 days before the contract ends \(from [A-Z][a-z]+ \d+, \d{4}\)$/,
    );
  });

  it('refuses a deeply unhappy worker without creating a row', () => {
    const setup = negotiationWorld();
    setMorale(setup.world, setup.mine, -80);
    const engine = negotiationEngine(setup.world);
    setOverride(engine, 'contracts.renewal.windowDays', 365);
    const before = engine.exportState().world.tables.negotiations.length;
    const reason = refusal(
      engine.command(
        'contracts.offerRenewal',
        { employmentId: setup.mine, offer: offer() },
        PLAYER,
      ),
    );
    expect(reason).toMatchObject({
      code: 'contracts.refusesRenewal',
      message: "Won't renew while unhappy here",
    });
    expect(engine.exportState().world.tables.negotiations).toHaveLength(before);
  });

  it('refuses another promotion’s contract and an unknown one', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    expect(
      codes(
        engine.command(
          'contracts.offerRenewal',
          { employmentId: setup.rivalEnding, offer: offer() },
          PLAYER,
        ),
      ),
    ).toEqual(['contracts.notYourPromotion']);
    expect(
      codes(
        engine.command(
          'contracts.offerRenewal',
          { employmentId: testId('employment', 9999), offer: offer() },
          PLAYER,
        ),
      ),
    ).toEqual(['contracts.unknownContract']);
  });
});

describe('contracts.respondToCounter and contracts.withdrawOffer', () => {
  function countered(patience = 4): {
    setup: NegotiationWorld;
    engine: Engine;
    negotiationId: NegotiationId;
    counter: Offer;
  } {
    const setup = negotiationWorld();
    const first = negotiationEngine(setup.world);
    const made = done(makeOffer(first, setup, setup.veteran));
    const counter = offer({ terms: { monthlyWage: cents(1_500_000) } });
    const engine = withCounter(first, made.negotiationId, counter, patience, setup.today);
    return { setup, engine, negotiationId: made.negotiationId, counter };
  }

  it('refuses an answer before they countered', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const made = done(makeOffer(engine, setup, setup.veteran));
    expect(
      codes(
        engine.command(
          'contracts.respondToCounter',
          { negotiationId: made.negotiationId, response: 'accept' },
          PLAYER,
        ),
      ),
    ).toEqual(['contracts.notCountered']);
  });

  it('accepting their counter sends it for review and mirrors it on the offered employment', () => {
    const { setup, engine, negotiationId, counter } = countered();
    const answered = done(
      engine.command('contracts.respondToCounter', { negotiationId, response: 'accept' }, PLAYER),
    );
    expect(answered.status).toBe('awaitingReview');
    expect(answered.preview?.reaction).toBe('accept');
    const row = negotiationOf(engine, negotiationId);
    expect(row).toMatchObject({
      status: 'awaitingReview',
      reviewOn: addDays(setup.today, 2),
      patience: 4,
      lastCounter: null,
      counterExpiresOn: null,
      round: 2,
    });
    expect(row.offer).toEqual(counter);
    expect(employmentOf(engine, row.employmentId).terms.monthlyWage).toBe(1_500_000);
  });

  it('revising uses a point of patience, adds a round and matches the preview', () => {
    const { setup, engine, negotiationId } = countered(4);
    const revised = offer({
      terms: { monthlyWage: cents(1_100_000) },
      lengthMonths: 24,
      push: 'upperCard',
    });
    const before = ask(
      engine.query(
        'contracts.offerPreview',
        { promotionId: setup.human, personId: setup.veteran, offer: revised, negotiationId },
        PLAYER_VIEW,
      ),
    );
    const answered = done(
      engine.command(
        'contracts.respondToCounter',
        { negotiationId, response: 'revise', offer: revised },
        PLAYER,
      ),
    );
    const row = negotiationOf(engine, negotiationId);
    expect(row).toMatchObject({ status: 'submitted', round: 2, patience: 3, lastCounter: null });
    expect(row.history.map((entry) => [entry.round, entry.by])).toEqual([
      [1, 'promotion'],
      [1, 'worker'],
      [2, 'promotion'],
    ]);
    expect(answered.preview?.offerValue).toBe(before.offerValue);
    expect(answered.preview?.reaction).toBe(before.reaction);
    expect(answered.preview?.patienceLeft).toBe(before.patienceLeft);
    const after = ask(
      engine.query(
        'contracts.offerPreview',
        { promotionId: setup.human, personId: setup.veteran, offer: revised, negotiationId },
        PLAYER_VIEW,
      ),
    );
    expect(after.reaction).toBe(before.reaction);
    expect(after.patienceLeft).toBe(before.patienceLeft);
    // The offered employment carries the revised terms.
    const employment = employmentOf(engine, row.employmentId);
    expect(employment).toMatchObject({
      push: 'upperCard',
      endsOn: addMonths(setup.today, 24),
    });
    expect(employment.terms.monthlyWage).toBe(1_100_000);
    expect(
      ask(engine.query('trace.get', { ref: askTraceRef(negotiationId, 2) }, PLAYER_VIEW)),
    ).not.toBeNull();
  });

  it('a revision that pays their counter counts as accepting it', () => {
    const { engine, negotiationId, counter } = countered();
    const more = { ...counter, terms: { ...counter.terms, monthlyWage: cents(1_600_000) } };
    const answered = done(
      engine.command(
        'contracts.respondToCounter',
        { negotiationId, response: 'revise', offer: more },
        PLAYER,
      ),
    );
    expect(answered.status).toBe('awaitingReview');
    expect(negotiationOf(engine, negotiationId).patience).toBe(4);
  });

  it('revising needs an offer', () => {
    const { engine, negotiationId } = countered();
    expect(
      codes(
        engine.command('contracts.respondToCounter', { negotiationId, response: 'revise' }, PLAYER),
      ),
    ).toEqual(['contracts.offerRequired']);
  });

  it('ending the talks withdraws the offer with no cooldown', () => {
    const { setup, engine, negotiationId } = countered();
    const answered = done(
      engine.command('contracts.respondToCounter', { negotiationId, response: 'end' }, PLAYER),
    );
    expect(answered).toEqual({ negotiationId, status: 'withdrawn', preview: null });
    const row = negotiationOf(engine, negotiationId);
    expect(row).toMatchObject({
      status: 'withdrawn',
      closedOn: setup.today,
      cooldownUntil: null,
      lastCounter: null,
      outcome: { code: 'talksEnded', otherPromotionId: null },
    });
    expect(employmentOf(engine, row.employmentId)).toMatchObject({
      status: 'withdrawn',
      endedOn: setup.today,
    });
    // They will hear a new offer straight away.
    done(makeOffer(engine, setup, setup.veteran));
  });

  it('withdrawOffer takes back any open offer and publishes negotiation.closed', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const made = done(makeOffer(engine, setup, setup.veteran));
    const result = engine.command(
      'contracts.withdrawOffer',
      { negotiationId: made.negotiationId },
      PLAYER,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.events.map((event) => event.type)).toEqual(['negotiation.closed']);
    const row = negotiationOf(engine, made.negotiationId);
    expect(row).toMatchObject({ status: 'withdrawn', outcome: { code: 'withdrawn' } });
    expect(employmentOf(engine, row.employmentId)).toMatchObject({
      status: 'withdrawn',
      endedOn: setup.today,
    });
    expect(
      codes(
        engine.command('contracts.withdrawOffer', { negotiationId: made.negotiationId }, PLAYER),
      ),
    ).toEqual(['contracts.notOpen']);
    expect(
      codes(
        engine.command('contracts.withdrawOffer', { negotiationId: made.negotiationId }, COMPUTER),
      ),
    ).toEqual(['contracts.notYourPromotion']);
  });

  it('keeps at most 12 rounds, dropping the promotion’s oldest offers first', () => {
    const base = offer();
    const rounds: NegotiationRound[] = [];
    for (let round = 1; round <= 7; round += 1) {
      for (const by of ['promotion', 'worker'] as const) {
        rounds.push({ round, date: TEST_START_DATE, by, offer: base, reaction: null });
      }
    }
    const kept = cappedHistory(rounds);
    expect(kept).toHaveLength(12);
    expect(kept.slice(0, 3).map((entry) => [entry.round, entry.by])).toEqual([
      [1, 'worker'],
      [2, 'worker'],
      [3, 'promotion'],
    ]);
  });
});

describe('offer visibility', () => {
  function twoHumans(): { setup: NegotiationWorld; engine: Engine } {
    const setup = negotiationWorld({ rivalController: OTHER_PLAYER });
    return {
      setup,
      engine: createEngine({ state: initialEngineState(setup.world), systems: SYSTEMS }),
    };
  }

  const MY_SECRET_WAGE = 777_777;

  it('shows another human’s bid by name only', () => {
    const { setup, engine } = twoHumans();
    const mine = done(
      makeOffer(engine, setup, setup.veteran, { terms: { monthlyWage: cents(MY_SECRET_WAGE) } }),
    );
    done(
      engine.command(
        'contracts.makeOffer',
        { promotionId: setup.rival, personId: setup.veteran, offer: offer() },
        OTHER_PLAYER,
      ),
    );

    const theirs = ask(engine.query('contracts.offers', { promotionId: setup.rival }, OTHER_VIEW));
    const row = theirs.find((entry) => entry.personId === setup.veteran);
    expect(row?.competingBidders).toEqual(['My Wrestling']);
    const agents = ask(
      engine.query('contracts.freeAgents', { promotionId: setup.rival }, OTHER_VIEW),
    );
    const views = [
      theirs,
      agents,
      ask(
        engine.query(
          'contracts.negotiation',
          { negotiationId: row?.negotiationId ?? mine.negotiationId },
          OTHER_VIEW,
        ),
      ),
    ];
    for (const view of views) {
      expect(JSON.stringify(view)).not.toContain(String(MY_SECRET_WAGE));
    }
    // The other human never sees the player's rows or talks.
    expect(theirs.every((entry) => entry.negotiationId !== mine.negotiationId)).toBe(true);
    expect(engine.query('contracts.offers', { promotionId: setup.human }, OTHER_VIEW).ok).toBe(
      false,
    );
    expect(
      engine.query('contracts.negotiation', { negotiationId: mine.negotiationId }, OTHER_VIEW).ok,
    ).toBe(false);
  });

  it('keeps the offered employment’s terms from a rival viewer', () => {
    const { setup, engine } = twoHumans();
    const mine = done(
      makeOffer(engine, setup, setup.veteran, { terms: { monthlyWage: cents(MY_SECRET_WAGE) } }),
    );
    const employmentId = negotiationOf(engine, mine.negotiationId).employmentId;
    expect(ask(engine.query('contracts.detail', { employmentId }, OTHER_VIEW))).toBeNull();
    const profile = ask(engine.query('workers.profile', { personId: setup.veteran }, OTHER_VIEW));
    expect(JSON.stringify(profile)).not.toContain(String(MY_SECRET_WAGE));
    const own = ask(engine.query('contracts.detail', { employmentId }, PLAYER_VIEW));
    expect(own).toMatchObject({ termsPrivate: false, monthlyWage: MY_SECRET_WAGE });
  });

  it('lists your talks with the offer, and keeps withdrawn offers off the contract lists', () => {
    const { setup, engine } = twoHumans();
    const made = done(makeOffer(engine, setup, setup.veteran));
    const [row] = ask(
      engine.query('contracts.offers', { promotionId: setup.human, status: 'open' }, PLAYER_VIEW),
    );
    expect(row).toMatchObject({
      negotiationId: made.negotiationId,
      kind: 'signing',
      status: 'submitted',
      round: 1,
      offerSummary: { kind: 'written', exclusive: true, monthlyWage: 900_000, lengthMonths: 12 },
      counterSummary: null,
      outcome: null,
      reactionTraceRef: null,
      reviewTraceRef: null,
    });
    const detail = ask(
      engine.query('contracts.negotiation', { negotiationId: made.negotiationId }, PLAYER_VIEW),
    );
    expect(detail.history[0]).toMatchObject({
      summary: '$9,000 a month, 12 months, exclusive',
      reactionLabel: 'Waiting for their answer',
    });
    expect(detail.ask.personId).toBe(setup.veteran);

    done(engine.command('contracts.withdrawOffer', { negotiationId: made.negotiationId }, PLAYER));
    const closed = ask(
      engine.query('contracts.offers', { promotionId: setup.human, status: 'closed' }, PLAYER_VIEW),
    );
    expect(closed.find((entry) => entry.negotiationId === made.negotiationId)?.outcome).toEqual({
      code: 'withdrawn',
      message: 'You withdrew the offer',
      otherPromotionName: null,
    });
    const ended = ask(engine.query('contracts.list', { tab: 'ended' }, PLAYER_VIEW));
    expect(ended.some((entry) => entry.personId === setup.veteran)).toBe(false);
    const changes = ask(
      engine.query('contracts.changesSince', { from: setup.today, to: setup.today }, PLAYER_VIEW),
    );
    expect(changes.released).toEqual([]);
  });
});
