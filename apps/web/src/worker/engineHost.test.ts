import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, CURRENT_FORMAT_VERSION, ENGINE_VERSION } from '@ringside/engine';
import type { GameDate } from '@ringside/engine';
import { TEST_PLAYER_ID } from '@ringside/engine/testing';
import { createInProcessTransport } from '@/app/engine/transport';
import {
  FAKE_GATE_ID,
  FAKE_START_DATE,
  fakeAdvanceDay,
  fakeEngineFactory,
  fakeEngineState,
} from '@/test/fakeEngine';
import type { FakeEngineOptions } from '@/test/fakeEngine';
import { ADVANCE_BUSY_REASON, createEngineHost, NO_WORLD_REASON } from './engineHost';
import type { AdvanceProgress, EngineHostOptions } from './engineHost';
import { yieldToEventLoop } from './yieldToEventLoop';
import * as storage from '@/storage';
import {
  damagedGoldenSave,
  goldenGameDate,
  goldenHumanController,
  goldenSaveBytes,
  goldenSaveDocument,
  truncatedGoldenSave,
} from '@/test/goldenSave';
import { expectOk, resetSaveDb } from '@/test/saves';

const LOCAL_CONTROLLER = { kind: 'human', playerId: TEST_PLAYER_ID } as const;

/** A host with the fake world installed. Progress is reported every day unless the test says otherwise. */
function loadedHost(fake: FakeEngineOptions = {}, options: EngineHostOptions = {}) {
  const { host } = createInProcessTransport(fakeEngineFactory(fake), {
    progressIntervalMs: 0,
    ...options,
  });
  const install = host.installEngine(fakeEngineState());
  return { host, install };
}

describe('engine host before a world is loaded', () => {
  it('answers every call with the noWorld reason instead of throwing', async () => {
    const host = createEngineHost(fakeEngineFactory());

    expect(host.isWorldLoaded()).toBe(false);
    expect(host.getSeat()).toBeNull();
    await expect(host.query('counter.get', {})).resolves.toEqual({
      revision: 0,
      result: { ok: false, reasons: [NO_WORLD_REASON] },
    });
    await expect(host.command('counter.increment', { amount: 1 })).resolves.toEqual({
      revision: 0,
      result: { ok: false, reasons: [{ code: 'noWorld', message: 'No game is loaded' }] },
    });
    await expect(host.advanceDays({ maxDays: 1 }, () => undefined)).resolves.toEqual({
      ok: false,
      reasons: [NO_WORLD_REASON],
      revision: 0,
    });
    expect(() => {
      host.cancelAdvance();
    }).not.toThrow();
  });

  it('pings with the engine version', async () => {
    const host = createEngineHost(fakeEngineFactory());
    await expect(host.ping()).resolves.toEqual({ engineVersion: ENGINE_VERSION });
  });
});

describe('engine host seat injection', () => {
  it('resolves the local seat when a world is installed', () => {
    const { host, install } = loadedHost();

    expect(host.isWorldLoaded()).toBe(true);
    expect(install.seat.controller).toEqual(LOCAL_CONTROLLER);
    expect(install.seat.promotionId).not.toBeNull();
    expect(host.getSeat()).toEqual(install.seat);
    expect(install.revision).toBe(1);
  });

  it('runs queries for the local viewer without the caller passing one', async () => {
    const { host } = loadedHost();
    const { result } = await host.query('fakeEngine.viewer', {});
    expect(result).toEqual({
      ok: true,
      data: { kind: 'controller', controller: LOCAL_CONTROLLER },
    });
  });

  it('logs commands as issued by the local controller', async () => {
    const { host } = loadedHost();
    await host.command('counter.increment', { amount: 2 });
    await host.command('counter.increment', { amount: -1 });

    const { result } = await host.query('sim.commandLog', { limit: 10 });
    if (!result.ok) throw new Error('sim.commandLog was refused');
    expect(result.data).toHaveLength(2);
    for (const entry of result.data) {
      expect(entry.issuedBy).toEqual(LOCAL_CONTROLLER);
    }
    expect(result.data.map((entry) => entry.outcome)).toEqual(['applied', 'rejected']);
  });
});

describe('engine host revision', () => {
  it('bumps after an applied command and not after a refused one', async () => {
    const { host } = loadedHost();
    const applied = await host.command('counter.increment', { amount: 3 });
    expect(applied).toMatchObject({ revision: 2, result: { ok: true, data: { value: 3 } } });

    const refused = await host.command('counter.increment', { amount: -1 });
    expect(refused.revision).toBe(2);
    expect(refused.result).toEqual({
      ok: false,
      reasons: [{ code: 'negativeAmount', message: 'The counter only goes up.', field: 'amount' }],
    });

    await expect(host.query('counter.get', {})).resolves.toEqual({
      revision: 2,
      result: { ok: true, data: { value: 3 } },
    });
  });
});

