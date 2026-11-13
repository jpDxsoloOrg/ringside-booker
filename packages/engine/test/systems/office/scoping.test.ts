// Who may read what on the Office (DAY2-03): rival cash and morale stay hidden (D-07, as WRK1).
// Design: docs/design/office.md#queries
import { afterEach, describe, expect, it } from 'vitest';
import { OMNISCIENT_VIEWER, type Viewer } from '../../../src/core/api';
import { parseGameDate } from '../../../src/core/date';
import {
  BAD_RANGE,
  HIDDEN,
  registerPromotionSnapshotField,
  UNKNOWN_METRIC,
  UNKNOWN_PROMOTION,
  type OfficeSeriesArgs,
} from '../../../src/systems/office';
import { testId } from '../../support/ids';
import { expectSerialisable } from '../../support/trace';
import {
  COMPUTER_VIEWER,
  HUMAN_VIEWER,
  MONDAY,
  officeWorld,
  queryOk,
  SPECTATOR_VIEWER,
  type OfficeWorld,
} from './office-world';

const FROM = parseGameDate('2026-01-01');
const TO = parseGameDate('2026-12-31');

function series(world: OfficeWorld, args: Partial<OfficeSeriesArgs>, viewer: Viewer) {
  return world.engine.query(
    'office.series',
    {
      subject: { kind: 'promotion', id: world.human },
      metric: 'cash',
      from: FROM,
      to: TO,
      ...args,
    },
    viewer,
  );
}

function refusalCode(result: ReturnType<typeof series>): string | undefined {
  return result.ok ? undefined : result.reasons[0]?.code;
}

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, into);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      into.add(key);
      keysOf(item, into);
    }
  }
  return into;
}

let unregister: (() => void)[] = [];
afterEach(() => {
  for (const remove of unregister) remove();
  unregister = [];
});

describe('office.series viewer rules', () => {
  it("lets the human read their own cash and morale, and a rival's public columns only", async () => {
    const world = await officeWorld(MONDAY, 15);
    const own = series(world, {}, HUMAN_VIEWER);
    expect(own.ok).toBe(true);
    if (!own.ok) return;
    expectSerialisable(own.data);
    expect(own.data.metric).toEqual({ key: 'cash', label: 'Cash', unit: 'money' });
    expect(own.data.points.map((point) => [point.date, point.granularity])).toEqual([
      ['2026-01-05', 'week'],
      ['2026-01-12', 'week'],
      ['2026-01-19', 'week'],
    ]);
    expect(series(world, { metric: 'averageMorale' }, HUMAN_VIEWER).ok).toBe(true);

    const rivalCash = series(
      world,
      { subject: { kind: 'promotion', id: world.rival } },
      HUMAN_VIEWER,
    );
    expect(rivalCash).toEqual({
      ok: false,
      reasons: [
        expect.objectContaining({
          code: HIDDEN,
          message: 'Only Rival Wrestling knows its own cash',
        }),
      ],
    });
    const rivalMorale = series(
      world,
      { subject: { kind: 'promotion', id: world.rival }, metric: 'averageMorale' },
      HUMAN_VIEWER,
    );
    expect(rivalMorale.ok ? '' : rivalMorale.reasons[0]?.message).toBe(
      'Only Rival Wrestling knows its own morale',
    );
    for (const metric of ['popularity.headline', 'prestige', 'rosterSize', 'popularity.world']) {
      const result = series(
        world,
        { subject: { kind: 'promotion', id: world.rival }, metric },
        HUMAN_VIEWER,
      );
      expect(result.ok, metric).toBe(true);
    }
  });

  it('gives a computer viewer no private columns and the omniscient viewer every one', async () => {
    const world = await officeWorld(MONDAY, 8);
    expect(refusalCode(series(world, {}, COMPUTER_VIEWER))).toBe(HIDDEN);
    expect(refusalCode(series(world, { metric: 'averageMorale' }, COMPUTER_VIEWER))).toBe(HIDDEN);
    expect(series(world, { metric: 'prestige' }, COMPUTER_VIEWER).ok).toBe(true);
    expect(series(world, {}, OMNISCIENT_VIEWER).ok).toBe(true);
    expect(
      series(world, { subject: { kind: 'promotion', id: world.rival } }, OMNISCIENT_VIEWER).ok,
    ).toBe(true);
  });

  it('hides an owner-only registered field of a rival', async () => {
    unregister.push(
      registerPromotionSnapshotField({
        key: 'test.secret',
        label: 'Locker room mood',
        unit: 'points',
        visibility: 'owner',
        extract: () => 5,
      }),
    );
    const world = await officeWorld(MONDAY, 8);
    const own = series(world, { metric: 'test.secret' }, HUMAN_VIEWER);
    expect(own.ok && own.data.points.map((point) => point.value)).toEqual([5, 5]);
    const rival = series(
      world,
      { subject: { kind: 'promotion', id: world.rival }, metric: 'test.secret' },
      HUMAN_VIEWER,
    );
    expect(rival.ok ? '' : rival.reasons[0]?.message).toBe(
      'Only Rival Wrestling knows its own locker room mood',
    );
  });

  it('refuses an unknown metric, an unknown promotion and a backwards range', async () => {
    const world = await officeWorld(MONDAY, 1);
    expect(refusalCode(series(world, { metric: 'nonsense' }, HUMAN_VIEWER))).toBe(UNKNOWN_METRIC);
    expect(
      refusalCode(
        series(
          world,
          { subject: { kind: 'promotion', id: testId('promotion', 99) } },
          HUMAN_VIEWER,
        ),
      ),
    ).toBe(UNKNOWN_PROMOTION);
    expect(refusalCode(series(world, { from: TO, to: FROM }, HUMAN_VIEWER))).toBe(BAD_RANGE);
  });
});

describe('office.dashboard viewer rules', () => {
  it('shows no cash or morale anywhere to a seat with no promotion', async () => {
    const world = await officeWorld(MONDAY, 8);
    for (const viewer of [SPECTATOR_VIEWER, COMPUTER_VIEWER, OMNISCIENT_VIEWER]) {
      const dashboard = queryOk(world.engine, 'office.dashboard', {}, viewer);
      expect(dashboard.promotion).toBeNull();
      expect(dashboard.worldOverview).not.toBeNull();
      const keys = [...keysOf(dashboard)].map((key) => key.toLowerCase());
      expect(keys.filter((key) => key.includes('cash') || key.includes('morale'))).toEqual([]);
    }
  });
});
