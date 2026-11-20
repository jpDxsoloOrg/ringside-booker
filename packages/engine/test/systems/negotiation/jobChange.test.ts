// A different job (UNITY-38): offering someone on your roster another job through a renewal, their
// answer to it, signing it and keeping it through a save. Design: docs/design/negotiation.md#job-change
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  engineLoadOptions,
  engineSaveState,
  engineStateFromSave,
  initialEngineState,
  type Engine,
  type EngineState,
} from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { addDays, addYears, type GameDate } from '../../../src/core/date';
import type { EmploymentId, NegotiationId, PersonId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import type { Employment, EmploymentRole, Push } from '../../../src/model/entities/employment';
import type { Negotiation } from '../../../src/model/entities/negotiation';
import type { Person } from '../../../src/model/entities/person';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES, type GameWorld } from '../../../src/model/tables';
import { encodeSave } from '../../../src/persistence/codec';
import { loadSave } from '../../../src/persistence/load';
import { createSaveDocument, documentToWorld } from '../../../src/persistence/world-document';
import { contractsSystem } from '../../../src/systems/contracts';
import { financeSystem } from '../../../src/systems/finance';
import {
  askTermsOf,
  jobChangeAnswer,
  negotiationSystem,
  REFUSES_JOB_CODE,
  styleForNewWrestler,
  type AskingTermsView,
  type Offer,
} from '../../../src/systems/negotiation';
import { createEngineTunables } from '../../../src/systems/tunables';
import { workersSystem } from '../../../src/systems/workers';
import { anEmployment, anOffer, aPerson, TEST_START_DATE, type DeepPartial } from '../../support';
import { TEST_ENGINE_VERSION, TEST_SAVED_AT } from '../../support/saves';
import { expectTraceReplays } from '../../support/trace';
import { negotiationWorld, PLAYER, PLAYER_VIEW, type NegotiationWorld } from './negotiation-world';

const tunables = createEngineTunables();
const TODAY = TEST_START_DATE;
const SYSTEMS = [simSystem, financeSystem, workersSystem, contractsSystem, negotiationSystem];
const QUIET = {
  'contracts.expiringSoon.stopSkip': false,
  'contracts.releaseRequest.stopSkip': false,
  'contracts.answer.stopSkip': false,
} as const;

function attributes(values: Partial<Person['attributes']>, base = 50): Person['attributes'] {
  return {
    ringwork: base,
    psychology: base,
    stamina: base,
    safety: base,
    athleticism: base,
    mic: base,
    charisma: base,
    presence: base,
    officiating: base,
    broadcasting: base,
    producing: base,
    booking: base,
    ...values,
  };
}

function condition(value: number): Person['condition'] {
  return { head: 100, neck: 100, back: value, arms: 100, torso: 100, legs: 100 };
}

const INJURY = {
  kindKey: 'injury.torn-acl',
  bodyPart: 'legs',
  since: addDays(TODAY, -10),
  expectedReturn: addDays(TODAY, 60),
  canWorkAngles: true,
} as const;

/** A manager who has never wrestled: charismatic, with fair ring skills. */
function aManager(overrides: DeepPartial<Person> = {}): Person {
  return aPerson({
    roles: ['manager'],
    style: 'nonWrestler',
    birthDate: addYears(TODAY, -30),
    attributes: attributes({ charisma: 80, presence: 75, mic: 75, ringwork: 60, athleticism: 60 }),
    ...overrides,
  });
}

function aContract(role: EmploymentRole, push: Push, overrides: DeepPartial<Employment> = {}) {
  return anEmployment({ role, push, morale: 20, ...overrides });
}

function answerFor(
  person: Person,
  contract: Employment,
  role: EmploymentRole,
  push: Push,
  monthlyWage = contract.terms.monthlyWage,
) {
  return jobChangeAnswer(
    {
      person,
      contract,
      role,
      push,
      terms: { ...contract.terms, monthlyWage: cents(monthlyWage) },
      date: TODAY,
    },
    { tunables },
  );
}

