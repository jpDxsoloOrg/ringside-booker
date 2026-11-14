// Unhappy workers: the unhappy clock, release requests, answers, walk-outs and the
// "Worker wants to leave" stop (ECO4-03). Design: docs/design/contracts.md#unhappy-workers
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import type { EmploymentId } from '../../../src/core/ids';
import {
  CONTRACTS_ACTION_HINT,
  REFUSED_RELEASE_REASON_KEY,
  RELEASE_REQUESTED_GATE_ID,
  unhappyTraceRef,
  walkoutTraceRef,
} from '../../../src/systems/contracts';
import { expectTraceContains, expectTraceReplays } from '../../support/trace';
import { ask, employmentOf, OMNISCIENT, PLAYER, PLAYER_VIEW } from './release-world';
import { concernOf, STORY_NAME, unhappyEngine, unhappyWorld } from './unhappy-world';

/** Requests answered by the system after `answerDays` unless a test turns the stop on. */
const QUICK = { 'contracts.quit.days': 3 } as const;

function answer(
  run: ReturnType<typeof unhappyEngine>,
  employmentId: EmploymentId,
  choice: 'grant' | 'refuse',
) {
  return run.engine.command(
    'contracts.answerReleaseRequest',
    { employmentId, answer: choice },
    PLAYER,
  );
}

function storedTrace(run: ReturnType<typeof unhappyEngine>, ref: { kind: string; id: string }) {
  return ask(run.engine.query('trace.get', { ref }, OMNISCIENT));
}

function eventsOf(run: ReturnType<typeof unhappyEngine>, type: string) {
  return run.events.filter((event) => event.type === type);
}

describe('the unhappy clock', () => {
  it('counts only consecutive days at or below the threshold and resets above it', async () => {
    const built = unhappyWorld();
    const run = unhappyEngine(built.world);
    run.setMorale(built.worker, -45);
    await run.advance(5);
    expect(concernOf(run.engine, built.worker)?.unhappy).toEqual({ since: built.today, days: 5 });
    const why = storedTrace(run, unhappyTraceRef(built.worker));
    const text = JSON.stringify(why);
    expect(text).toContain('Morale -45 at or below -40');
    expect(text).toContain('Not in a hot storyline');
    expect(text).toContain('Day 5 of 14');

    run.setMorale(built.worker, -30);
    await run.advance(1);
    // Nothing else is on the row, so it goes.
    expect(concernOf(run.engine, built.worker)).toBeUndefined();

    run.setMorale(built.worker, -40);
    const restart = run.today();
    await run.advance(2);
    expect(concernOf(run.engine, built.worker)?.unhappy).toEqual({ since: restart, days: 2 });
  });

  it('never runs for the owner, and records no clock for a rival', async () => {
    const built = unhappyWorld();
    const run = unhappyEngine(built.world);
    run.setMorale(built.owner, -90);
    run.setMorale(built.rivalLower, -45);
    await run.advance(3);
    expect(concernOf(run.engine, built.owner)).toBeUndefined();
    expect(concernOf(run.engine, built.rivalLower)?.unhappy?.days).toBe(3);
    expect(storedTrace(run, unhappyTraceRef(built.rivalLower))).toBeNull();
  });
});

