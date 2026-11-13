// The Promotions queries and the weekly roster review on the shipped default world (AIP1-05):
// a new game as Longleaf Championship Wrestling against the 11 computer rivals.
// Design: docs/design/rival-desk.md#promotions-queries
import { beforeAll, describe, expect, it } from 'vitest';
import { createEngine, type Engine, type Viewer } from '../../../src/core/api';
import type { QueryArgs, QueryData, QueryName } from '../../../src/core/api/maps';
import type { PromotionId } from '../../../src/core/ids';
import { assertTraceReplays } from '../../../src/core/trace';
import { addDays } from '../../../src/core/date';
import { TABLES } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import { computerUnits, isDue, SHOWS_PER_MONTH_DAYS } from '../../../src/systems/aip';
import { defaultSystems } from '../../../src/systems';
import { withMyShowsRun } from '../../support';
import { measureBestAgainstReference } from '../../support/cpu-budget';
import { SLOW_TESTS } from '../../support/slow';
import { startDefaultGame } from '../calendar/default-game';

const PLAYER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: 'local-player' },
};
const LONGLEAF = 'Longleaf Championship Wrestling';

function newLongleafGame(): Engine {
  const state = startDefaultGame({
    player: { mode: 'existing', promotionKey: 'pro-us-southeast' },
  });
  return createEngine({ state, systems: withMyShowsRun([...defaultSystems]) });
}