describe('jobChangeAnswer', () => {
  it('a charismatic manager with fair ring skills is up for wrestling', () => {
    const manager = aManager();
    const answer = answerFor(manager, aContract('manager', 'none'), 'wrestler', 'lowerCard');
    expect(answer.willing.value).toBe(true);
    expect(answer.from).toBe('manager');
    expect(answer.to).toBe('wrestler');
    expect(answer.answer).toMatch(/^Up for wrestling: /u);
    expectTraceReplays(answer.score);
  });

  it('an old, hurt, worn-down manager will not wrestle, and says why in plain words', () => {
    const manager = aManager({
      birthDate: addYears(TODAY, -52),
      injury: INJURY,
      condition: condition(40),
    });
    const answer = answerFor(manager, aContract('manager', 'none'), 'wrestler', 'lowerCard');
    expect(answer.willing.value).toBe(false);
    expect(answer.answer).toBe("Doesn't want to wrestle: feels too old to wrestle at 52");
    const why = JSON.stringify(answer.willing.trace);
    expect(why).toContain('Hurt right now');
    expect(why).toContain('Body worn down');
    expect(why).toContain('contracts.jobChange.acceptAt');
    expectTraceReplays(answer.score);
  });

  it('a good young wrestler wants to stay in the ring', () => {
    const wrestler = aPerson({ attributes: attributes({}, 70), birthDate: addYears(TODAY, -25) });
    const answer = answerFor(wrestler, aContract('wrestler', 'midCard'), 'manager', 'none');
    expect(answer.willing.value).toBe(false);
    expect(answer.answer).toBe("Doesn't want the manager job: still wants to wrestle");
    expect(JSON.stringify(answer.willing.trace)).toContain('Too young to leave the ring at 25');
  });

  it('a worn-down veteran with a good voice is glad to move to commentary', () => {
    const veteran = aPerson({
      birthDate: addYears(TODAY, -46),
      condition: condition(45),
      attributes: attributes({ mic: 80, broadcasting: 80, charisma: 70, presence: 70 }, 55),
    });
    const answer = answerFor(veteran, aContract('wrestler', 'midCard'), 'announcer', 'none');
    expect(answer.willing.value).toBe(true);
    expect(answer.answer).toBe('Up for the announcer job: ready to slow down at 46');
  });

  it('weighs pay, morale and ambition, and always answers the same way', () => {
    const person = aManager();
    const contract = aContract('manager', 'none', { terms: { monthlyWage: cents(500_000) } });
    const low = answerFor(person, contract, 'wrestler', 'lowerCard', 300_000).score.value;
    const same = answerFor(person, contract, 'wrestler', 'lowerCard', 500_000).score.value;
    const high = answerFor(person, contract, 'wrestler', 'lowerCard', 700_000).score.value;
    expect(low).toBeLessThan(same);
    expect(same).toBeLessThan(high);
    const unhappy = answerFor(person, { ...contract, morale: -60 }, 'wrestler', 'lowerCard');
    expect(unhappy.score.value).toBeLessThan(same);
    const thrill = answerFor(
      { ...person, motivation: 'thrill' },
      contract,
      'wrestler',
      'lowerCard',
    );
    expect(thrill.score.value).toBeGreaterThan(same);
    const top = answerFor(person, contract, 'wrestler', 'mainEvent', 500_000).score.value;
    expect(top).toBeGreaterThan(same);
    expect(answerFor(person, contract, 'wrestler', 'lowerCard')).toEqual(
      answerFor(person, contract, 'wrestler', 'lowerCard'),
    );
  });

  it('gives a new wrestler a ring style that fits them', () => {
    expect(styleForNewWrestler(attributes({ charisma: 80, presence: 80 }))).toBe('showman');
    expect(styleForNewWrestler(attributes({ ringwork: 80, psychology: 80 }))).toBe('technician');
    expect(styleForNewWrestler(attributes({ ringwork: 60, psychology: 70, athleticism: 90 }))).toBe(
      'highFlyer',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Through the engine

function done<T>(result: { ok: true; data: T } | { ok: false; reasons: unknown }): T {
  if (!result.ok) {
    throw new Error(`refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

function engineOver(state: EngineState): Engine {
  return createEngine({ state, systems: SYSTEMS });
}

function jobEngine(setup: NegotiationWorld): Engine {
  const engine = engineOver(initialEngineState(setup.world));
  for (const [key, value] of Object.entries(QUIET)) {
    done(engine.command('tunables.setOverride', { key, value }, PLAYER));
  }
  return engine;
}

/** Turns `mine`'s worker into someone else (a test edit of the world before the engine starts). */
function reshape(
  world: GameWorld,
  employmentId: EmploymentId,
  person: DeepPartial<Person>,
  employment: DeepPartial<Employment>,
): void {
  const result = world.transact('test reshape', (tx) => {
    const contract = world.tables.employments.require(employmentId);
    tx.update('people', contract.personId, person);
    tx.update('employments', employmentId, employment);
  });
  if (!result.ok) {
    throw result.error;
  }
}

function rowOf<T extends { id: string }>(rows: readonly T[], id: string): T {
  const row = rows.find((entry) => entry.id === id);
  if (row === undefined) {
    throw new Error(`missing ${id}`);
  }
  return row;
}

function employmentOf(engine: Engine, id: EmploymentId): Employment {
  return rowOf(engine.exportState().world.tables.employments, id);
}

function personOf(engine: Engine, id: PersonId): Person {
  return rowOf(engine.exportState().world.tables.people, id);
}

function negotiationOf(engine: Engine, id: NegotiationId): Negotiation {
  return rowOf(engine.exportState().world.tables.negotiations, id);
}

function jobAsk(engine: Engine, setup: NegotiationWorld, role: EmploymentRole): AskingTermsView {
  return done(
    engine.query(
      'contracts.askingTerms',
      {
        promotionId: setup.human,
        personId: setup.person(setup.mine),
        renewalOf: setup.mine,
        role,
      },
      PLAYER_VIEW,
    ),
  );
}

/** Their ask for the new job, as an offer of that job. */
function jobOffer(ask: AskingTermsView, role: EmploymentRole): Offer {
  return anOffer({
    terms: askTermsOf(ask),
    lengthMonths: ask.preferredLengthMonths.value,
    push: ask.expectedPush.value,
    role,
  });
}

function offerJob(engine: Engine, setup: NegotiationWorld, offer: Offer): NegotiationId {
  return done(engine.command('contracts.offerRenewal', { employmentId: setup.mine, offer }, PLAYER))
    .negotiationId;
}

function preview(engine: Engine, setup: NegotiationWorld, offer: Offer) {
  return done(
    engine.query(
      'contracts.offerPreview',
      {
        promotionId: setup.human,
        personId: setup.person(setup.mine),
        offer,
        renewalOf: setup.mine,
      },
      PLAYER_VIEW,
    ),
  );
}

async function advance(engine: Engine, days: number): Promise<void> {
  await engine.advanceDays({ maxDays: days });
}

function integrityIssues(engine: Engine) {
  const world = documentToWorld({ state: { world: engine.exportState().world } }, TABLES);
  return checkWorld(world, TABLES, { validateRows: true }).issues;
}

async function reloadedThroughSave(engine: Engine, setup: NegotiationWorld): Promise<Engine> {
  const doc = createSaveDocument(engineSaveState(engine.exportState()), {
    headerPromotionId: setup.human,
    savedAt: TEST_SAVED_AT,
    label: 'Job changed',
    engineVersion: TEST_ENGINE_VERSION,
  });
  const report = await loadSave(await encodeSave(doc), TABLES, engineLoadOptions());
  if (!report.ok) {
    expect.fail(JSON.stringify(report.issues, null, 2));
  }
  return engineOver(engineStateFromSave(report.doc));
}

function managerWorld(person: DeepPartial<Person> = {}): NegotiationWorld {
  const setup = negotiationWorld();
  reshape(
    setup.world,
    setup.mine,
    {
      roles: ['manager'],
      style: 'nonWrestler',
      birthDate: addYears(TODAY, -30),
      attributes: attributes({ charisma: 80, presence: 75, mic: 75, ringwork: 60 }),
      ...person,
    },
    { role: 'manager', push: 'none', morale: 20 },
  );
  return setup;
}

describe('a job change through contract talks', () => {
  it('offers a manager a wrestling job outside the renewal window; they sign and become a wrestler', async () => {
    const setup = managerWorld();
    const engine = jobEngine(setup);
    const personId = setup.person(setup.mine);
    const ask = jobAsk(engine, setup, 'wrestler');
    expect(ask.role).toBe('wrestler');
    expect(ask.jobChangeFrom).toBe('manager');
    const offer = jobOffer(ask, 'wrestler');
    const before = preview(engine, setup, offer);
    expect(before.jobChange).toMatchObject({ from: 'manager', to: 'wrestler', willing: true });
    expect(before.reaction).toBe('accept');
    expect(JSON.stringify(before.reactionTrace)).toContain('Their answer to the new job');

    const id = offerJob(engine, setup, offer);
    await advance(engine, 3);
    expect(negotiationOf(engine, id).status).toBe('signed');
    const contract = employmentOf(engine, setup.mine);
    expect(contract.role).toBe('wrestler');
    expect(contract.push).toBe(offer.push);
    expect(contract.morale).toBe(20);
    const person = personOf(engine, personId);
    expect(person.style).toBe('showman');
    expect(person.roles).toEqual(expect.arrayContaining(['manager', 'wrestler']));
    expect(integrityIssues(engine)).toEqual([]);

    // The roster now lists them with the wrestlers, and a save keeps it.
    const reloaded = await reloadedThroughSave(engine, setup);
    expect(employmentOf(reloaded, setup.mine).role).toBe('wrestler');
    expect(personOf(reloaded, personId).style).toBe('showman');
  });

  it('an old, hurt manager turns wrestling down: the talks close in plain words, nothing changes', async () => {
    const setup = managerWorld({
      birthDate: addYears(TODAY, -55),
      injury: INJURY,
      condition: condition(40),
    });
    const engine = jobEngine(setup);
    const offer = jobOffer(jobAsk(engine, setup, 'wrestler'), 'wrestler');
    const answer = preview(engine, setup, offer);
    expect(answer.reaction).toBe('refuse');
    expect(answer.jobChange?.willing).toBe(false);
    expect(answer.jobChange?.answer).toMatch(/^Doesn't want to wrestle: /u);
    expect(answer.notes).not.toContain(answer.jobChange?.answer);

    // They decide when the day runs, like any offer.
    const id = offerJob(engine, setup, offer);
    const from: GameDate = engine.exportState().world.meta.currentDate;
    await advance(engine, 1);
    const talks = negotiationOf(engine, id);
    expect(talks.status).toBe('declined');
    expect(talks.outcome?.code).toBe(REFUSES_JOB_CODE);
    const to: GameDate = engine.exportState().world.meta.currentDate;
    const updates = done(
      engine.query(
        'contracts.offerUpdatesSince',
        { promotionId: setup.human, from, to },
        PLAYER_VIEW,
      ),
    );
    expect(updates.declined.map((update) => update.line)).toEqual([
      expect.stringMatching(/turned down your offer: doesn't want the new job$/u),
    ]);
    expect(employmentOf(engine, setup.mine).role).toBe('manager');
    expect(personOf(engine, setup.person(setup.mine)).style).toBe('nonWrestler');
  });

  it('a veteran wrestler moves to commentary: no card position, still able to wrestle', async () => {
    const setup = negotiationWorld();
    reshape(
      setup.world,
      setup.mine,
      {
        birthDate: addYears(TODAY, -46),
        condition: condition(45),
        attributes: attributes({ mic: 80, broadcasting: 80, charisma: 70, presence: 70 }, 55),
      },
      { morale: 10 },
    );
    const engine = jobEngine(setup);
    const ask = jobAsk(engine, setup, 'announcer');
    expect(ask.expectedPush.value).toBe('none');
    const offer = jobOffer(ask, 'announcer');
    expect(preview(engine, setup, offer).jobChange?.willing).toBe(true);
    const id = offerJob(engine, setup, offer);
    await advance(engine, 3);
    expect(negotiationOf(engine, id).status).toBe('signed');
    const contract = employmentOf(engine, setup.mine);
    expect(contract.role).toBe('announcer');
    expect(contract.push).toBe('none');
    expect(personOf(engine, setup.person(setup.mine)).roles).toEqual(
      expect.arrayContaining(['wrestler', 'announcer']),
    );
    expect(integrityIssues(engine)).toEqual([]);
  });

  it('keeps the renewal window for the same job, and an unhappy worker can still hear a new job', () => {
    const setup = negotiationWorld();
    reshape(setup.world, setup.mine, {}, { morale: -80 });
    const engine = jobEngine(setup);
    const same = engine.command(
      'contracts.offerRenewal',
      { employmentId: setup.mine, offer: anOffer({ terms: { monthlyWage: cents(900_000) } }) },
      PLAYER,
    );
    expect(same.ok ? [] : same.reasons.map((reason) => reason.code)).toEqual([
      'contracts.renewalNotOpen',
    ]);
    const ask = jobAsk(engine, setup, 'manager');
    expect(ask.refusal).toBeNull();
    const result = preview(engine, setup, jobOffer(ask, 'manager'));
    expect(result.jobChange?.to).toBe('manager');
    expect(JSON.stringify(result.jobChange?.trace)).toContain('Unhappy here');
  });
});
