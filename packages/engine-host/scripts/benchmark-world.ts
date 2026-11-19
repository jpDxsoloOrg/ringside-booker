/**
 * Day-speed benchmark for big worlds (POL4-12): starts a game on the default world, or on a
 * workshop world mod imported through the host's converter, skips N days clearing every stop the
 * way the benchmarks do, and prints the time with the slowest phases and reactions.
 *
 *   npx tsx packages/engine-host/scripts/benchmark-world.ts [--days 90] [--db <path to mod .db>]
 *     [--top 25] [--slow] [--no-phases] [--json] [--speed full|fast] [--tunable key=number ...]
 *
 * `--db` reads a mod database from the local disk (nothing from a mod is ever committed); without
 * it the default world is used. `--slow` turns the engine's fast paths off, for comparison;
 * `--no-phases` leaves the per-phase timing map off, for the cleanest total. `--speed` picks the
 * Big world speed setting (POL4-13): `full` (the default) or `fast`; `--tunable` overrides a number
 * tunable at new game (for example `bigWorld.regionPopularity=40`).
 * Run it under `node --cpu-prof` (via `npx tsx --cpu-prof` is not supported: use
 * `node --cpu-prof --import tsx packages/engine-host/scripts/benchmark-world.ts ...`) for a V8 profile.
 * Prints counts and timings only, never names from the mod.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { startPhaseTiming, stopPhaseTiming } from '@ringside/engine';
import { setFastPaths } from '../../engine/src/core/fastPaths';
import initSqlJs from 'sql.js';
import { createEmbeddedHost } from '../src/host';

const CONTENT_ROOT = fileURLToPath(new URL('../../../content', import.meta.url));

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const days = Number(argValue('--days') ?? 90);
const dbPath = argValue('--db');
const top = Number(argValue('--top') ?? 25);
const asJson = process.argv.includes('--json');
const speed = argValue('--speed') ?? 'full';
if (speed !== 'full' && speed !== 'fast') throw new Error('--speed must be full or fast');
/** `--tunable key=value` (repeatable): number overrides set at new game, e.g. for tuning. */
const overrides: Record<string, number> = {};
process.argv.forEach((arg, index) => {
  if (arg !== '--tunable') return;
  const [key, value] = (process.argv[index + 1] ?? '').split('=');
  if (key === undefined || value === undefined || !Number.isFinite(Number(value))) {
    throw new Error('--tunable takes key=number');
  }
  overrides[key] = Number(value);
});
if (process.argv.includes('--slow')) setFastPaths(false);

function readContent(): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.json')) {
        files[relative(CONTENT_ROOT, path).split(sep).join('/')] = JSON.parse(
          readFileSync(path, 'utf8'),
        ) as unknown;
      }
    }
  };
  walk(CONTENT_ROOT);
  return files;
}

async function readTables(path: string): Promise<Record<string, Record<string, unknown>[]>> {
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(path));
  const tables: Record<string, Record<string, unknown>[]> = {};
  const names = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  for (const [name] of names[0]?.values ?? []) {
    if (typeof name !== 'string') continue;
    const result = db.exec(`SELECT * FROM "${name}"`)[0];
    tables[name] =
      result === undefined
        ? []
        : result.values.map((values) =>
            Object.fromEntries(result.columns.map((column, index) => [column, values[index]])),
          );
  }
  db.close();
  return tables;
}

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A field of a host answer that is itself an object ({} when it is missing). */
function field(value: unknown, key: string): Json {
  const inner = isJson(value) ? value[key] : undefined;
  return isJson(inner) ? inner : {};
}

function parse(json: string): Json {
  const value: unknown = JSON.parse(json);
  if (!isJson(value)) throw new Error(`not a JSON object: ${json.slice(0, 80)}`);
  return value;
}

