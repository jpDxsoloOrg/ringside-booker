// "Contract expiring soon": the notices, the gate and contracts.acknowledgeExpiries (ECO4-02).
// Design: docs/design/contracts.md#expiring-soon
import { describe, expect, it } from 'vitest';
import type { Engine } from '../../../src/core/api';
import { addDays } from '../../../src/core/date';
import type { EmploymentId } from '../../../src/core/ids';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import {
  CONTRACTS_ACTION_HINT,
  EXPIRING_SOON_GATE_ID,
  runContractLifecycle,
} from '../../../src/systems/contracts';
import { definePhase } from '../../../src/core/pipeline/phase';
import { plainDate } from '../../../src/systems/health';
import { resetTestIds, rosterWorld } from '../../support';
import { contractsRuntime, runDays, setEndsOn } from './contract-world';
import {
  ask,
  COMPUTER,
  contractsEngine,
  employmentOf,
  OMNISCIENT,
  OTHER_PLAYER,
  PLAYER,
  releaseWorld,
} from './release-world';

function pendingGates(engine: Engine) {
  return ask(engine.query('sim.pendingGates', {}, OMNISCIENT)).hits;
}

function acknowledge(engine: Engine, employmentIds: EmploymentId[] | 'all', issuedBy = PLAYER) {
  return engine.command('contracts.acknowledgeExpiries', { employmentIds }, issuedBy);
}

function today(engine: Engine) {
  return engine.exportState().world.meta.currentDate;
}