describe('engine host advanceDays', () => {
  it('reports progress and stops at a gate on day 3', async () => {
    const { host } = loadedHost({ gateDate: fakeAdvanceDay(3) });
    const progress: AdvanceProgress[] = [];
    const outcome = await host.advanceDays({ maxDays: 10 }, (report) => {
      progress.push(report);
    });

    if (!outcome.ok) throw new Error(`advance refused: ${JSON.stringify(outcome.reasons)}`);
    expect(outcome.stoppedBy.kind).toBe('gate');
    expect(outcome.stoppedBy).toMatchObject({ hits: [{ gateId: FAKE_GATE_ID }] });
    expect(outcome.daysAdvanced).toBe(2);
    expect(outcome.startDate).toBe(FAKE_START_DATE);
    expect(outcome.endDate).toBe(fakeAdvanceDay(3));
    // Installing was revision 1; each simulated day adds one.
    expect(outcome.revision).toBe(3);
    expect(progress).toEqual([
      { daysDone: 1, daysRequested: 10, currentDate: fakeAdvanceDay(2), revision: 2 },
      { daysDone: 2, daysRequested: 10, currentDate: fakeAdvanceDay(3), revision: 3 },
    ]);
  });

  it('stops after the current day when cancelled from the progress callback', async () => {
    const { host } = loadedHost();
    const outcome = await host.advanceDays({ maxDays: 10 }, (report) => {
      if (report.daysDone === 2) host.cancelAdvance();
    });

    if (!outcome.ok) throw new Error('advance refused');
    expect(outcome.stoppedBy.kind).toBe('cancelled');
    expect(outcome.daysAdvanced).toBe(2);
  });

  it('runs to the end when nothing stops it', async () => {
    const { host } = loadedHost();
    const outcome = await host.advanceDays({ maxDays: 4 }, () => undefined);
    expect(outcome).toMatchObject({ ok: true, stoppedBy: { kind: 'completed' }, daysAdvanced: 4 });
    await expect(host.query('clock.get', {})).resolves.toMatchObject({
      revision: 5,
      result: { ok: true, data: { date: fakeAdvanceDay(5) } },
    });
  });

  it('throttles progress and always sends the final report', async () => {
    let clock = 0;
    const { host } = loadedHost({}, { progressIntervalMs: 50, now: () => clock });
    const progress: AdvanceProgress[] = [];
    const outcome = await host.advanceDays({ maxDays: 5 }, (report) => {
      progress.push(report);
      clock += 10;
    });

    expect(outcome.ok).toBe(true);
    // Day 1 reports at once; days 2-4 fall inside 50 ms of it; day 5 is the final report.
    expect(progress.map((report) => report.daysDone)).toEqual([1, 5]);
    expect(progress.at(-1)?.revision).toBe(outcome.revision);
  });

  it('refuses a second advance while one runs', async () => {
    const { host } = loadedHost();
    let second: Promise<unknown> | null = null;
    const first = await host.advanceDays({ maxDays: 3 }, () => {
      second ??= host.advanceDays({ maxDays: 1 }, () => undefined);
    });

    expect(first.ok).toBe(true);
    await expect(second).resolves.toMatchObject({ ok: false, reasons: [ADVANCE_BUSY_REASON] });
  });

  it('turns options the engine refuses into invalidArgs reasons', async () => {
    const { host } = loadedHost();
    const outcome = await host.advanceDays({ maxDays: 0 }, () => undefined);
    expect(outcome).toMatchObject({ ok: false, reasons: [{ code: 'invalidArgs' }], revision: 1 });
    // The host is free again afterwards.
    await expect(host.advanceDays({ maxDays: 1 }, () => undefined)).resolves.toMatchObject({
      ok: true,
    });
  });
});

describe('engine host plain-JSON checks', () => {
  it('fails a query that returns a Map in dev builds, naming the path', async () => {
    const { host } = loadedHost({}, { debugChecks: true });
    const { result } = await host.query('fakeEngine.rows', {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons[0]?.code).toBe('internal');
    expect(result.reasons[0]?.message).toContain('rows[3].contract');
  });

  it('passes the same result through untouched in production builds', async () => {
    const { host } = loadedHost({}, { debugChecks: false });
    const { result } = await host.query('fakeEngine.rows', {});
    if (!result.ok) throw new Error('query refused');
    expect(result.data.rows[3]?.contract).toBeInstanceOf(Map);
  });

  it('turns the checks on by default in tests', () => {
    const factory = vi.fn(fakeEngineFactory());
    createEngineHost(factory).installEngine(fakeEngineState());
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ debugChecks: true }));
  });
});

