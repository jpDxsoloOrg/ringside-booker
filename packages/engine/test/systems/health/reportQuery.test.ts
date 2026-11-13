// `health.report`, who is out right now (WRK6-06). Design: docs/design/health.md#who-is-out
import { describe, expect, it } from 'vitest';
import {
  assertSerialisable,
  createEngine,
  initialEngineState,
  type Engine,
} from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { controllerViewer, OMNISCIENT_VIEWER, type Viewer } from '../../../src/core/api/controller';
import { addDays, compareDates } from '../../../src/core/date';
import type { PersonId, PromotionId } from '../../../src/core/ids';
import { healthSystem, type HealthReport } from '../../../src/systems/health';
import { aPerson } from '../../support/builders/people';
import { TEST_PLAYER_ID, TEST_START_DATE, worldBuilder } from '../../support';

const OWNER = controllerViewer({ kind: 'human', playerId: TEST_PLAYER_ID });
const RIVAL_PLAYER = 'player-2';
const RIVAL = controllerViewer({ kind: 'human', playerId: RIVAL_PLAYER });

interface ReportWorld {
  engine: Engine;
  mine: PromotionId;
  /** The player's injured worker (back in 20 days, not seen yet). */
  hurt: PersonId;
  /** The player's other worker: one healed injury, fit now. */
  healed: PersonId;
  /** The rival's injured worker (back in 10 days). */
  theirs: PersonId;
  /** An injured free agent (back in 10 days, too). */
  free: PersonId;
}

/**
 * The player's promotion (two workers: one hurt, one healed), a rival run by a second human (one
 * hurt worker) and a hurt free agent.
 */
function reportWorld({ freeWaiting = false }: { freeWaiting?: boolean } = {}): ReportWorld {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withInjuryCatalog()
    .withPromotion(
      { name: 'My Wrestling', controller: { kind: 'human', playerId: TEST_PLAYER_ID } },
      (promotion) => promotion.withRoster(2),
    )
    .withPromotion(
      { name: 'Rival Wrestling', controller: { kind: 'human', playerId: RIVAL_PLAYER } },
      (promotion) => promotion.withRoster(1),
    )
    .with('a free agent', (context) => {
      context.insert('people', aPerson({ defaultRingName: 'Test Free Agent' }, context.sequence));
    })
    .withInjury(0, { expectedReturn: addDays(TEST_START_DATE, 20), noticedOn: null })
    .withInjury(1, {
      since: addDays(TEST_START_DATE, -30),
      expectedReturn: addDays(TEST_START_DATE, -10),
      returnedOn: addDays(TEST_START_DATE, -10),
    })
    .withInjury(2, { expectedReturn: addDays(TEST_START_DATE, 10), noticedOn: null })
    .withInjury(3, {
      expectedReturn: addDays(TEST_START_DATE, 10),
      ...(freeWaiting ? { noticedOn: null } : {}),
    })
    .build();
  const [hurt, healed, theirs, free] = ids.people;
  const mine = ids.promotions.A;
  if (
    hurt === undefined ||
    healed === undefined ||
    theirs === undefined ||
    free === undefined ||
    mine === undefined
  ) {
    throw new Error('the report world should have four people and the player’s promotion');
  }
  const engine = createEngine({
    state: initialEngineState(world),
    systems: [simSystem, healthSystem],
  });
  return { engine, mine, hurt, healed, theirs, free };
}