const host = createEmbeddedHost({ content: readContent() });
let rootPackId = 'default-world';
let importMs = 0;
if (dbPath !== undefined) {
  const started = performance.now();
  const imported = parse(
    host.importWorldMod(JSON.stringify({ tables: await readTables(dbPath), rosterOnly: true })),
  );
  importMs = performance.now() - started;
  if (imported['ok'] !== true) throw new Error(`import failed at ${String(imported['stage'])}`);
  rootPackId = String(field(imported, 'manifest')['id']);
}

let started = performance.now();
const created = parse(
  host.newGame(
    JSON.stringify({
      rootPackId,
      seed: 'pol4-12-benchmark',
      playerName: 'Alex Booker',
      saveName: 'Benchmark',
      seasonLength: { preset: '12m' },
      player: {
        mode: 'found',
        name: 'Benchmark Wrestling',
        shortName: 'BMW',
        homeRegionKey: 'us-california',
        style: 'traditional',
        size: 'small',
        color: '#335577',
        starterKit: false,
        weeklyShowDay: 3,
      },
      settings: speed === 'full' ? {} : { bigWorldSpeed: speed },
      ...(Object.keys(overrides).length === 0 ? {} : { tunableOverrides: overrides }),
    }),
  ),
);
const newGameMs = performance.now() - started;
if (created['ok'] !== true)
  throw new Error(`newGame failed: ${JSON.stringify(created['reasons'])}`);
const exported = parse(host.exportState());
const tables = field(field(exported, 'state'), 'world')['tables'];
const counts = Object.fromEntries(
  ['people', 'promotions', 'employments', 'titles', 'eventInstances', 'regions', 'countries'].map(
    (name) => {
      const rows = isJson(tables) ? tables[name] : undefined;
      return [name, Array.isArray(rows) ? rows.length : 0];
    },
  ),
);

const timePhases = !process.argv.includes('--no-phases');
if (timePhases) startPhaseTiming(() => performance.now());
const cpuBefore = process.cpuUsage();
started = performance.now();
let remaining = days;
const stops: Record<string, number> = {};
while (remaining > 0) {
  const outcome = parse(await host.advanceDays(JSON.stringify({ maxDays: remaining })));
  if (outcome['ok'] !== true) throw new Error(`advanceDays failed: ${JSON.stringify(outcome)}`);
  const advanced = Number(outcome['daysAdvanced']);
  remaining -= advanced;
  const stoppedBy = field(outcome, 'stoppedBy');
  if (stoppedBy['kind'] !== 'gate') continue;
  const hits = Array.isArray(stoppedBy['hits']) ? (stoppedBy['hits'] as unknown[]) : [];
  const gates = hits.map((hit) => String(isJson(hit) ? hit['gateId'] : hit));
  for (const gate of gates) stops[gate] = (stops[gate] ?? 0) + 1;
  if (gates.every((gate) => gate === 'news.alert')) {
    host.command('news.ackAlerts', '{}');
  } else if (advanced === 0) {
    throw new Error(`stuck at ${gates.join(', ')}`);
  }
}
const advanceMs = performance.now() - started;
const cpu = process.cpuUsage(cpuBefore);
const phases = timePhases ? stopPhaseTiming() : [];
const hash = String(parse(host.worldHash())['hash']);

const summary = {
  world: dbPath === undefined ? 'default' : 'imported',
  fastPaths: !process.argv.includes('--slow'),
  speed,
  counts,
  importMs: Math.round(importMs),
  newGameMs: Math.round(newGameMs),
  days,
  advanceMs: Math.round(advanceMs),
  advanceCpuMs: Math.round((cpu.user + cpu.system) / 1000),
  msPerDay: Math.round((advanceMs / days) * 10) / 10,
  stops,
  hash,
  phases: phases.slice(0, top).map((entry) => ({
    id: entry.id,
    ms: Math.round(entry.ms),
    share: `${((entry.ms / advanceMs) * 100).toFixed(1)}%`,
    calls: entry.calls,
  })),
};
if (asJson) console.log(JSON.stringify(summary));
else {
  const { phases: list, ...rest } = summary;
  console.log(JSON.stringify(rest, null, 2));
  console.table(list);
}
