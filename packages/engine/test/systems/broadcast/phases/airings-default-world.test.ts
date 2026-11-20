// Airing settlement on the shipped default world (ECO8-04): a week as Altura airs Mainstage and
// Overclock inside ECO8-02's calibration bands, pays them as TV rights with a Why?, airs the rivals'
// weekly shows that have deals, and nothing for Hardpan. Design: docs/design/broadcast.md#settlement
import { beforeAll, describe, expect, it } from 'vitest';
import { createEngine, type Engine, type Viewer } from '../../../../src/core/api';
import { addDays, parseGameDate } from '../../../../src/core/date';
import type { PromotionId } from '../../../../src/core/ids';
import {
  countTraceNodes,
  isFullTrace,
  TRACE_MAX_DEPTH,
  TRACE_MAX_NODES,
  traceDepth,
} from '../../../../src/core/trace';
import type { TraceRef } from '../../../../src/core/trace/store';
import type { SerializedTables } from '../../../../src/persistence/save-document';
import { defaultSystems } from '../../../../src/systems';
import { AIRING_TRACE_KIND, RIVAL_AIRING_TRACE_KIND } from '../../../../src/systems/broadcast';
import { withMyShowsRun } from '../../../support';
import { cardEveryShowSystem } from '../../../support/card-every-show';
import { expectTraceReplays } from '../../../support/trace';
import { startDefaultGame } from '../../calendar/default-game';

const PLAYER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: 'local-player' },
};

let engine: Engine;
let tables: SerializedTables;

beforeAll(async () => {
  engine = createEngine({
    state: startDefaultGame(),
    systems: withMyShowsRun([...defaultSystems, cardEveryShowSystem]),
  });
  const advanced = await engine.advanceDays({ maxDays: 7 });
  expect(advanced.failures).toEqual([]);
  tables = engine.exportState().world.tables;
}, 60_000);

function promotionNamed(prefix: string): PromotionId {
  const found = tables.promotions.find((row) => row.name.startsWith(prefix));
  if (found === undefined) throw new Error(`No promotion named ${prefix}`);
  return found.id;
}

function airingNamed(showName: string) {
  const found = tables.airings.find((row) => row.showName === showName);
  if (found === undefined) throw new Error(`No airing of ${showName}`);
  return found;
}

/** The full stored trace at `ref`, as the player's Why? reads it. */
function storedTrace(ref: TraceRef | null) {
  if (ref === null) throw new Error('No trace ref');
  const stored = engine.query('trace.get', { ref }, PLAYER);
  if (!stored.ok || stored.data === null || !isFullTrace(stored.data)) {
    throw new Error(`No full trace at ${ref.kind}/${ref.id}`);
  }
  return stored.data;
}

describe('a week of airings on the default world', () => {
  it('airs Mainstage on 4 Jan and Overclock on 6 Jan inside the calibration bands', () => {
    const start = parseGameDate('2027-01-04');
    const mainstage = airingNamed('Mayhem Monday');
    expect(mainstage.airDate).toBe(start);
    expect(mainstage.status).toBe('aired');
    expect(mainstage.quality?.source).toBe('show');
    expect(mainstage.viewers).toBeGreaterThanOrEqual(1_500_000);
    expect(mainstage.viewers).toBeLessThanOrEqual(4_000_000);
    expect(mainstage.viewers).toBeGreaterThanOrEqual(mainstage.expectedViewers);

    const overclock = airingNamed('Warzone Wednesday');
    expect(overclock.airDate).toBe(addDays(start, 2));
    expect(overclock.viewers).toBeGreaterThanOrEqual(overclock.expectedViewers);
  });

  it("pays Altura's two airings as TV rights, each with a Why? that resolves and replays", () => {
    const altura = promotionNamed('Szn League');
    const income = tables.ledgerEntries.filter(
      (row) => row.promotionId === altura && row.category === 'broadcast',
    );
    expect(income.map((row) => row.memo).sort()).toEqual([
      'Broadcast: Mayhem Monday on National Signal Network',
      'Broadcast: Warzone Wednesday on Kestrel Sports',
    ]);
    for (const row of income) {
      expectTraceReplays({ value: row.amount, trace: storedTrace(row.traceRef).trace });
    }
    const airings = tables.airings.filter((row) => row.promotionId === altura);
    expect(airings).toHaveLength(2);
    for (const airing of airings) {
      expect(airing.traceRef?.kind).toBe(AIRING_TRACE_KIND);
      const stored = storedTrace(airing.traceRef);
      // The audience working fits inside the trace limits.
      expect(countTraceNodes(stored.trace)).toBeLessThanOrEqual(TRACE_MAX_NODES);
      expect(traceDepth(stored.trace)).toBeLessThanOrEqual(TRACE_MAX_DEPTH);
      expect(JSON.stringify(stored.trace)).toContain('Airtime');
      expectTraceReplays({ value: Number(stored.value), trace: stored.trace });
    }
    const summary = engine.query('broadcast.incomeSummary', { promotionId: altura }, PLAYER);
    if (!summary.ok) throw new Error('No income summary');
    expect(summary.data.total).toBe(
      tables.ledgerEntries
        .filter((row) => row.promotionId === altura && row.refs.dealId !== null)
        .reduce((sum, row) => sum + row.amount, 0),
    );
    expect(summary.data.lastAiring?.showName).toBe('Warzone Wednesday');
    // A week into the game nothing has been rolled up, so the card has no "details kept" note.
    expect(summary.data.note).toBeNull();
  });

  it("airs the rivals' weekly shows that have deals, and nothing for Hardpan", () => {
    const rival = tables.airings.filter((row) => row.traceRef?.kind === RIVAL_AIRING_TRACE_KIND);
    expect(rival.length).toBeGreaterThanOrEqual(3);
    expect(rival.every((row) => row.status === 'aired' && row.quality?.source === 'show')).toBe(
      true,
    );
    const hardpan = promotionNamed('Hardpan');
    expect(tables.airings.filter((row) => row.promotionId === hardpan)).toEqual([]);
  });
});