describe('contracts.expiringSoon', () => {
  it('stops the skip the day after the notice day, naming the worker, until it is seen', async () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world);
    // 40 days left, a 30-day window: the notice is raised on day 10, so day 11 does not run.
    const first = await engine.advanceDays({ maxDays: 60 });
    expect(first.daysAdvanced).toBe(11);
    expect(today(engine)).toBe(addDays(built.today, 11));
    const name = employmentOf(engine, built.expiring).ringName;
    const hit = {
      gateId: EXPIRING_SOON_GATE_ID,
      reason: `Contract expiring soon: ${name} (ends ${plainDate(addDays(built.today, 40))})`,
      subject: { kind: 'employment', id: built.expiring },
      actionHint: CONTRACTS_ACTION_HINT,
    };
    expect(first.stoppedBy).toEqual({ kind: 'gate', hits: [hit] });
    expect(pendingGates(engine)).toEqual([hit]);
    expect((await engine.advanceDays({ maxDays: 5 })).daysAdvanced).toBe(0);

    expect(acknowledge(engine, [built.expiring]).ok).toBe(true);
    expect(pendingGates(engine)).toEqual([]);
    const notice = engine
      .exportState()
      .world.tables.contractConcerns.find((row) => row.employmentId === built.expiring);
    expect(notice?.expiryNotice).toEqual({
      raisedOn: addDays(built.today, 10),
      seenOn: addDays(built.today, 11),
    });
    // It stays seen, so nothing stops the next hundred days. Nobody renews it (the automatic
    // renewal is off since ECO5-05: the player renews through talks), so it runs out on its end
    // date and the concern row keeps only how it ended.
    const next = await engine.advanceDays({ maxDays: 100 });
    expect(next.stoppedBy).toEqual({ kind: 'completed' });
    const ended = engine
      .exportState()
      .world.tables.contractConcerns.find((row) => row.employmentId === built.expiring);
    expect(ended?.expiryNotice).toBeNull();
    expect(ended?.ending?.how).toBe('expired');
    expect(employmentOf(engine, built.expiring).status).toBe('expired');
  });

  it('names the soonest and counts the rest; never stops for push below the minimum', async () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world, { 'contracts.expiringSoon.minPush': 'none' });
    // The enhancement worker (35 days left) gets a notice on day 5.
    const first = await engine.advanceDays({ maxDays: 60 });
    expect(first.daysAdvanced).toBe(6);
    acknowledge(engine, 'all');
    await engine.advanceDays({ maxDays: 60 });
    expect(today(engine)).toBe(addDays(built.today, 11));

    const both = releaseWorld();
    const late = contractsEngine(both.world, {
      'contracts.expiringSoon.minPush': 'none',
      'contracts.expiringSoon.days': 45,
    });
    await late.advanceDays({ maxDays: 60 });
    const [hit] = pendingGates(late);
    const low = employmentOf(late, both.low).ringName;
    expect(hit?.reason).toBe(
      `Contract expiring soon: ${low} (ends ${plainDate(addDays(both.today, 35))}) and 1 more`,
    );
    expect(hit?.subject).toEqual({ kind: 'employment', id: both.low });
  });

  it('never stops with days at 0 or the stop turned off', async () => {
    for (const overrides of [
      { 'contracts.expiringSoon.days': 0 },
      { 'contracts.expiringSoon.stopSkip': false },
    ]) {
      const built = releaseWorld();
      const engine = contractsEngine(built.world, overrides);
      const result = await engine.advanceDays({ maxDays: 45 });
      expect(result.stoppedBy).toEqual({ kind: 'completed' });
    }
    // With the stop off the notice is still listed, as already seen.
    const built = releaseWorld();
    const engine = contractsEngine(built.world, { 'contracts.expiringSoon.stopSkip': false });
    await engine.advanceDays({ maxDays: 20 });
    const expiring = ask(
      engine.query(
        'contracts.list',
        { tab: 'expiring' },
        { kind: 'controller', controller: PLAYER },
      ),
    );
    expect(expiring.find((row) => row.employmentId === built.expiring)?.notice).toBe('seen');
  });

  it('clears the notice when the worker is released, so they never stop a skip', async () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world);
    await engine.advanceDays({ maxDays: 60 });
    const shown = ask(
      engine.query(
        'contracts.releasePreview',
        { employmentId: built.expiring },
        { kind: 'controller', controller: PLAYER },
      ),
    );
    expect(shown.kind).toBe('ok');
    if (shown.kind === 'ok') {
      const released = engine.command(
        'contracts.release',
        { employmentId: built.expiring, expectedSeverance: shown.severance.value },
        PLAYER,
      );
      expect(released.ok).toBe(true);
    }
    expect(pendingGates(engine)).toEqual([]);
  });

  it('raises nothing in a world no human plays', () => {
    resetTestIds();
    const { world, ids } = rosterWorld(6);
    ids.employments.forEach((employmentId, index) => {
      setEndsOn(world, employmentId, addDays(world.meta.currentDate, 5 + index * 3));
    });
    runDays(contractsRuntime(world, {}, [], false), 40);
    expect(
      world.tables.contractConcerns.values().filter((row) => row.expiryNotice !== null),
    ).toEqual([]);
  });

  it('is idempotent within a day, as on a show night run early', () => {
    const built = releaseWorld();
    const again = definePhase({
      id: 'test.lifecycleAgain',
      group: 'contracts',
      order: 20,
      cadence: { kind: 'daily' },
      run: runContractLifecycle,
    });
    const runtime = contractsRuntime(
      built.world,
      { 'contracts.expiringSoon.stopSkip': true },
      [again],
      false,
    );
    runDays(runtime, 12);
    const notices = built.world.tables.contractConcerns
      .values()
      .filter((row) => row.expiryNotice !== null);
    expect(notices.map((row) => [row.employmentId, row.expiryNotice])).toEqual([
      [built.expiring, { raisedOn: addDays(built.today, 10), seenOn: null }],
    ]);
    expect(checkWorld(built.world, TABLES, { validateRows: true }).issues).toEqual([]);
  });
});

describe('contracts.acknowledgeExpiries', () => {
  it("refuses a rival's contract, another player and the computer", async () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world);
    await engine.advanceDays({ maxDays: 60 });
    const rival = acknowledge(engine, [built.rivalWorker]);
    expect(rival.ok ? [] : rival.reasons.map((reason) => reason.code)).toEqual(['notYourWorker']);
    for (const issuedBy of [OTHER_PLAYER, COMPUTER]) {
      const refused = acknowledge(engine, 'all', issuedBy);
      expect(refused.ok).toBe(false);
      const mine = acknowledge(engine, [built.expiring], issuedBy);
      expect(mine.ok).toBe(false);
    }
    expect(pendingGates(engine)).toHaveLength(1);
  });
});