describe('release requests', () => {
  it('asks on day quit.days, publishes the event and copies stopSkip', async () => {
    const built = unhappyWorld();
    const run = unhappyEngine(built.world, { 'contracts.releaseRequest.stopSkip': true });
    run.setMorale(built.worker, -50);
    await run.advance(13);
    expect(concernOf(run.engine, built.worker)?.request).toBeNull();
    const advanced = await run.advance(5);
    expect(advanced).toBe(1);
    const raisedOn = addDays(built.today, 13);
    expect(concernOf(run.engine, built.worker)?.request).toEqual({
      raisedOn,
      answerBy: addDays(raisedOn, 7),
      status: 'open',
      answeredOn: null,
      mailId: null,
      stopsSkip: true,
    });
    expect(eventsOf(run, 'contract.releaseRequested').map((event) => event.payload)).toEqual([
      expect.objectContaining({ employmentId: built.worker, promotionId: built.human }),
    ]);
  });

  it('asks at once with quit.days 0, and stopsSkip false with the stop off', async () => {
    const built = unhappyWorld();
    const run = unhappyEngine(built.world, {
      'contracts.quit.days': 0,
      'contracts.releaseRequest.stopSkip': false,
    });
    run.setMorale(built.worker, -41);
    await run.advance(1);
    expect(concernOf(run.engine, built.worker)?.request).toMatchObject({
      raisedOn: built.today,
      status: 'open',
      stopsSkip: false,
    });
  });

  it('stops a skip on an open request by default, and not after it is answered', async () => {
    const built = unhappyWorld();
    // No override: the stop is on by default since the Contracts screen answers it (ECO4-04).
    const run = unhappyEngine(built.world, QUICK);
    run.setMorale(built.worker, -50);
    const result = await run.engine.advanceDays({ maxDays: 30 });
    expect(result.daysAdvanced).toBe(3);
    const name = employmentOf(run.engine, built.worker).ringName;
    const hit = {
      gateId: RELEASE_REQUESTED_GATE_ID,
      reason: `${name} wants to leave`,
      subject: { kind: 'employment', id: built.worker },
      actionHint: CONTRACTS_ACTION_HINT,
    };
    expect(result.stoppedBy).toEqual({ kind: 'gate', hits: [hit] });
    expect(ask(run.engine.query('contracts.counts', {}, PLAYER_VIEW)).wantsToLeave).toBe(1);

    expect(answer(run, built.worker, 'refuse').ok).toBe(true);
    expect(ask(run.engine.query('sim.pendingGates', {}, OMNISCIENT)).hits).toEqual([]);
    expect(ask(run.engine.query('contracts.counts', {}, PLAYER_VIEW)).wantsToLeave).toBe(0);
  });

  it('refuses an ignored request after answerDays with the stop off', async () => {
    const built = unhappyWorld();
    const run = unhappyEngine(built.world, {
      ...QUICK,
      'contracts.releaseRequest.stopSkip': false,
      'contracts.releaseRequest.answerDays': 2,
      'contracts.walkout.chancePerDay': 0,
      'contracts.walkout.extraPerPoint': 0,
    });
    run.setMorale(built.worker, -50);
    await run.advance(3);
    const raisedOn = addDays(built.today, 2);
    expect(concernOf(run.engine, built.worker)?.request?.status).toBe('open');
    await run.advance(2);
    expect(concernOf(run.engine, built.worker)?.request?.status).toBe('open');
    await run.advance(1);
    expect(concernOf(run.engine, built.worker)?.request).toMatchObject({
      status: 'refused',
      answeredOn: addDays(raisedOn, 3),
    });
    expect(eventsOf(run, 'contract.releaseRefused').map((event) => event.payload)).toEqual([
      expect.objectContaining({ employmentId: built.worker, source: 'system' }),
    ]);
    expect(employmentOf(run.engine, built.worker).morale).toBe(-60);
  });
});

describe('the story pause (D-09)', () => {
  it('a member of a storyline at heat 70 never asks to leave; the clock says why', async () => {
    const built = unhappyWorld({ heat: 70 });
    const run = unhappyEngine(built.world, QUICK);
    run.setMorale(built.storied, -80);
    await run.advance(20);
    expect(concernOf(run.engine, built.storied)).toBeUndefined();
    expect(eventsOf(run, 'contract.releaseRequested')).toEqual([]);
    const text = JSON.stringify(storedTrace(run, unhappyTraceRef(built.storied)));
    expect(text).toContain(`In a hot storyline (${STORY_NAME}, heat 70): clock paused (D-09)`);
    expect(text).toContain('Day 0 of 3');
  });

  it('at heat 69 the clock runs and the request comes', async () => {
    const built = unhappyWorld({ heat: 69 });
    const run = unhappyEngine(built.world, QUICK);
    run.setMorale(built.storied, -80);
    await run.advance(3);
    expect(concernOf(run.engine, built.storied)?.request?.status).toBe('open');
  });

  it('a refused worker who joins a hot storyline is never rolled for', async () => {
    const built = unhappyWorld({ heat: 0 });
    const run = unhappyEngine(built.world, {
      ...QUICK,
      'contracts.walkout.chancePerDay': 1,
      'contracts.walkout.maxPerDay': 1,
    });
    run.setMorale(built.storied, -80);
    await run.advance(3);
    expect(answer(run, built.storied, 'refuse').ok).toBe(true);
    const edit = run.engine.command(
      'tunables.setOverride',
      { key: 'contracts.quit.storyShieldHeat', value: 0 },
      PLAYER,
    );
    expect(edit.ok).toBe(true);
    await run.advance(10);
    expect(employmentOf(run.engine, built.storied).status).toBe('active');
    const why = storedTrace(run, walkoutTraceRef(built.storied));
    expect(why?.value).toBe(0);
    expect(JSON.stringify(why)).toContain("won't walk out (D-09)");
    expect(JSON.stringify(why)).not.toContain('"kind":"roll"');
  });
});

