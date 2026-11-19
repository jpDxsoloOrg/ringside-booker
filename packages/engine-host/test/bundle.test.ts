/**
 * Drives the built engine bundle the way the Unity game's embedded runtime will: the file's text is
 * evaluated in a fresh `vm` context that has only the JavaScript built-ins (no `console`, no
 * `TextEncoder`, no timers, no `require`, no DOM), and every call goes through the JSON API on
 * `globalThis.RingsideEngine`.
 *
 * It starts a default-world game, plays 30 days (clearing the news alerts that stop the advance, a
 * command), reads the clock (a query), saves, loads the save into a second runtime, and checks the
 * simulation is deterministic: the same seed and choices give the same world hash, and the
 * reloaded game carries on exactly like the original.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { worldHash } from '@ringside/engine';
import type { EngineState } from '@ringside/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BUILD_SCRIPT = fileURLToPath(new URL('../scripts/build-bundle.mjs', import.meta.url));

/** The API as the test calls it: JSON strings in and out. */
interface BundleApi {
  info(): string;
  listWorlds(): string;
  newGame(optionsJson: string): string;
  load(save: string): Promise<string>;
  save(optionsJson?: string): Promise<string>;
  query(name: string, argsJson?: string, viewerJson?: string): string;
  command(name: string, argsJson?: string): string;
  advanceDays(optionsJson: string, onProgress?: (progressJson: string) => unknown): Promise<string>;
  worldHash(): string;
  exportState(): string;
}

interface AdvanceOutcome {
  readonly ok: boolean;
  readonly daysAdvanced: number;
  readonly endDate: string;
  readonly stoppedBy: {
    readonly kind: string;
    readonly hits?: readonly { readonly gateId: string; readonly reason: string }[];
  };
  readonly failures: readonly unknown[];
}

interface Progress {
  readonly daysDone: number;
  readonly daysRequested: number;
  readonly currentDate: string;
}

const NEW_GAME = {
  rootPackId: 'default-world',
  seed: 'unity-02-bundle',
  playerName: 'Alex Booker',
  saveName: 'Bundle test',
  seasonLength: { preset: '12m' },
  // A founded promotion with no starter show, so no show of the player's needs booking in 30 days.
  player: {
    mode: 'found',
    name: 'Bundle Test Wrestling',
    shortName: 'BTW',
    homeRegionKey: 'us-california',
    style: 'traditional',
    size: 'small',
    color: '#335577',
    starterKit: false,
    weeklyShowDay: 3,
  },
  settings: {},
};

let bundleDir = '';
let bundleText = '';

/** Reads a JSON result as the shape game/docs/engine-host.md promises; the asserts check it. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a typed JSON read
function parse<T>(json: string): T {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON from the bundle
  return JSON.parse(json) as T;
}

/**
 * The world hash of the bundle's running game, worked out here from `exportState()`. The bundle's
 * own `worldHash()` gives the same value (checked once below), but every global lookup inside a
 * `vm` context goes through Node's context proxy, which makes hashing a whole world there take
 * seconds; an embedded runtime has no such proxy.
 */
function hashOf(api: BundleApi): string {
  const exported = parse<{ ok: boolean; state: EngineState }>(api.exportState());
  expect(exported.ok).toBe(true);
  return worldHash(exported.state);
}

/** Evaluates the bundle in a context with nothing but the language built-ins. */
function loadBundle(): BundleApi {
  const context = createContext({});
  runInContext(bundleText, context, { filename: 'engine.js' });
  const api: unknown = runInContext('globalThis.RingsideEngine', context);
  expect(api).toBeTypeOf('object');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the bundle's global
  return api as BundleApi;
}

/**
 * Advances `days` days, acknowledging news alerts when one stops the day loop. Any other stop
 * fails the test. Returns every progress report.
 */
async function playDays(api: BundleApi, days: number): Promise<Progress[]> {
  const progress: Progress[] = [];
  let remaining = days;
  while (remaining > 0) {
    const outcome = parse<AdvanceOutcome>(
      await api.advanceDays(JSON.stringify({ maxDays: remaining }), (json) => {
        progress.push(parse<Progress>(json));
      }),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.failures).toEqual([]);
    remaining -= outcome.daysAdvanced;
    if (outcome.stoppedBy.kind === 'gate') {
      const gateIds = (outcome.stoppedBy.hits ?? []).map((hit) => hit.gateId);
      expect(gateIds).toEqual(['news.alert']);
      const ack = parse<{ result: { ok: boolean; data: { cleared: boolean } } }>(
        api.command('news.ackAlerts', '{}'),
      );
      expect(ack.result.ok).toBe(true);
      expect(ack.result.data).toEqual({ cleared: true });
    } else {
      expect(outcome.stoppedBy.kind).toBe('completed');
    }
  }
  return progress;
}