function reportOf(
  engine: Engine,
  args: { promotionId?: PromotionId } = {},
  viewer: Viewer = OMNISCIENT_VIEWER,
): HealthReport {
  const result = engine.query('health.report', args, viewer);
  if (!result.ok) {
    throw new Error(`health.report was refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

describe('health.report', () => {
  it('lists every open injury in the world, free agents included, soonest back first', () => {
    const { engine, hurt, healed, theirs, free } = reportWorld();
    const report = reportOf(engine);

    expect(report.asOf).toBe(TEST_START_DATE);
    const ids = report.rows.map((row) => row.personId);
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain(healed);
    expect(ids.at(-1)).toBe(hurt);
    expect(new Set(ids.slice(0, 2))).toEqual(new Set([theirs, free]));
    // Two back on the same day are ordered by name.
    for (let index = 1; index < report.rows.length; index += 1) {
      const before = report.rows[index - 1];
      const after = report.rows[index];
      if (before === undefined || after === undefined) {
        throw new Error('expected two rows');
      }
      const byDate = compareDates(before.expectedReturn, after.expectedReturn);
      expect(byDate <= 0).toBe(true);
      if (byDate === 0) {
        expect(before.name.toLowerCase() <= after.name.toLowerCase()).toBe(true);
      }
    }
    const freeRow = report.rows.find((row) => row.personId === free);
    expect(freeRow).toMatchObject({
      name: 'Test Free Agent',
      employer: null,
      label: 'Test arm injury',
      bodyPart: 'arms',
      daysRemaining: 10,
      returnedOn: null,
    });
  });

  it('keeps only one promotion’s people when asked, with the employer and ring name', () => {
    const { engine, mine, hurt } = reportWorld();
    const report = reportOf(engine, { promotionId: mine });

    expect(report.rows.map((row) => row.personId)).toEqual([hurt]);
    expect(report.rows[0]).toMatchObject({
      employer: { promotionId: mine, name: 'My Wrestling' },
      roles: ['wrestler'],
      daysRemaining: 20,
    });
    expect(report.rows[0]?.name).not.toBe('');
  });

  it('marks an unseen injury new only for the worker’s own promotion', () => {
    const { engine, hurt, theirs } = reportWorld();
    const pending = (viewer: Viewer): Record<string, boolean> =>
      Object.fromEntries(
        reportOf(engine, {}, viewer).rows.map((row) => [row.personId, row.pendingNotice]),
      );

    expect(pending(OWNER)[hurt]).toBe(true);
    expect(pending(OWNER)[theirs]).toBe(false);
    expect(pending(RIVAL)[hurt]).toBe(false);
    expect(pending(RIVAL)[theirs]).toBe(true);
    expect(Object.values(pending(OMNISCIENT_VIEWER)).some(Boolean)).toBe(false);
  });

  it('drops someone once they are back, and is serialisable', async () => {
    const { engine, hurt, theirs } = reportWorld();
    // Both humans see their own worker's injury first, so the day is free to move.
    for (const [viewer, playerId, personId] of [
      [OWNER, TEST_PLAYER_ID, hurt],
      [RIVAL, RIVAL_PLAYER, theirs],
    ] as const) {
      const row = reportOf(engine, {}, viewer).rows.find((entry) => entry.personId === personId);
      if (row === undefined) {
        throw new Error(`expected a row for ${personId}`);
      }
      const seen = engine.command(
        'health.acknowledgeInjuries',
        { injuryIds: [row.injuryId] },
        { kind: 'human', playerId },
      );
      expect(seen.ok).toBe(true);
    }
    const advanced = await engine.advanceDays({ maxDays: 12 });
    expect(advanced.failures).toEqual([]);
    const report = reportOf(engine);
    expect(report.rows.map((row) => row.personId)).toEqual([hurt]);
    expect(() => {
      assertSerialisable(report, 'health.report');
    }).not.toThrow();
  });

  it('lists the waiting injuries each human may mark, whatever the scope', () => {
    const { engine, mine, hurt, theirs, free } = reportWorld({ freeWaiting: true });
    const injuryOf = (personId: PersonId): string => {
      const row = reportOf(engine).rows.find((entry) => entry.personId === personId);
      if (row === undefined) {
        throw new Error(`expected a row for ${personId}`);
      }
      return row.injuryId;
    };
    // Nobody employs the free agent, so either human may clear their injury: the stop never waits
    // on an injury that no list shows as yours.
    const forOwner = reportOf(engine, { promotionId: mine }, OWNER);
    expect(forOwner.rows.map((row) => row.personId)).toEqual([hurt]);
    expect([...forOwner.waitingForViewer].sort()).toEqual([injuryOf(hurt), injuryOf(free)].sort());
    expect([...reportOf(engine, {}, RIVAL).waitingForViewer].sort()).toEqual(
      [injuryOf(theirs), injuryOf(free)].sort(),
    );
    expect(reportOf(engine).waitingForViewer).toEqual([]);
  });

  it('refuses an id that is not a promotion', () => {
    const { engine } = reportWorld();
    expect(
      engine.queryRaw('health.report', { promotionId: 'per_0000000001' }, OMNISCIENT_VIEWER).ok,
    ).toBe(false);
  });
});