describe('answering a request', () => {
  async function withOpenRequest(overrides: Record<string, number | boolean | string> = {}) {
    const built = unhappyWorld();
    const run = unhappyEngine(built.world, { ...QUICK, ...overrides });
    run.setMorale(built.worker, -50);
    await run.advance(3);
    expect(concernOf(run.engine, built.worker)?.request?.status).toBe('open');
    return { built, run };
  }

  it('Grant ends the contract as granted with severanceShare of the normal severance', async () => {
    const { built, run } = await withOpenRequest();
    const preview = ask(
      run.engine.query('contracts.answerPreview', { employmentId: built.worker }, PLAYER_VIEW),
    );
    if (preview.kind !== 'ok') {
      throw new Error('expected a preview');
    }
    expectTraceReplays(preview.grantSeverance);
    expectTraceContains(preview.grantSeverance, { kind: 'multiply', label: 'Agreed share' });
    const full = await withOpenRequest({ 'contracts.quit.severanceShare': 1 });
    const fullPreview = ask(
      full.run.engine.query('contracts.answerPreview', { employmentId: built.worker }, PLAYER_VIEW),
    );
    if (fullPreview.kind !== 'ok') {
      throw new Error('expected a preview');
    }
    expect(preview.grantSeverance.value).toBe(Math.floor(fullPreview.grantSeverance.value * 0.5));

    const granted = answer(run, built.worker, 'grant');
    if (!granted.ok) {
      throw new Error(JSON.stringify(granted.reasons));
    }
    expect(granted.data).toMatchObject({
      answer: 'grant',
      severance: preview.grantSeverance.value,
      cashAfter: preview.cashBefore - preview.grantSeverance.value,
    });
    expect(employmentOf(run.engine, built.worker)).toMatchObject({
      status: 'quit',
      endedOn: run.today(),
    });
    expect(concernOf(run.engine, built.worker)?.ending).toMatchObject({
      how: 'granted',
      severance: preview.grantSeverance.value,
    });
    expect(eventsOf(run, 'contract.quit').map((event) => event.payload)).toEqual([
      expect.objectContaining({ employmentId: built.worker, how: 'granted' }),
    ]);
    const changes = ask(
      run.engine.query(
        'contracts.changesSince',
        { from: built.today, to: run.today() },
        PLAYER_VIEW,
      ),
    );
    expect(changes.quit).toEqual([expect.objectContaining({ how: 'granted' })]);
    expect(changes.requests).toEqual([expect.objectContaining({ employmentId: built.worker })]);
  });

  it('Refuse costs morale through the door and starts the daily rolls', async () => {
    const { built, run } = await withOpenRequest();
    const preview = ask(
      run.engine.query('contracts.answerPreview', { employmentId: built.worker }, PLAYER_VIEW),
    );
    expect(preview).toMatchObject({ kind: 'ok', refuseMoraleDelta: -10, ironClad: false });
    const refused = answer(run, built.worker, 'refuse');
    if (!refused.ok || refused.data.answer !== 'refuse') {
      throw new Error('expected a refusal');
    }
    // −60 is 20 below −40: 0.02 + 20 × 0.001.
    expect(refused.data.walkoutChance.value).toBeCloseTo(0.04);
    if (preview.kind === 'ok') {
      expect(preview.walkoutChanceAfterRefusal.value).toBe(refused.data.walkoutChance.value);
    }
    expectTraceReplays(refused.data.walkoutChance);
    expect(employmentOf(run.engine, built.worker).morale).toBe(-60);
    expect(
      eventsOf(run, 'morale.changed')
        .map((event) => event.payload)
        .filter(
          (payload) => 'reasonKey' in payload && payload.reasonKey === REFUSED_RELEASE_REASON_KEY,
        ),
    ).toEqual([expect.objectContaining({ employmentId: built.worker, before: -50, after: -60 })]);
    expect(concernOf(run.engine, built.worker)?.request).toMatchObject({
      status: 'refused',
      answeredOn: run.today(),
    });

    const row = ask(run.engine.query('contracts.list', { tab: 'active' }, PLAYER_VIEW)).find(
      (entry) => entry.employmentId === built.worker,
    );
    expect(row?.request?.status).toBe('refused');
    expect(row?.walkout?.chance).toBeCloseTo(0.04);
    // The chance has its Why? straight away, before the first daily roll replaces it.
    expect(row?.walkout?.traceRef).toEqual(walkoutTraceRef(built.worker));
    const first = storedTrace(run, walkoutTraceRef(built.worker));
    expect(JSON.stringify(first)).toContain('contracts.quit.threshold');
    expect(JSON.stringify(first)).not.toContain('"stream":"contracts.walkout"');
    await run.advance(1);
    const roll = storedTrace(run, walkoutTraceRef(built.worker));
    expect(JSON.stringify(roll)).toContain('"stream":"contracts.walkout"');
  });

  it('refuses answers for someone else, the owner, or no open request', async () => {
    const { built, run } = await withOpenRequest();
    const rival = answer(run, built.rivalLower, 'grant');
    expect(rival.ok ? [] : rival.reasons.map((reason) => reason.code)).toEqual(['notYourWorker']);
    const owner = answer(run, built.owner, 'grant');
    expect(owner.ok ? [] : owner.reasons.map((reason) => reason.code)).toEqual(['isOwner']);
    const none = answer(run, built.ironClad, 'refuse');
    expect(none.ok ? [] : none.reasons.map((reason) => reason.code)).toEqual(['noOpenRequest']);
    const preview = ask(
      run.engine.query('contracts.answerPreview', { employmentId: built.rivalLower }, PLAYER_VIEW),
    );
    expect(preview.kind).toBe('refused');
  });
});

