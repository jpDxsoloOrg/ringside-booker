// Node baseline for game/tools/engine-benchmark.sh: the same bundle, new game and year skip as
// RingsideBooker.Engine.EngineBenchmark (C#), so the timings and world hashes can be compared.
//   node game/tools/engine-benchmark-node.mjs [days] [path/to/engine.js]
// Prints one JSON line. See game/docs/runtime.md.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';

const days = Number(process.argv[2] ?? 365);
const bundlePath =
  process.argv[3] ??
  join(dirname(fileURLToPath(import.meta.url)), '../Assets/StreamingAssets/engine/engine.js');

// Keep in step with EngineBenchmark.NewGameJson.
const NEW_GAME = {
  rootPackId: 'default-world',
  seed: 'unity-03-runtime',
  playerName: 'Alex Booker',
  saveName: 'Runtime benchmark',
  seasonLength: { preset: '12m' },
  player: {
    mode: 'found',
    name: 'Runtime Test Wrestling',
    shortName: 'RTW',
    homeRegionKey: 'us-california',
    style: 'traditional',
    size: 'small',
    color: '#335577',
    starterKit: false,
    weeklyShowDay: 3,
  },
  settings: {},
};

// Keep in step with EngineBenchmark.RuntimeCheckScript (C#).
function fingerprint(fn) {
  const view = new DataView(new ArrayBuffer(8));
  let low = 0x811c9dc5 | 0;
  let high = 0;
  for (let i = 1; i <= 20000; i++) {
    view.setFloat64(0, fn(i / 997 + i * 1e-7));
    low = Math.imul(low ^ view.getUint32(0), 16777619);
    high = Math.imul(high ^ view.getUint32(4), 16777619);
  }
  return (low >>> 0).toString(16) + (high >>> 0).toString(16);
}
const runtimeCheck = {
  collation: ['b', 'A', 'a', 'B', '\u00e9', 'e', 'Z']
    .sort((left, right) => left.localeCompare(right, 'en'))
    .join(''),
  pow: fingerprint((value) => Math.pow(value / 7, 1.37)),
  cos: fingerprint(Math.cos),
  log: fingerprint(Math.log),
  sqrt: fingerprint(Math.sqrt),
};

let started = performance.now();
runInThisContext(readFileSync(bundlePath, 'utf8'), { filename: 'engine.js' });
const api = globalThis.RingsideEngine;
const loadMs = performance.now() - started;

started = performance.now();
const created = JSON.parse(api.newGame(JSON.stringify(NEW_GAME)));
const newGameMs = performance.now() - started;
if (!created.ok) throw new Error(`newGame failed: ${JSON.stringify(created)}`);
const hashNewGame = JSON.parse(api.worldHash()).hash;

started = performance.now();
let remaining = days;
let alertsCleared = 0;
while (remaining > 0) {
  const outcome = JSON.parse(
    await api.advanceDays(JSON.stringify({ maxDays: remaining }), () => {}),
  );
  if (!outcome.ok) throw new Error(`advanceDays failed: ${JSON.stringify(outcome)}`);
  remaining -= outcome.daysAdvanced;
  if (outcome.stoppedBy.kind === 'gate') {
    const gates = outcome.stoppedBy.hits.map((hit) => hit.gateId);
    if (gates.some((gate) => gate !== 'news.alert'))
      throw new Error(`stopped at ${gates.join(', ')}`);
    api.command('news.ackAlerts', '{}');
    alertsCleared += 1;
  }
}
const advanceMs = performance.now() - started;

console.log(
  JSON.stringify({
    runtime: `node ${process.version} (V8 ${process.versions.v8})`,
    runtimeCheck,
    loadMs: Math.round(loadMs),
    newGameMs: Math.round(newGameMs),
    days,
    advanceMs: Math.round(advanceMs),
    alertsCleared,
    hashNewGame,
    hashAdvance: JSON.parse(api.worldHash()).hash,
  }),
);