describe('yieldToEventLoop', () => {
  it('resolves after messages already waiting', async () => {
    const order: string[] = [];
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      order.push('message');
      channel.port1.close();
    };
    channel.port2.postMessage(null);
    await yieldToEventLoop();
    order.push('yielded');
    expect(order).toEqual(['message', 'yielded']);
  });
});

/** Stores `bytes` in a new slot under the golden save's header, the way an import would. */
async function storeSlot(bytes: Uint8Array, label = 'Golden save'): Promise<string> {
  const { header } = goldenSaveDocument();
  const slot = expectOk(
    await storage.createSlot(label, bytes, header, {
      formatVersion: CURRENT_FORMAT_VERSION,
      engineVersion: ENGINE_VERSION,
      savedAt: '2026-11-01T10:00:00.000Z',
    }),
  );
  return slot.slotId;
}

/** A host with no world, the way the worker starts. */
function emptyHost() {
  const { host } = createInProcessTransport(fakeEngineFactory(), {
    progressIntervalMs: 0,
    savedAtNow: () => '2026-11-08T09:30:00.000Z',
  });
  return host;
}

describe('engine host loadFromSlot', () => {
  beforeEach(async () => {
    await resetSaveDb();
  });

  it('loads a valid save and plays as its human controller', async () => {
    const host = emptyHost();
    const slotId = await storeSlot(await goldenSaveBytes());

    const result = await host.loadFromSlot(slotId, 'latest');

    if (!result.ok) throw new Error(`load failed at ${result.stage}`);
    expect(result.summary.seat.controller).toEqual(goldenHumanController());
    expect(result.summary.label).toBe('Golden save');
    expect(result.summary.promotionName).toBe('Test Promotion A');
    expect(result.summary.gameDate).toBe(goldenGameDate());
    expect(result.summary.migrationsApplied).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(host.isWorldLoaded()).toBe(true);
    expect(host.getSeat()).toEqual(result.summary.seat);
  });

  it('reports a truncated gzip stream at the decode stage', async () => {
    const host = emptyHost();
    const slotId = await storeSlot(await truncatedGoldenSave());

    const result = await host.loadFromSlot(slotId, 'latest');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('decode');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(host.isWorldLoaded()).toBe(false);
  });

  it('reports a schema violation at the validate stage with its path', async () => {
    const host = emptyHost();
    const slotId = await storeSlot(damagedGoldenSave(['header', 'gameDate'], 'yesterday'));

    const result = await host.loadFromSlot(slotId, 'latest');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('validate');
    expect(result.issues.map((issue) => issue.path)).toContain('header.gameDate');
  });

  it('refuses a save from a newer format at the version stage', async () => {
    const host = emptyHost();
    const slotId = await storeSlot(damagedGoldenSave(['formatVersion'], 99));

    const result = await host.loadFromSlot(slotId, 'latest');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('version');
    expect(result.issues[0]?.path).toBe('formatVersion');
  });

  it("checks the simulation's own parts: a malformed rng fails at validate", async () => {
    const host = emptyHost();
    const slotId = await storeSlot(damagedGoldenSave(['state', 'rng', 'streams'], 'not streams'));

    const result = await host.loadFromSlot(slotId, 'latest');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('validate');
    expect(result.issues.some((issue) => issue.path.startsWith('state.rng'))).toBe(true);
  });

  it('reports a missing slot at the storage stage', async () => {
    const host = emptyHost();

    const result = await host.loadFromSlot('no-such-slot', 'latest');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('storage');
    expect(result.storageError?.code).toBe('notFound');
  });

  it('keeps the running game when another save fails to load', async () => {
    const host = emptyHost();
    const goodSlot = await storeSlot(await goldenSaveBytes());
    const badSlot = await storeSlot(damagedGoldenSave(['formatVersion'], 99), 'Broken');
    const loaded = await host.loadFromSlot(goodSlot, 'latest');
    if (!loaded.ok) throw new Error('load failed');

    const failed = await host.loadFromSlot(badSlot, 'latest');

    expect(failed.ok).toBe(false);
    expect(host.isWorldLoaded()).toBe(true);
    expect(host.getSeat()).toEqual(loaded.summary.seat);
  });
});