function startGame(api: BundleApi): void {
  const created = parse<{ ok: boolean; reasons?: unknown }>(api.newGame(JSON.stringify(NEW_GAME)));
  expect(created.reasons).toBeUndefined();
  expect(created.ok).toBe(true);
}

beforeAll(() => {
  bundleDir = mkdtempSync(join(tmpdir(), 'ringside-engine-bundle-'));
  execFileSync(process.execPath, [BUILD_SCRIPT, '--outfile', join(bundleDir, 'engine.js')]);
  bundleText = readFileSync(join(bundleDir, 'engine.js'), 'utf8');
}, 120_000);

afterAll(() => {
  if (bundleDir !== '') rmSync(bundleDir, { recursive: true, force: true });
});

describe('the embedded engine bundle', () => {
  it('is one script with a source map and no module syntax', () => {
    expect(statSync(join(bundleDir, 'engine.js.map')).size).toBeGreaterThan(0);
    expect(bundleText).not.toMatch(/^\s*(import|export)\s/m);
  });

  it('runs a default-world game in a bare runtime, saves, reloads and stays deterministic', async () => {
    const first = loadBundle();
    const info = parse<{ engineVersion: string; shims: string[]; worldLoaded: boolean }>(
      first.info(),
    );
    expect(info.shims).toEqual(['TextEncoder', 'TextDecoder']);
    expect(info.worldLoaded).toBe(false);

    const worlds = parse<{ packs: { id: string }[]; issues: unknown[] }>(first.listWorlds());
    expect(worlds.packs.map((pack) => pack.id)).toContain('default-world');
    expect(worlds.issues).toEqual([]);

    startGame(first);
    const progress = await playDays(first, 30);
    expect(progress).toHaveLength(30);
    expect(progress.at(-1)?.currentDate).toBe('2027-02-03');

    const clock = parse<{ result: { ok: boolean; data: { date: string; dayNumber: number } } }>(
      first.query('clock.get', '{}'),
    );
    expect(clock.result.ok).toBe(true);
    expect(clock.result.data).toMatchObject({ date: '2027-02-03', dayNumber: 31 });
    const hashAfter30 = hashOf(first);
    expect(parse<{ hash: string }>(first.worldHash()).hash).toBe(hashAfter30);

    // The same seed and choices in a second runtime give the same world.
    const replay = loadBundle();
    startGame(replay);
    await playDays(replay, 30);
    expect(hashOf(replay)).toBe(hashAfter30);

    // A save loads into a third runtime as the same world, and both carry on alike.
    const saved = parse<{ ok: boolean; base64: string; byteLength: number }>(
      await first.save(
        JSON.stringify({ label: 'Bundle test', savedAt: '2026-11-19T00:00:00.000Z' }),
      ),
    );
    expect(saved.ok).toBe(true);
    expect(saved.byteLength).toBeGreaterThan(0);
    const reloaded = loadBundle();
    const loaded = parse<{ ok: boolean; summary: { gameDate: string } }>(
      await reloaded.load(saved.base64),
    );
    expect(loaded.ok).toBe(true);
    expect(loaded.summary.gameDate).toBe('2027-02-03');
    expect(hashOf(reloaded)).toBe(hashAfter30);

    await playDays(first, 5);
    await playDays(reloaded, 5);
    expect(hashOf(reloaded)).toBe(hashOf(first));
  });

  it('answers bad calls with reasons instead of throwing', async () => {
    const api = loadBundle();
    expect(
      parse<{ ok: boolean; reasons: { code: string }[] }>(api.query('clock.get')).reasons[0]?.code,
    ).toBe('noWorld');
    expect(parse<{ reasons: { code: string }[] }>(api.newGame('{not json')).reasons[0]?.code).toBe(
      'invalidArgs',
    );
    const badLoad = parse<{ ok: boolean; stage?: string }>(await api.load('bm90IGEgc2F2ZQ=='));
    expect(badLoad.ok).toBe(false);
    expect(badLoad.stage).toBe('decode');
  });
});