describe('walk-outs', () => {
  async function refused(
    employment: 'worker' | 'ironClad',
    overrides: Record<string, number | boolean | string>,
  ) {
    const built = unhappyWorld();
    const run = unhappyEngine(built.world, { ...QUICK, ...overrides });
    const id = built[employment];
    run.setMorale(id, -50);
    await run.advance(3);
    expect(answer(run, id, 'refuse').ok).toBe(true);
    return { built, run, id };
  }

  it('chancePerDay 1 walks out the next day, with nothing paid', async () => {
    const { run, id } = await refused('worker', {
      'contracts.walkout.chancePerDay': 1,
      'contracts.walkout.maxPerDay': 1,
    });
    const answeredOn = run.today();
    await run.advance(1);
    expect(employmentOf(run.engine, id)).toMatchObject({
      status: 'quit',
      endedOn: answeredOn,
    });
    expect(concernOf(run.engine, id)?.ending).toMatchObject({ how: 'walkedOut', severance: 0 });
    expect(eventsOf(run, 'contract.quit').map((event) => event.payload)).toEqual([
      expect.objectContaining({ employmentId: id, how: 'walkedOut', severance: 0 }),
    ]);
    const ended = ask(run.engine.query('contracts.list', { tab: 'ended' }, PLAYER_VIEW));
    expect(ended[0]).toMatchObject({ endReason: 'walkedOut', severancePaid: 0 });
  });

  it('chance 0 never walks out; iron-clad never walks out even at 1', async () => {
    const zero = await refused('worker', {
      'contracts.walkout.chancePerDay': 0,
      'contracts.walkout.extraPerPoint': 0,
    });
    await zero.run.advance(30);
    expect(employmentOf(zero.run.engine, zero.id).status).toBe('active');

    const iron = await refused('ironClad', {
      'contracts.walkout.chancePerDay': 1,
      'contracts.walkout.maxPerDay': 1,
    });
    await iron.run.advance(30);
    expect(employmentOf(iron.run.engine, iron.id).status).toBe('active');
    const why = storedTrace(iron.run, walkoutTraceRef(iron.id));
    expect(JSON.stringify(why)).toContain('Iron-clad contract: never walks out');
  });

  it('recovering above threshold + margin clears the risk', async () => {
    const { run, id } = await refused('worker', {
      'contracts.walkout.chancePerDay': 0,
      'contracts.walkout.extraPerPoint': 0,
    });
    run.setMorale(id, -30);
    await run.advance(1);
    expect(concernOf(run.engine, id)?.request?.status).toBe('refused');
    run.setMorale(id, -29);
    await run.advance(1);
    expect(concernOf(run.engine, id)).toBeUndefined();
  });
});

describe('privacy', () => {
  it('rival detail never carries the clock, the request or morale', async () => {
    const built = unhappyWorld();
    const run = unhappyEngine(built.world);
    run.setMorale(built.rivalMainEvent, -60);
    await run.advance(3);
    const detail = ask(
      run.engine.query('contracts.detail', { employmentId: built.rivalMainEvent }, PLAYER_VIEW),
    );
    expect(detail?.termsPrivate).toBe(true);
    expect(detail).not.toHaveProperty('unhappy');
    expect(detail).not.toHaveProperty('morale');
    const filtered = ask(
      run.engine.query('contracts.list', { tab: 'active', wantsToLeave: true }, PLAYER_VIEW),
    );
    expect(filtered).toEqual([]);
  });
});
