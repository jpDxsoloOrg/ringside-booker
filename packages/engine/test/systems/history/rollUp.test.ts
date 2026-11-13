// The history roll-up (POL4-08): the last `history.keepDetailDays` days in detail, older play as
// totals, and no current number touched.
// Design: docs/design/save-format.md#history-retention
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  engineLoadOptions,
  engineSaveState,
  initialEngineState,
  OMNISCIENT_VIEWER,
  type Engine,
} from '../../../src/core/api';
import type { SystemBundle } from '../../../src/core/api/system';
import { addDays, compareDates, weekday, yearMonthOf, type GameDate } from '../../../src/core/date';
import { TABLES } from '../../../src/model/tables';
import { encodeSave } from '../../../src/persistence/codec';
import { loadSave } from '../../../src/persistence/load';
import type { SerializedTables } from '../../../src/persistence/save-document';
import { createSaveDocument } from '../../../src/persistence/world-document';
import { defaultSystems } from '../../../src/systems';
import {
  detailKeptFrom,
  detailKeptNoteFor,
  historySystem,
  keepDetailPeriodText,
} from '../../../src/systems/history';
import { withMyShowsRun } from '../../support';
import { cardEveryShowSystem } from '../../support/card-every-show';
import { rosterWorld } from '../../support/worlds';

const DAYS = 70;
const KEEP = 28;

async function run(systems: readonly SystemBundle[]): Promise<Engine> {
  const { world } = rosterWorld(60);
  const engine = createEngine({
    state: initialEngineState(world),
    systems: withMyShowsRun([...systems, cardEveryShowSystem]),
  });
  const advanced = await engine.advanceDays({ maxDays: DAYS });
  expect(advanced.failures).toEqual([]);
  return engine;
}

/** Each promotion's money by month and category: rows plus rolled-up totals. */
function moneyByMonth(tables: SerializedTables): Map<string, number> {
  const totals = new Map<string, number>();
  const add = (key: string, amount: number): void => {
    totals.set(key, (totals.get(key) ?? 0) + amount);
  };
  for (const row of tables.ledgerEntries) {
    add(`${row.promotionId}|${yearMonthOf(row.date)}|${row.category}`, row.amount);
  }
  for (const promotion of tables.promotions) {
    for (const month of promotion.ledgerMonths) {
      for (const [category, amount] of Object.entries(month.byCategory)) {
        add(`${promotion.id}|${month.month}|${category}`, amount);
      }
    }
  }
  return totals;
}

/** The last Monday on or before `date`: the day the newest roll-up ran. */
function lastMonday(date: GameDate): GameDate {
  let day = date;
  while (weekday(day) !== 0) {
    day = addDays(day, -1);
  }
  return day;
}

describe('history.rollUp', () => {
  it('changes no current number: a run without it ends the same', { timeout: 60_000 }, async () => {
    const rolled = (await run(defaultSystems)).exportState().world.tables;
    const kept = (
      await run(defaultSystems.filter((system) => system.id !== historySystem.id))
    ).exportState().world.tables;

    const withoutRollUp = (rows: SerializedTables['promotions']) =>
      rows.map((row) => ({ ...row, ledgerMonths: [] }));
    expect(withoutRollUp(rolled.promotions)).toEqual(withoutRollUp(kept.promotions));
    expect(rolled.people).toEqual(kept.people);
    expect(rolled.employments).toEqual(kept.employments);
    expect(rolled.titles).toEqual(kept.titles);
    expect(rolled.titleReigns).toEqual(kept.titleReigns);
    // Aftermaths before the window keep only the show region's change, which Recent form reads.
    const showRegionOnly = (rows: SerializedTables['aftermaths']) =>
      rows.map((row) => {
        const shown = row.popularity.byRegion[row.showRegionId];
        return {
          ...row,
          popularity: {
            ...row.popularity,
            byRegion: shown === undefined ? {} : { [row.showRegionId]: shown },
          },
        };
      });
    expect(showRegionOnly(rolled.aftermaths)).toEqual(showRegionOnly(kept.aftermaths));
    expect(JSON.stringify(rolled.aftermaths).length).toBeLessThan(
      JSON.stringify(kept.aftermaths).length,
    );
    expect(rolled.storylines).toEqual(kept.storylines);
    const withoutHistory = (rows: SerializedTables['eventInstances']) =>
      rows.map((row) =>
        row.result === null ? row : { ...row, result: { ...row.result, history: undefined } },
      );
    expect(withoutHistory(rolled.eventInstances)).toEqual(withoutHistory(kept.eventInstances));
    // Money by month and category adds up the same, from rows or from rolled-up totals.
    expect(moneyByMonth(rolled)).toEqual(moneyByMonth(kept));
    // And the save really is smaller.
    expect(rolled.segments.length).toBeLessThan(kept.segments.length);
    expect(rolled.participants.length).toBeLessThan(kept.participants.length);
    expect(rolled.ledgerEntries.length).toBeLessThan(kept.ledgerEntries.length);
    expect(rolled.popularityShowChanges.length).toBeLessThan(kept.popularityShowChanges.length);
  });

  it('keeps only the window in detail, summarises older shows and still loads', async () => {
    const engine = await run(defaultSystems);
    const state = engine.exportState();
    const { tables } = state.world;
    // `currentDate` is the next day to run; the newest roll-up ran on the Monday before it.
    const from = detailKeptFrom(lastMonday(addDays(state.world.meta.currentDate, -1)), KEEP);

    expect(tables.ledgerEntries.every((row) => compareDates(row.date, from) >= 0)).toBe(true);
    expect(tables.popularityShowChanges.every((row) => compareDates(row.date, from) >= 0)).toBe(
      true,
    );
    const old = tables.eventInstances.filter(
      (show) => show.status === 'completed' && compareDates(show.date, from) < 0,
    );
    expect(old.length).toBeGreaterThan(0);
    for (const show of old) {
      expect(show.result?.history, show.id).toBeDefined();
    }
    for (const promotion of tables.promotions) {
      expect(promotion.ledgerMonths.length, promotion.id).toBeGreaterThan(0);
    }

    // The results page of an old show: a summary and a plain note, no card, never "off-screen".
    const [first] = old;
    if (first === undefined) throw new Error('no old show');
    const results = engine.query('shows.results', { eventInstanceId: first.id }, OMNISCIENT_VIEWER);
    if (!results.ok || results.data === null) throw new Error('no results');
    expect(results.data.segments).toEqual([]);
    expect(results.data.offscreen).toBe(false);
    expect(results.data.history).toMatchObject({
      segments: first.result?.history?.segments,
      note: 'Details are kept for the last 4 weeks.',
    });
    expect(results.data.result?.score).toBe(first.result?.score);

    const doc = createSaveDocument(engineSaveState(state), {
      headerPromotionId: null,
      savedAt: '2026-11-08T12:00:00.000Z',
      label: 'History',
      engineVersion: '0.1.0',
    });
    expect((await loadSave(await encodeSave(doc), TABLES, engineLoadOptions())).ok).toBe(true);
  });
});

describe('the detail note', () => {
  it('says how long details are kept in plain words', () => {
    expect(keepDetailPeriodText(28)).toBe('4 weeks');
    expect(keepDetailPeriodText(7)).toBe('week');
    expect(keepDetailPeriodText(10)).toBe('10 days');
    expect(detailKeptNoteFor(28)).toBe('Details are kept for the last 4 weeks.');
    expect(detailKeptNoteFor(1)).toBe('Details are kept for the last day.');
    expect(detailKeptNoteFor(0)).toBe('Details are kept only for today.');
  });
});