function ask<N extends QueryName>(engine: Engine, name: N, args: QueryArgs<N>): QueryData<N> {
  const result = engine.query(name, args, PLAYER);
  if (!result.ok) {
    return expect.fail(`${name} refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

function promotionNamed(engine: Engine, name: string): PromotionId {
  const row = ask(engine, 'promotions.list', {}).find((candidate) => candidate.name === name);
  if (row === undefined) {
    return expect.fail(`no promotion called ${name}`);
  }
  return row.promotionId;
}

describe('the Promotions queries on the default world', () => {
  let engine: Engine;
  beforeAll(() => {
    engine = newLongleafGame();
  });

  it('lists the 12 promotions, Longleaf yours and the rest the computer’s, rival cash hidden', () => {
    const rows = ask(engine, 'promotions.list', {});
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      if (row.name === LONGLEAF) {
        expect(row.controlledBy).toBe('you');
        expect(row.cash.kind).toBe('exact');
      } else {
        expect(row.controlledBy).toBe('computer');
        expect(row.cash.kind).toBe('hidden');
      }
    }
  });

  it('values every Tessen wrestler 0-100 with a Why? that replays', () => {
    const tessen = promotionNamed(engine, 'Tessen Pro Wrestling');
    const roster = ask(engine, 'promotions.roster', { promotionId: tessen });
    const wrestlers = roster.rows.filter((row) => row.role === 'wrestler');
    expect(wrestlers.length).toBeGreaterThan(10);
    for (const row of wrestlers) {
      const value = row.cardValue;
      if (value === null) {
        return expect.fail(`${row.ringName} has no card value`);
      }
      expect(value.value).toBeGreaterThanOrEqual(0);
      expect(value.value).toBeLessThanOrEqual(100);
      assertTraceReplays(value);
    }
  });

  it('works out needs for all 12 promotions', () => {
    for (const row of ask(engine, 'promotions.list', {})) {
      const needs = ask(engine, 'aip.needs', { promotionId: row.promotionId });
      expect(needs.unitName).toBe(row.name);
    }
  });

  // A few seconds (a full export and reload of the default world): slow runs only.
  it.runIf(SLOW_TESTS)(
    'counts each promotion’s dated shows a month and finds a rival’s real show day due (AIP1-07)',
    { timeout: 60_000 },
    () => {
      const state = engine.exportState();
      const world = documentToWorld({ state: { world: state.world } }, TABLES);
      const today = state.world.meta.currentDate;
      const shows = state.world.tables.eventInstances.filter(
        (show) => show.status === 'scheduled' && show.date >= today,
      );
      for (const row of ask(engine, 'promotions.list', {})) {
        const horizonEnd = addDays(today, SHOWS_PER_MONTH_DAYS - 1);
        const stored = shows.filter(
          (show) => show.promotionId === row.promotionId && show.date <= horizonEnd,
        ).length;
        const profile = ask(engine, 'promotions.profile', { promotionId: row.promotionId });
        expect(profile.kpis.showsPerMonth, row.name).toBe(stored);
      }
      // A rival's first stored show: its beforeShow jobs are due that day and not the day before.
      const rivalShow = shows
        .filter((show) => show.promotionId !== promotionNamed(engine, LONGLEAF))
        .sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0))[0];
      if (rivalShow === undefined) return expect.fail('no rival show is scheduled');
      const unit = computerUnits(world).find(
        (candidate) =>
          candidate.promotionId === rivalShow.promotionId && candidate.brandId === null,
      );
      if (unit === undefined) return expect.fail('the rival has no promotion unit');
      expect(isDue('beforeShow', unit, rivalShow.date, world)).toBe(true);
      const dayBefore = addDays(rivalShow.date, -1);
      const showsDayBefore = shows.filter(
        (show) => show.promotionId === rivalShow.promotionId && show.date === dayBefore,
      );
      expect(isDue('beforeShow', unit, dayBefore, world)).toBe(showsDayBefore.length > 0);
    },
  );

  it('records one weekly roster review per rival over a 7-day skip', async () => {
    const skipped = newLongleafGame();
    const advanced = await skipped.advanceDays({ maxDays: 7 });
    expect(advanced.failures).toEqual([]);
    for (const row of ask(skipped, 'promotions.list', {})) {
      const log = ask(skipped, 'aip.decisionLog', { promotionId: row.promotionId });
      const reviews = log.entries.filter((entry) => entry.kind === 'rosterReview');
      if (row.name === LONGLEAF) {
        expect(reviews).toEqual([]);
        continue;
      }
      expect(reviews, row.name).toHaveLength(1);
      expect(reviews[0]?.text).toMatch(/^Weekly roster review: /);
      expect(reviews[0]?.traceRef).not.toBeNull();
      expect(log.hiddenCount).toBe(0);
    }
  });
});

describe.runIf(SLOW_TESTS)('Promotions query speed on the default world', () => {
  // About 50 ms on a laptop, as a ratio against the CPU reference workload (about 50 ms itself):
  // the engine's test threads share one process and `process.cpuUsage()` counts them all.
  it('answers promotions.list and Altura’s promotions.roster within one reference workload', () => {
    const engine = newLongleafGame();
    const altura = promotionNamed(engine, 'Altura Wrestling Entertainment');
    // Warm up once so the timings measure the queries, not the first compile.
    ask(engine, 'promotions.list', {});
    ask(engine, 'promotions.roster', { promotionId: altura });
    const list = measureBestAgainstReference(() => ask(engine, 'promotions.list', {}), 5);
    const roster = measureBestAgainstReference(
      () => ask(engine, 'promotions.roster', { promotionId: altura }),
      5,
    );
    const rows = ask(engine, 'promotions.roster', { promotionId: altura }).rows.length;
    console.log(
      `promotions.list ${list.workMs.toFixed(1)} ms (${list.ratio.toFixed(2)} ref); promotions.roster (Altura, ${String(rows)} rows) ${roster.workMs.toFixed(1)} ms (${roster.ratio.toFixed(2)} ref)`,
    );
    expect(list.ratio).toBeLessThan(1);
    expect(roster.ratio).toBeLessThan(1);
  });

  it('logs each promotion’s top card values and needs (the calibration log)', () => {
    const engine = newLongleafGame();
    const lines: string[] = [];
    for (const row of ask(engine, 'promotions.list', {})) {
      const roster = ask(engine, 'promotions.roster', { promotionId: row.promotionId });
      const top = roster.rows
        .filter((entry) => entry.role === 'wrestler')
        .sort((left, right) => (right.cardValue?.value ?? 0) - (left.cardValue?.value ?? 0))
        .slice(0, 3)
        .map((entry) => `${entry.ringName} ${(entry.cardValue?.value ?? 0).toFixed(1)}`);
      const needs = ask(engine, 'aip.needs', { promotionId: row.promotionId }).needs.map(
        (need) => `${need.text} (${need.severity.value.toFixed(0)})`,
      );
      lines.push(
        `${row.name} [${roster.taste.label}]\n  top: ${top.join(', ')}\n  needs: ${needs.join('; ') || 'none'}`,
      );
    }
    console.log(lines.join('\n'));
    expect(lines).toHaveLength(12);
  });
});
