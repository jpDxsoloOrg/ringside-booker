import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addDays,
  cents,
  defaultSystems,
  defineSystem,
  diffDays,
  MAX_ADVANCE_DAYS,
  registerAiJob,
} from '@ringside/engine';
import type { TunableSetting } from '../src/args';
import { aMatch, anEventInstance, aParticipant } from '@ringside/engine/testing/fixtures';
import {
  doubleBookedRivalShows,
  fixtureState,
  ledgerMismatches,
  openPastShows,
  promotionHistoryProblems,
  readStateFile,
  runSimulation,
  type CompletedRun,
} from '../src/run';
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

/** A phase that moves cash without a ledger row, as a bug that skipped `postMoney` would. */
const cashLeakSystem = defineSystem({
  id: 'testRunner',
  phases: [
    {
      id: 'testRunner.cashLeak',
      group: 'money',
      order: 90,
      cadence: { kind: 'daily' },
      run: (ctx) => {
        const [first] = ctx.read.tables.promotions.values();
        if (first !== undefined) {
          ctx.tx.update('promotions', first.id, { cash: cents(first.cash - 100) });
        }
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
    expect(summary.eventsByType['fatigue.cleared']).toBeGreaterThan(0);
    expect(summary.eventsByType['day.started']).toBe(30);
    expect(summary.worldHash).toMatch(/^[0-9a-f]{16}$/);
    expect(run.advanceCalls).toBe(1);
  });

  it('runs the weekly show every week and leaves no past show open', async () => {
    const run = await completedRun(20, '1', 60);
    expect(run.summary.failuresByStep).toEqual({});
    expect(run.summary.eventsByType['show.completed']).toBeGreaterThanOrEqual(8);
    expect(openPastShows(run.finalState)).toEqual([]);
  });

  it('pays wages every day, and the ledger matches the cash at the end', async () => {
    const start = fixtureState(20, '1');
    const outcome = await runSimulation(start, { days: 40, tunables: [], trace: null });
    if (outcome.kind !== 'completed') throw new Error('the run did not complete');
    const wages = outcome.finalState.world.tables.ledgerEntries.filter(
      (row) => row.category === 'wages',
    );
    // One Wages row a day; rows older than four weeks are rolled into monthly totals (POL4-08),
    // and the cash check counts those totals.
    expect(wages.length).toBeGreaterThanOrEqual(28);
    expect(wages.length).toBeLessThanOrEqual(40);
    expect(
      outcome.finalState.world.tables.promotions.some((row) => row.ledgerMonths.length > 0),
    ).toBe(true);
    expect(ledgerMismatches(start, outcome.finalState)).toEqual([]);
  });

  it('writes the weekly promotion history and keeps it within its retention', async () => {
    const run = await completedRun(20, '1', 60);
    const { promotionHistory } = run.summary;
    // Every open promotion gets a row each Monday: 60 days hold 8 or 9 Mondays.
    expect(promotionHistory.rows).toBeGreaterThanOrEqual(8 * promotionHistory.promotions);
    expect(promotionHistory.mostPerPromotion).toBeLessThanOrEqual(52 + 1);
    expect(promotionHistoryProblems(run.finalState)).toEqual([]);
  });

  it('settles every completed show and counts its crowd', async () => {
    const run = await completedRun(20, '1', 60);
    const { boxOffice } = run.summary;
    expect(boxOffice.settledShows).toBeGreaterThan(0);
    expect(boxOffice.unsettledShows).toBe(0);
    expect(boxOffice.totalAttendance).toBeGreaterThan(0);
  });

  it('reports a computer-run show with someone in two matches', () => {
    const start = fixtureState(20, '1');
    const { tables } = start.world;
    const [promotion] = tables.promotions;
    const [first, second, third] = tables.people;
    if (
      promotion === undefined ||
      first === undefined ||
      second === undefined ||
      third === undefined
    ) {
      throw new Error('the fixture has no promotion or people');
    }
    const show = anEventInstance({ promotionId: promotion.id });
    const opener = aMatch({ eventInstanceId: show.id, slot: 0 });
    const mainEvent = aMatch({ eventInstanceId: show.id, slot: 1 });
    const participants = [
      aParticipant({ segmentId: opener.id, personId: first.id, side: 0 }),
      aParticipant({ segmentId: opener.id, personId: second.id, side: 1 }),
      aParticipant({ segmentId: mainEvent.id, personId: first.id, side: 0 }),
      aParticipant({ segmentId: mainEvent.id, personId: third.id, side: 1 }),
    ];
    const withCard = (kind: 'human' | 'computer') => ({
      ...start,
      world: {
        ...start.world,
        tables: {
          ...tables,
          promotions: [
            {
              ...promotion,
              controller: kind === 'human' ? { kind, playerId: 'cli' } : { kind },
            },
            ...tables.promotions.slice(1),
          ],
          eventInstances: [...tables.eventInstances, show],
          segments: [...tables.segments, opener, mainEvent],
          participants: [...tables.participants, ...participants],
        },
      },
    });
    expect(doubleBookedRivalShows(withCard('computer'))).toEqual([`${show.id}: ${first.id}`]);
    // The player may book whoever they like; the check is about the rival booker.
    expect(doubleBookedRivalShows(withCard('human'))).toEqual([]);
  });

  it('reports a promotion history over its retention', async () => {
    const run = await completedRun(20, '1', 60);
    const tooShort = {
      ...run.finalState,
      tunableOverrides: { 'office.history.fullDetailWeeks': 4 },
    };
    expect(promotionHistoryProblems(tooShort)).toEqual([
      expect.stringMatching(/weekly rows, more than 5$/),
    ]);
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
    // The split is the runner's loop around the engine's real MAX_ADVANCE_DAYS cap, not anything a
    // system does, so this runs the core day loop with no systems: about 40 ms rather than the 2 s
    // that 4000 days of the default systems take (which hit the 5 s timeout under load).
    const outcome = await runSimulation(fixtureState(20, '1'), {
      days: 4000,
      tunables: [],
      trace: null,
      systems: [],
    });
    if (outcome.kind !== 'completed') throw new Error('the run did not complete');
    const run = outcome;
    // 4000 days is more than one call's cap and no more than two.
    expect(MAX_ADVANCE_DAYS).toBeLessThan(4000);
    expect(2 * MAX_ADVANCE_DAYS).toBeGreaterThanOrEqual(4000);
    expect(run.advanceCalls).toBe(2);
    expect(run.summary.daysAdvanced).toBe(4000);
    expect(run.summary.endDate).toBe(addDays(run.summary.startDate, 4000));
    expect(run.summary.eventsByType['day.started']).toBe(4000);
  });

  it('applies --tunable overrides through the tunables command', async () => {
    const run = await completedRun(20, '1', 1, [
      { key: 'health.fatigue.recoveryPerDay', value: 0 },
    ]);
    expect(run.finalState.tunableOverrides).toEqual({ 'health.fatigue.recoveryPerDay': 0 });
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
    // Every RunSummary field and nothing else when neither --check-determinism nor --trace is set.
    expect(Object.keys(report ?? {}).sort()).toEqual(
      [
        'boxOffice',
        'daysAdvanced',
        'daysPerSecond',
        'endDate',
        'eventsByType',
        'failuresByStep',
        'firstFailures',
        'loadIssues',
        'promotionHistory',
        'startDate',
        'stoppedBy',
        'wallMs',
        'worldHash',
      ].sort(),
    );
  });

  it('adds the determinism check to --json output when asked for', async () => {
    const io = captureIo();
    expect(
      await runCli(['--days', '3', '--people', '3', '--json', '--check-determinism'], io),
    ).toBe(EXIT_OK);
    const report: unknown = JSON.parse(io.out());
    expect(report).toMatchObject({ determinism: { match: true, differences: [] } });
  });

  it('prints a stored trace as a tree', async () => {
    const io = captureIo();
    const code = await runCli(
      ['--days', '1', '--people', '3', '--trace', 'health.fatigueRecovery:per_0000000002'],
      io,
    );
    expect(code).toBe(EXIT_OK);
    expect(io.out()).toMatch(/rolled \d in 0\.\.1 \(stream health\.recovery\)/);
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

  it('exits 1 under --strict when a show dated before the end is still open', async () => {
    // Without show night and the day close, nothing runs or closes the weekly show.
    const systems = defaultSystems.map((system) => ({
      ...system,
      phases: system.phases.filter(
        (phase) => phase.id !== 'shows.runShows' && phase.id !== 'calendar.closePastShows',
      ),
    }));
    const io = captureIo();
    const code = await runCli(['--days', '10', '--people', '5', '--strict'], io, { systems });
    expect(code).toBe(EXIT_FAILED);
    expect(io.err()).toMatch(/--strict: 1 show\(s\) dated before 2026-01-15 are still open: evi_/);
  });

  it('exits 1 under --strict when cash moves without a ledger row, naming the promotion', async () => {
    const io = captureIo();
    const code = await runCli(['--days', '3', '--people', '5', '--strict'], io, {
      systems: [...defaultSystems, cashLeakSystem],
    });
    expect(code).toBe(EXIT_FAILED);
    expect(io.err()).toMatch(
      /--strict: the ledger does not match the cash for 1 promotion\(s\):\n {2}pro_\w+: cash moved -?\d+ but its ledger rows add up to -?\d+ \(difference -300 cents\)/,
    );
  });

  it('exits 1 under --strict when a rival job fails, though no step does', async () => {
    const unregister = registerAiJob({
      id: 'testRunner.brokenRivalJob',
      cadence: 'daily',
      run: () => {
        throw new Error('broken rival job');
      },
    });
    try {
      const io = captureIo();
      const code = await runCli(['--days', '1', '--people', '5', '--strict'], io);
      expect(code).toBe(EXIT_FAILED);
      expect(io.err()).toMatch(
        /--strict: events that mean something failed.*\n {2}aip\.jobFailed: \d+/,
      );
      const allowed = captureIo();
      expect(
        await runCli(
          ['--days', '1', '--people', '5', '--strict', '--fail-on-event', 'show.cancelled'],
          allowed,
        ),
      ).toBe(EXIT_OK);
    } finally {
      unregister();
    }
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
