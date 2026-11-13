/**
 * The save size budget (POL4-06): a year of play on the default world, with every show carded
 * (MTCH3-05's measurement setup, `cardEveryShowSystem`, which is what rival shows look like once
 * AIP4 books them), must save under 10 MB on disk, and save and load in under a second each.
 *
 * Simulating a year of the default world twice takes about a minute, so it only runs with
 * `RB_SLOW_TESTS=1`:
 *   RB_SLOW_TESTS=1 npx vitest run --root ../.. --project engine test/persistence/yearSaveBudget
 * `RB_SAVE_DAYS` changes the length (default 365). Each case prints the size report by table and
 * by trace kind, so a regression shows where the bytes went.
 *
 * Measured 2026-11 on a desktop (365 days, default world), JSON / gzipped, save / load:
 *   before POL4-06: no rival cards 12.66 / 1.20 MB, 0.45 / 0.52 s;
 *                   every show carded 34.58 / 3.04 MB, 1.20 / 1.32 s
 *   after POL4-06:  no rival cards 9.35 / 0.93 MB, 0.43 / 0.48 s;
 *                   every show carded 17.26 / 1.83 MB, 0.77 / 0.71 s
 *   AIP4-05 (rivals book real cards): no rival cards 14.37 / 1.54 MB, 0.50 / 0.83 s;
 *                   every show carded 17.98 / 1.94 MB, 0.59 / 0.77 s
 *   after POL4-08 (history past 28 days rolled up): no rival cards 10.03 / 1.06 MB, 0.40 / 0.74 s;
 *                   every show carded 13.01 / 1.37 MB, 0.44 / 0.98 s
 *   MTCH4-04 (every match tires, wears and teaches; lean physical traces): no rival cards
 *                   10.44 -> 10.96 / 1.15 -> 1.18 MB; every show carded 13.47 -> 14.99 / 1.45 -> 1.59 MB
 * See docs/design/save-format.md#size-budget.
 *
 * The per-commit check in `npm test` is `saveBudget.test.ts` on the roster world.
 */

import { describe, expect, it } from 'vitest';
import { createEngine, engineLoadOptions, engineSaveState } from '../../src/core/api';
import { TABLES } from '../../src/model/tables';
import { encodeSave } from '../../src/persistence/codec';
import { loadSave } from '../../src/persistence/load';
import { createSaveDocument } from '../../src/persistence/world-document';
import { defaultSystems } from '../../src/systems';
import { withMyShowsRun } from '../support';
import { cardEveryShowSystem } from '../support/card-every-show';
import { cpuMsAsync, referenceCpuMs } from '../support/cpu-budget';
import { formatSaveSizeReport, saveSizeReport } from '../support/save-size';
import { startDefaultGame } from '../systems/calendar/default-game';

const SLOW = process.env['RB_SLOW_TESTS'] === '1';
const DAYS = Number(process.env['RB_SAVE_DAYS'] ?? '365');
/** The on-disk (gzipped) budget for a year with every show carded. */
const MAX_GZIP_BYTES = 10 * 1_000_000;
/**
 * With history older than `history.keepDetailDays` rolled up (POL4-08), a carded year must stay
 * well under the 1.94 MB it took before: the tables no longer grow with every show ever run.
 */
const MAX_ROLLED_UP_GZIP_BYTES = 1.6 * 1_000_000;
/**
 * Saving and loading each take under a second on a desktop (about 20 runs of the CPU reference
 * workload); this allows double. A ratio, not milliseconds: the engine's test threads share one
 * process and `process.cpuUsage()` counts them all, so only a ratio against the reference holds.
 */
const MAX_SAVE_OR_LOAD_REFERENCES = 40;
/** Generous: a busy machine runs the default world several times slower. */
const TIMEOUT_MS = 120_000 + DAYS * 3_000;

async function measureYear(carded: boolean): Promise<{ gzipBytes: number; jsonBytes: number }> {
  const systems = carded ? [...defaultSystems, cardEveryShowSystem] : [...defaultSystems];
  const engine = createEngine({ state: startDefaultGame(), systems: withMyShowsRun(systems) });
  const advanced = await engine.advanceDays({ maxDays: DAYS });
  expect(advanced.failures).toEqual([]);

  const state = engine.exportState();
  const extras = { headerPromotionId: null, savedAt: '2026-11-08T12:00:00.000Z', label: 'Year' };
  // CPU time, not wall time, so a machine busy with other test workers does not fail it. It counts
  // the garbage collector's and gzip's helper threads too, so it reads 1.3-2x the wall time
  // (the save / load figures in the header are wall time).
  const before = referenceCpuMs();
  const doc = createSaveDocument(engineSaveState(state), { ...extras, engineVersion: '0.1.0' });
  let bytes: Uint8Array = new Uint8Array();
  const saveMs = await cpuMsAsync(async () => {
    bytes = await encodeSave(doc);
  });
  let loadedOk = false;
  const loadMs = await cpuMsAsync(async () => {
    loadedOk = (await loadSave(bytes, TABLES, engineLoadOptions())).ok;
  });
  const referenceMs = (before + referenceCpuMs()) / 2;
  expect(loadedOk).toBe(true);

  const report = await saveSizeReport(doc);
  console.log(
    `${String(DAYS)} days, ${carded ? 'every show carded' : 'no rival cards'}: save ${saveMs.toFixed(0)} ms, load ${loadMs.toFixed(0)} ms (reference ${referenceMs.toFixed(0)} ms)\n${formatSaveSizeReport(report)}`,
  );
  expect(saveMs / referenceMs).toBeLessThan(MAX_SAVE_OR_LOAD_REFERENCES);
  expect(loadMs / referenceMs).toBeLessThan(MAX_SAVE_OR_LOAD_REFERENCES);
  return report;
}

describe.runIf(SLOW)(`a ${String(DAYS)}-day default-world save`, () => {
  it('stays under the budget with no rival cards', { timeout: TIMEOUT_MS }, async () => {
    const report = await measureYear(false);
    expect(report.gzipBytes).toBeLessThan(MAX_GZIP_BYTES);
  });

  it('stays under 10 MB on disk with every show carded', { timeout: TIMEOUT_MS }, async () => {
    const report = await measureYear(true);
    expect(report.gzipBytes).toBeLessThan(MAX_GZIP_BYTES);
    expect(report.gzipBytes).toBeLessThan(MAX_ROLLED_UP_GZIP_BYTES);
  });
});
