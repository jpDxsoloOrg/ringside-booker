import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, defaultSystems, defineSystem, diffDays } from '@ringside/engine';
import type { TunableSetting } from '../src/args';
import { fixtureState, readStateFile, runSimulation, type CompletedRun } from '../src/run';
import { runCli, EXIT_FAILED, EXIT_GATE, EXIT_OK, EXIT_USAGE, type CliIo } from '../src/cli';

/** A gate that stops every run five days after the world's start date. */
const stopAfterFiveDaysSystem = defineSystem({
  id: 'testRunner',
  gates: [
    {
      id: 'testRunner.stopAfterFiveDays',
      label: 'Stop after five days',
      check: (view, date) =>
        diffDays(view.meta.startDate, date) >= 5
          ? { gateId: 'testRunner.stopAfterFiveDays', reason: 'Five days have passed' }
          : null,
    },
  ],
});

/**
 * A phase that writes a value which is not drawn from the seeded RNG: a counter that keeps going
 * from one run to the next, the way a stray clock read or global would. Two runs from the same
 * start then end in different worlds.
 */
let unseededCounter = 0;
const unseededSystem = defineSystem({
  id: 'testRunner',
  phases: [
    {
      id: 'testRunner.unseeded',
      group: 'housekeeping',
      order: 90,
      cadence: { kind: 'daily' },
      run: (ctx) => {
        const [first] = ctx.read.tables.people.values();
        if (first !== undefined) {
          unseededCounter += 1;
          ctx.tx.update('people', first.id, { fatigue: unseededCounter % 100 });
        }
      },
    },
  ],
});

/** A phase that fails every day. */
const failingSystem = defineSystem({
  id: 'testRunner',
  phases: [
    {
      id: 'testRunner.fail',
      group: 'housekeeping',
      order: 90,
      cadence: { kind: 'daily' },
      run: () => {
        throw new Error('This step always fails');
      },
    },
  ],
});

async function completedRun(
  people: number,
  seed: string,
  days: number,
  tunables: readonly TunableSetting[] = [],
): Promise<CompletedRun> {
  const outcome = await runSimulation(fixtureState(people, seed), { days, tunables, trace: null });
  if (outcome.kind !== 'completed') {
    throw new Error(`The run did not complete: ${JSON.stringify(outcome)}`);
  }
  return outcome;
}

function captureIo(): CliIo & { out: () => string; err: () => string } {
  let out = '';
  let err = '';
  return {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    color: false,
    out: () => out,
    err: () => err,
  };
}

describe('runSimulation on the roster fixture', () => {
  it('runs 30 days on 20 people', async () => {
    const run = await completedRun(20, '1', 30);
    const { summary } = run;
    expect(summary.daysAdvanced).toBe(30);
    expect(summary.endDate).toBe(addDays(summary.startDate, 30));
    expect(summary.stoppedBy).toEqual({ kind: 'completed' });
    expect(summary.failuresByStep).toEqual({});
    expect(summary.eventsByType['condition.fatigueCleared']).toBeGreaterThan(0);
    expect(summary.eventsByType['day.started']).toBe(30);
    expect(summary.worldHash).toMatch(/^[0-9a-f]{16}$/);
    expect(run.advanceCalls).toBe(1);
  });

  it('gives the same world hash for two runs with the same seed', async () => {
    const first = await completedRun(20, '7', 30);
    const second = await completedRun(20, '7', 30);
    expect(second.summary.worldHash).toBe(first.summary.worldHash);
    expect(second.summary.eventsByType).toEqual(first.summary.eventsByType);
  });

  it('gives different world hashes for different seeds', async () => {
    const first = await completedRun(20, '7', 30);
    const second = await completedRun(20, '8', 30);
    expect(second.summary.worldHash).not.toBe(first.summary.worldHash);
  });

  it('splits a 4000-day run into two advanceDays calls', async () => {
    const run = await completedRun(20, '1', 4000);
    expect(run.advanceCalls).toBe(2);
    expect(run.summary.daysAdvanced).toBe(4000);
    expect(run.summary.endDate).toBe(addDays(run.summary.startDate, 4000));
    expect(run.summary.eventsByType['day.started']).toBe(4000);
  });

  it('applies --tunable overrides through the tunables command', async () => {
    const run = await completedRun(20, '1', 1, [
      { key: 'condition.fatigueRecoveryPerDay', value: 0 },
    ]);
    expect(run.finalState.tunableOverrides).toEqual({ 'condition.fatigueRecoveryPerDay': 0 });
    expect(run.finalState.commandLog.entries).toHaveLength(1);
  });

  it('does not change the starting state, so a second run starts from the same place', async () => {
    const start = fixtureState(5, '1');
    const before = JSON.stringify(start);
    await runSimulation(start, { days: 10, tunables: [], trace: null });
    expect(JSON.stringify(start)).toBe(before);
  });
});

