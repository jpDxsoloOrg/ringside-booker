// The own-injury gate and the command that clears it. Design: docs/design/health.md#own-injury-gate
import { describe, expect, it } from 'vitest';
import { createEngine, defineSystem, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { parseContentKey } from '../../../src/core/content-key';
import type { InjuryId, PersonId } from '../../../src/core/ids';
import { definePhase } from '../../../src/core/pipeline/phase';
import type { InjuryRecord } from '../../../src/model/entities/injury';
import type { GameWorld } from '../../../src/model/tables';
import {
  healthSystem,
  injure,
  OWN_WORKER_INJURED_GATE_ID,
  plainDate,
  ROSTER_ACTION_HINT,
} from '../../../src/systems/health';
import { TEST_PLAYER_ID } from '../../support/builders/build-row';
import { worldBuilder } from '../../support/world-builder';

const OMNISCIENT = { kind: 'omniscient' } as const;
const HUMAN = { kind: 'human', playerId: TEST_PLAYER_ID } as const;
const ARM = parseContentKey('injury.test-arm');

interface GateWorld {
  world: GameWorld;
  /** The player's two workers. */
  mine: readonly [PersonId, PersonId];
  /** A rival's worker. */
  rival: PersonId;
}

function gateWorld(): GateWorld {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withInjuryCatalog()
    .withPromotion({ name: 'My Wrestling', controller: HUMAN }, (promotion) =>
      promotion.withRoster(2),
    )
    .withPromotion({ name: 'Rival Wrestling' }, (promotion) => promotion.withRoster(1))
    .build();
  const [first, second, rival] = ids.people;
  if (first === undefined || second === undefined || rival === undefined) {
    throw new Error('the gate world should have three workers');
  }
  return { world, mine: [first, second], rival };
}

/** The real systems minus the random off-screen rolls, plus a phase that hurts `who` on day one. */
function engineHurting(
  world: GameWorld,
  who: readonly PersonId[],
  overrides: Record<string, boolean> = {},
): Engine {
  let done = false;
  const hurt = defineSystem({
    id: 'hurtOnDayOne',
    phases: [
      definePhase({
        id: 'hurtOnDayOne.run',
        group: 'housekeeping',
        order: 50,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          if (done) {
            return;
          }
          done = true;
          for (const personId of who) {
            injure(ctx, personId, { source: 'world', kindKey: ARM, severity: 'moderate' });
          }
        },
      }),
    ],
  });
  const health = {
    ...healthSystem,
    phases: healthSystem.phases.filter((phase) => phase.id !== 'health.offscreenInjuries'),
  };
  const engine = createEngine({
    state: initialEngineState(world),
    systems: [simSystem, health, hurt],
  });
  for (const [key, value] of Object.entries(overrides)) {
    const set = engine.command('tunables.setOverride', { key, value }, HUMAN);
    expect(set.ok).toBe(true);
  }
  return engine;
}

function injuriesOf(engine: Engine): InjuryRecord[] {
  return engine.exportState().world.tables.injuries;
}

function injuryOf(engine: Engine, personId: PersonId): InjuryRecord {
  const row = injuriesOf(engine).find((entry) => entry.personId === personId);
  if (row === undefined) {
    throw new Error(`expected an injury for ${personId}`);
  }
  return row;
}

function ringNameOf(engine: Engine, personId: PersonId): string {
  const employment = engine
    .exportState()
    .world.tables.employments.find((entry) => entry.personId === personId);
  if (employment === undefined) {
    throw new Error(`expected a contract for ${personId}`);
  }
  return employment.ringName;
}

function pendingGates(engine: Engine) {
  const result = engine.query('sim.pendingGates', {}, OMNISCIENT);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  return result.data.hits;
}

function acknowledge(engine: Engine, injuryIds: InjuryId[], issuedBy = HUMAN) {
  return engine.command('health.acknowledgeInjuries', { injuryIds }, issuedBy);
}

