/**
 * The per-commit save size check (POL4-06): three months of the roster world with every show
 * carded, the cheap stand-in for the year-long default-world budget in `yearSaveBudget.test.ts`
 * (which runs with `RB_SLOW_TESTS=1`). It checks the trace store holds every kind to its size
 * budget, that a rival's breakdowns are kept only as summaries, and that the save stays small and
 * loads.
 */

import { describe, expect, it } from 'vitest';
import {
  createEngine,
  engineLoadOptions,
  engineSaveState,
  initialEngineState,
} from '../../src/core/api';
import { createEngineTunables } from '../../src/systems/tunables';
import { TABLES } from '../../src/model/tables';
import { encodeSave } from '../../src/persistence/codec';
import { loadSave } from '../../src/persistence/load';
import { createSaveDocument } from '../../src/persistence/world-document';
import { defaultSystems } from '../../src/systems';
import { RIVAL_LEDGER_ENTRY_TRACE_KIND } from '../../src/systems/finance';
import { withMyShowsRun } from '../support';
import { cardEveryShowSystem } from '../support/card-every-show';
import { formatSaveSizeReport, saveSizeReport } from '../support/save-size';
import { rosterWorld } from '../support/worlds';

const DAYS = 91;
const MAX_GZIP_BYTES = 1_000_000;

describe('save size budget on the roster world', () => {
  it(
    `keeps ${String(DAYS)} carded days within the trace budgets and under 1 MB on disk`,
    { timeout: 120_000 },
    async () => {
      const { world } = rosterWorld(300);
      const engine = createEngine({
        state: initialEngineState(world),
        systems: withMyShowsRun([...defaultSystems, cardEveryShowSystem]),
      });
      const advanced = await engine.advanceDays({ maxDays: DAYS });
      expect(advanced.failures).toEqual([]);

      const state = engine.exportState();
      const doc = createSaveDocument(engineSaveState(state), {
        headerPromotionId: null,
        savedAt: '2026-11-08T12:00:00.000Z',
        label: 'Budget',
        engineVersion: '0.1.0',
      });
      const report = await saveSizeReport(doc);
      console.log(formatSaveSizeReport(report, 8));

      const budget = createEngineTunables().get('sim.traceBytesPerKind');
      for (const line of report.fullTraces) {
        // The report counts the UTF-8 bytes the store counts as characters; names are ASCII here.
        expect(line.bytes, line.name).toBeLessThanOrEqual(budget);
      }
      expect(report.fullTraces.map((line) => line.name)).not.toContain(
        RIVAL_LEDGER_ENTRY_TRACE_KIND,
      );
      expect(report.traceSummaries.map((line) => line.name)).toContain(
        RIVAL_LEDGER_ENTRY_TRACE_KIND,
      );
      expect(report.gzipBytes).toBeLessThan(MAX_GZIP_BYTES);
      expect((await loadSave(await encodeSave(doc), TABLES, engineLoadOptions())).ok).toBe(true);
    },
  );
});