describe('runCli', () => {
  let directory = '';

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sim-runner-'));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('exits 0 for a matching determinism check and prints both hashes', async () => {
    const io = captureIo();
    const code = await runCli(
      ['--days', '20', '--people', '10', '--check-determinism', '--strict'],
      io,
    );
    expect(code).toBe(EXIT_OK);
    expect(io.out()).toContain('OK: both runs match');
    expect(io.err()).toBe('');
  });

  it('prints valid JSON with --json', async () => {
    const io = captureIo();
    expect(await runCli(['--days', '5', '--people', '5', '--json'], io)).toBe(EXIT_OK);
    const report: unknown = JSON.parse(io.out());
    expect(report).toMatchObject({ daysAdvanced: 5, stoppedBy: { kind: 'completed' } });
  });

  it('prints a stored trace as a tree', async () => {
    const io = captureIo();
    const code = await runCli(
      ['--days', '1', '--people', '3', '--trace', 'condition.fatigueRecovery:per_0000000002'],
      io,
    );
    expect(code).toBe(EXIT_OK);
    expect(io.out()).toMatch(/rolled \d in 0\.\.1 \(stream condition\.recovery\)/);
  });

  it('exits 2 for bad arguments and for an unreadable world file', async () => {
    const badArgs = captureIo();
    expect(await runCli(['--days', '0'], badArgs)).toBe(EXIT_USAGE);
    expect(badArgs.err()).toContain('--days must be a whole number');

    const missing = captureIo();
    expect(await runCli(['--days', '1', '--world', join(directory, 'none.json')], missing)).toBe(
      EXIT_USAGE,
    );
    expect(missing.err()).toContain('Cannot read');
  });

  it('runs from an exported EngineState file', async () => {
    const first = await completedRun(5, '1', 3);
    const path = join(directory, 'state.json');
    await writeFile(path, JSON.stringify(first.finalState));
    const loaded = await readStateFile(path);
    expect(loaded.ok).toBe(true);

    const io = captureIo();
    expect(await runCli(['--days', '2', '--world', path, '--json'], io)).toBe(EXIT_OK);
    expect(io.out()).toContain(`"startDate": "${first.summary.endDate}"`);
  });

  it('exits 3 when a gate stops the run, and prints the reason', async () => {
    const io = captureIo();
    const code = await runCli(['--days', '30', '--people', '5'], io, {
      systems: [...defaultSystems, stopAfterFiveDaysSystem],
    });
    expect(code).toBe(EXIT_GATE);
    expect(io.out()).toContain('Days advanced    5');
    expect(io.err()).toContain('testRunner.stopAfterFiveDays: Five days have passed');
  });

  it('exits 1 when a phase uses a value that is not seeded', async () => {
    const io = captureIo();
    const code = await runCli(['--days', '3', '--people', '5', '--check-determinism'], io, {
      systems: [...defaultSystems, unseededSystem],
    });
    expect(code).toBe(EXIT_FAILED);
    expect(io.out()).toContain('MISMATCH: the two runs differ');
    expect(io.out()).toContain('world hash:');
    expect(io.err()).toContain('Determinism check failed');
  });

  it('exits 1 under --strict when a step fails', async () => {
    const io = captureIo();
    const code = await runCli(['--days', '2', '--people', '5', '--strict'], io, {
      systems: [...defaultSystems, failingSystem],
    });
    expect(code).toBe(EXIT_FAILED);
    expect(io.out()).toContain('testRunner.fail  2');
    expect(io.err()).toContain('--strict: 2 steps failed');
  });
});