describe('health.ownWorkerInjured', () => {
  it('stops the skip before the next day, naming the worker, the injury and the return date', async () => {
    const { world, mine } = gateWorld();
    const engine = engineHurting(world, [mine[0]]);
    const result = await engine.advanceDays({ maxDays: 10 });
    expect(result.daysAdvanced).toBe(1);
    const row = injuryOf(engine, mine[0]);
    expect(row.noticedOn).toBeNull();
    const expected = {
      gateId: OWN_WORKER_INJURED_GATE_ID,
      reason: `${ringNameOf(engine, mine[0])} was injured (Test arm injury, out until ${plainDate(row.expectedReturn)})`,
      subject: { kind: 'person', id: mine[0] },
      actionHint: ROSTER_ACTION_HINT,
    };
    expect(result.stoppedBy).toEqual({ kind: 'gate', hits: [expected] });
    // Next Day would stop for the same reason until the injury is seen.
    expect(pendingGates(engine)).toEqual([expected]);
    const again = await engine.advanceDays({ maxDays: 10 });
    expect(again.daysAdvanced).toBe(0);
  });

  it('counts the others when several are waiting', async () => {
    const { world, mine } = gateWorld();
    const engine = engineHurting(world, mine);
    await engine.advanceDays({ maxDays: 10 });
    const [hit] = pendingGates(engine);
    // The injury with the lowest id leads.
    const [lead] = injuriesOf(engine)
      .filter((row) => mine.includes(row.personId))
      .sort((left, right) => (left.id < right.id ? -1 : 1));
    if (lead === undefined) {
      throw new Error('expected two injuries');
    }
    expect(hit?.reason).toBe(`${ringNameOf(engine, lead.personId)} and 1 other were injured`);
    expect(hit?.subject).toEqual({ kind: 'person', id: lead.personId });
  });

  it('lets the days run once the injury is marked as seen', async () => {
    const { world, mine } = gateWorld();
    const engine = engineHurting(world, [mine[0]]);
    await engine.advanceDays({ maxDays: 10 });
    const row = injuryOf(engine, mine[0]);
    const done = acknowledge(engine, [row.id]);
    expect(done).toMatchObject({ ok: true, data: null });
    expect(injuryOf(engine, mine[0]).noticedOn).toBe(engine.exportState().world.meta.currentDate);
    expect(pendingGates(engine)).toEqual([]);
    const result = await engine.advanceDays({ maxDays: 5 });
    expect(result.stoppedBy).toEqual({ kind: 'completed' });
    expect(result.daysAdvanced).toBe(5);
  });

  it('never stops for a rival worker', async () => {
    const { world, rival } = gateWorld();
    const engine = engineHurting(world, [rival]);
    const result = await engine.advanceDays({ maxDays: 5 });
    expect(result.stoppedBy).toEqual({ kind: 'completed' });
    expect(injuryOf(engine, rival).noticedOn).toBe(injuryOf(engine, rival).since);
  });

  it('never stops with health.stopOnOwnInjury turned off', async () => {
    const { world, mine } = gateWorld();
    const engine = engineHurting(world, [mine[0]], { 'health.stopOnOwnInjury': false });
    const result = await engine.advanceDays({ maxDays: 5 });
    expect(result.stoppedBy).toEqual({ kind: 'completed' });
    expect(injuryOf(engine, mine[0]).noticedOn).toBe(injuryOf(engine, mine[0]).since);
  });
});

describe('health.acknowledgeInjuries', () => {
  async function hurtBoth() {
    const built = gateWorld();
    const engine = engineHurting(built.world, [built.mine[0], built.rival]);
    await engine.advanceDays({ maxDays: 10 });
    return { ...built, engine };
  }

  it("refuses a rival's injury and an unknown id, and changes nothing", async () => {
    const { engine, mine, rival } = await hurtBoth();
    const own = injuryOf(engine, mine[0]).id;
    const theirs = injuryOf(engine, rival).id;
    const refused = acknowledge(engine, [own, theirs]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reasons).toEqual([
        {
          code: 'notYourWorker',
          message: `${ringNameOf(engine, rival)} does not work for you, so this injury is not yours to mark as seen.`,
          subject: { kind: 'person', id: rival },
        },
      ]);
    }
    const unknown = acknowledge(engine, ['inj_zzzzzzzzzz' as InjuryId]);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.reasons.map((reason) => reason.code)).toEqual(['unknownInjury']);
    }
    expect(injuryOf(engine, mine[0]).noticedOn).toBeNull();
  });

  it('refuses the computer', async () => {
    const { engine, mine } = await hurtBoth();
    const refused = acknowledge(engine, [injuryOf(engine, mine[0]).id], {
      kind: 'computer',
    } as never);
    expect(refused.ok).toBe(false);
  });

  it('marks your own, publishes injury.noticed once and is logged; a repeat writes nothing', async () => {
    const { engine, mine } = await hurtBoth();
    const own = injuryOf(engine, mine[0]).id;
    const first = acknowledge(engine, [own, own]);
    expect(first.ok).toBe(true);
    const events = engine.query(
      'sim.recentEvents',
      { limit: 10, types: ['injury.noticed'] },
      OMNISCIENT,
    );
    expect(events.ok && events.data.map((event) => event.payload)).toEqual([{ injuryIds: [own] }]);
    const before = engine.exportState().world;
    const repeat = acknowledge(engine, [own]);
    expect(repeat).toMatchObject({ ok: true, data: null, events: [] });
    expect(engine.exportState().world).toEqual(before);
    const log = engine.query('sim.commandLog', { limit: 10 }, OMNISCIENT);
    const entries = log.ok
      ? log.data.filter((entry) => entry.name === 'health.acknowledgeInjuries')
      : [];
    expect(entries.map((entry) => entry.outcome)).toEqual(['applied', 'applied']);
    expect(entries[0]?.issuedBy).toEqual(HUMAN);
  });
});