describe('engine host saving', () => {
  beforeEach(async () => {
    await resetSaveDb();
  });

  it('continues on the same date after a save and a load', async () => {
    const host = emptyHost();
    const slotId = await storeSlot(await goldenSaveBytes());
    const loaded = await host.loadFromSlot(slotId, 'latest');
    if (!loaded.ok) throw new Error('load failed');

    const advance = await host.advanceDays({ maxDays: 1 }, () => undefined);
    if (!advance.ok) throw new Error('advance refused');
    const nextDay: GameDate = addDays(loaded.summary.gameDate, 1);
    const saved = await host.saveToSlot(slotId);
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.slot.header.gameDate).toBe(nextDay);
    expect(saved.slot.header.promotionName).toBe('Test Promotion A');
    expect(saved.slot.updatedAt).toBe('2026-11-08T09:30:00.000Z');
    expect(saved.slot.backups).toHaveLength(1);

    host.unloadWorld();
    expect(host.isWorldLoaded()).toBe(false);
    const reloaded = await host.loadFromSlot(slotId, 'latest');

    if (!reloaded.ok) throw new Error(`reload failed at ${reloaded.stage}`);
    expect(reloaded.summary.gameDate).toBe(nextDay);
  });

  it('loads a backup: the save before the last manual save', async () => {
    const host = emptyHost();
    const slotId = await storeSlot(await goldenSaveBytes());
    const loaded = await host.loadFromSlot(slotId, 'latest');
    if (!loaded.ok) throw new Error('load failed');
    await host.advanceDays({ maxDays: 2 }, () => undefined);
    const saved = await host.saveToSlot(slotId);
    if (!saved.ok) throw new Error(saved.message);

    const backup = await host.loadFromSlot(slotId, 'backup-1');

    if (!backup.ok) throw new Error(`backup failed at ${backup.stage}`);
    expect(backup.summary.gameDate).toBe(goldenGameDate());
  });

  it('creates a slot for a game that was never saved', async () => {
    const host = emptyHost();
    host.installEngine(fakeEngineState());

    const created = await host.createSlot('My new league');

    if (!created.ok) throw new Error(created.message);
    expect(created.slot.label).toBe('My new league');
    expect(created.slot.header.label).toBe('My new league');
    const listed = expectOk(await storage.listSlots());
    expect(listed.map((slot) => slot.slotId)).toEqual([created.slot.slotId]);
  });

  it('cuts a label longer than a save header allows', async () => {
    const host = emptyHost();
    host.installEngine(fakeEngineState());
    const longLabel = `${'A very long imported league name '.repeat(3)}(imported)`;

    const created = await host.createSlot(longLabel);

    if (!created.ok) throw new Error(created.message);
    expect(created.slot.label).toBe(longLabel);
    expect(created.slot.header.label.length).toBeLessThanOrEqual(60);
    const reloaded = await host.loadFromSlot(created.slot.slotId, 'latest');
    expect(reloaded.ok).toBe(true);
  });

  it('writes an autosave that the next latest load picks up', async () => {
    const host = emptyHost();
    const slotId = await storeSlot(await goldenSaveBytes());
    const loaded = await host.loadFromSlot(slotId, 'latest');
    if (!loaded.ok) throw new Error('load failed');
    await host.advanceDays({ maxDays: 3 }, () => undefined);

    const autosaved = await host.autosave(slotId, { monthlyBackup: true });

    if (!autosaved.ok) throw new Error(autosaved.message);
    expect(autosaved.slot.lastAutosaveAt).toBe('2026-11-08T09:30:00.000Z');
    expect(autosaved.slot.backups[0]?.reason).toBe('monthly');
    const reloaded = await host.loadFromSlot(slotId, 'latest');
    if (!reloaded.ok) throw new Error('reload failed');
    expect(reloaded.summary.gameDate).toBe(addDays(loaded.summary.gameDate, 3));
  });

  it('refuses to save with no game loaded, and names a missing slot', async () => {
    const host = emptyHost();
    const nothing = await host.saveToSlot('anything');
    expect(nothing).toEqual({
      ok: false,
      message: 'There is no game loaded to save.',
      storageError: null,
    });

    host.installEngine(fakeEngineState());
    const missing = await host.saveToSlot('no-such-slot');
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.storageError?.code).toBe('notFound');
  });

  it('unloads the world: calls get the noWorld reason and the revision moves on', async () => {
    const host = emptyHost();
    const install = host.installEngine(fakeEngineState());

    const unloaded = host.unloadWorld();

    expect(unloaded.revision).toBeGreaterThan(install.revision);
    expect(host.isWorldLoaded()).toBe(false);
    expect(host.getSeat()).toBeNull();
    const { revision, result } = await host.query('counter.get', {});
    expect(result).toEqual({ ok: false, reasons: [NO_WORLD_REASON] });
    expect(revision).toBe(unloaded.revision);
  });

  it('inspects save bytes for an import', async () => {
    const host = emptyHost();

    const report = await host.inspectSave(await goldenSaveBytes());

    if (!report.ok) throw new Error(`inspect failed at ${report.stage}`);
    expect(report.header.label).toBe('Test save');
    expect(report.formatVersion).toBe(CURRENT_FORMAT_VERSION);
  });
});
