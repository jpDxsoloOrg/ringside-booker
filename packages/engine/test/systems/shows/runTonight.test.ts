// Run the show (EVT2-09): `shows.runTonight` replaces Lock card. Design:
// docs/design/show-night.md#the-players-shows
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine, type Viewer } from '../../../src/core/api';
import { defineSystem, type SystemBundle } from '../../../src/core/api/system';
import { parseGameDate } from '../../../src/core/date';
import type { EventInstanceId } from '../../../src/core/ids';
import { definePhase } from '../../../src/core/pipeline/phase';
import type { Employment } from '../../../src/model/entities/employment';
import { defaultSystems } from '../../../src/systems';
import { showControllerOf } from '../../../src/systems/calendar/control';
import {
  MAX_RUN_REASONS,
  registerBeforeShowRuns,
  unregisterBeforeShowRuns,
} from '../../../src/systems/shows';
import { runShowCard } from '../../../src/systems/shows/runShow';
import { testId } from '../../support';
import {
  angle,
  book,
  bookRunnable,
  change,
  match,
  PLAYER_ONE,
  PLAYER_TWO,
  validate,
  validateWorld,
  who,
  type ValidateWorld,
} from '../booking/validate-world';

const AS_PLAYER_ONE: Viewer = { kind: 'controller', controller: PLAYER_ONE };
const OMNISCIENT: Viewer = { kind: 'omniscient' };

function engineOver(built: ValidateWorld, systems: readonly SystemBundle[] = defaultSystems) {
  return createEngine({ state: initialEngineState(built.world), systems });
}

function statusOf(engine: Engine, id: EventInstanceId): string | undefined {
  return engine.exportState().world.tables.eventInstances.find((show) => show.id === id)?.status;
}

interface ShowEvent {
  type: string;
  payload: unknown;
}

function showEvents(engine: Engine): ShowEvent[] {
  const result = engine.query(
    'sim.recentEvents',
    { limit: 10_000, types: ['segment.completed', 'show.completed'] },
    OMNISCIENT,
  );
  if (!result.ok) {
    throw new Error(`sim.recentEvents failed: ${JSON.stringify(result.reasons)}`);
  }
  return result.data.map((event) => ({ type: event.type, payload: event.payload }));
}

function segmentIdOf(event: ShowEvent): unknown {
  const payload = event.payload;
  return typeof payload === 'object' && payload !== null && 'segmentId' in payload
    ? payload.segmentId
    : null;
}

function gateSubjects(engine: Engine): (string | undefined)[] {
  const result = engine.query('sim.pendingGates', {}, AS_PLAYER_ONE);
  if (!result.ok) {
    throw new Error(`sim.pendingGates was refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data.hits.map((hit) => hit.subject?.id);
}

function run(engine: Engine, eventInstanceId: EventInstanceId, issuedBy = PLAYER_ONE) {
  return engine.command('shows.runTonight', { eventInstanceId }, issuedBy);
}

describe('shows.runTonight refusals', () => {
  it('refuses a card with errors, with one cardNotRunnable reason per error', () => {
    const built = validateWorld();
    const opener = book(built, 0, match([[who(built, 6)], [who(built, 7)]], { outcome: null }));
    const engine = engineOver(built);
    const before = engine.exportState();
    expect(run(engine, built.show)).toEqual({
      ok: false,
      reasons: [
        {
          code: 'cardNotRunnable',
          message: 'Main card: 1 of 6 slots filled (needs 3)',
          subject: { kind: 'eventInstance', id: built.show },
        },
        {
          code: 'cardNotRunnable',
          message: 'Opener: no result planned; pick a winner, Auto, Random, a draw or a no contest',
          subject: { kind: 'segment', id: opener },
        },
        {
          code: 'cardNotRunnable',
          message: 'The main event (Slot 6) is empty',
          subject: { kind: 'eventInstance', id: built.show },
        },
      ],
    });
    expect(engine.exportState().world).toEqual(before.world);
    expect(showEvents(engine)).toEqual([]);
  });

  it('refuses an empty card', () => {
    const built = validateWorld();
    const result = run(engineOver(built), built.show);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reasons.map((reason) => reason.code)).toContain('cardNotRunnable');
  });

  it('refuses with exactly the errors booking.validate reports', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, match([[who(built, 3)], [who(built, 0)]], { titleIds: [built.tag] }));
    const engine = engineOver(built);
    const answer = engine.query('booking.validate', { eventInstanceId: built.show }, AS_PLAYER_ONE);
    const result = run(engine, built.show);
    expect(answer.ok && answer.data.runnable).toBe(false);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reasons.map((reason) => reason.message)).toEqual(
      answer.ok ? answer.data.errors.map((issue) => issue.message) : [],
    );
  });

  it(`lists at most ${String(MAX_RUN_REASONS)} reasons`, () => {
    const built = validateWorld();
    // Max Dorn, injured, in six matches without a result: more errors than a refusal lists.
    for (const slot of [0, 1, 2, 3, 4, 5]) {
      book(built, slot, match([[who(built, 4)], [who(built, 5 + slot)]], { outcome: null }));
    }
    const result = run(engineOver(built), built.show);
    expect(validate(built).errors.length).toBeGreaterThan(MAX_RUN_REASONS);
    expect(!result.ok && result.reasons).toHaveLength(MAX_RUN_REASONS);
  });

  it('refuses a show of someone else, a past show, a later show and an unknown show', () => {
    const built = validateWorld();
    bookRunnable(built, built.past);
    const engine = engineOver(built);
    expect(run(engine, built.rival)).toMatchObject({
      ok: false,
      reasons: [
        {
          code: 'notYourShow',
          message: 'Only the person running Test Brand Two can run this show',
        },
      ],
    });
    expect(run(engine, built.show, PLAYER_TWO)).toMatchObject({
      ok: false,
      reasons: [{ code: 'notYourShow' }],
    });
    expect(run(engine, built.past)).toMatchObject({
      ok: false,
      reasons: [{ code: 'notTonight', message: 'This show has already happened' }],
    });
    expect(run(engine, built.rival, PLAYER_TWO)).toMatchObject({
      ok: false,
      reasons: [{ code: 'notTonight', message: 'This show is on 2026-01-06, not tonight' }],
    });
    expect(run(engine, testId('eventInstance', 9999))).toMatchObject({
      ok: false,
      reasons: [{ code: 'showNotFound' }],
    });
  });

  it('refuses a cancelled show and a show that has already run', () => {
    const built = validateWorld();
    bookRunnable(built);
    const engine = engineOver(built);
    expect(run(engine, built.show).ok).toBe(true);
    expect(run(engine, built.show)).toMatchObject({
      ok: false,
      reasons: [{ code: 'showCompleted', message: 'This show has already run' }],
    });

    const cancelled = validateWorld();
    bookRunnable(cancelled);
    change(cancelled, (tx) => {
      tx.update('eventInstances', cancelled.show, {
        status: 'cancelled',
        cancellation: { reason: 'byPromotion', on: parseGameDate('2026-01-05') },
      });
    });
    expect(run(engineOver(cancelled), cancelled.show)).toMatchObject({
      ok: false,
      reasons: [{ code: 'showCancelled' }],
    });
  });
});

describe('shows.runTonight', () => {
  it('runs a card with warnings only, at once, and returns the show id', () => {
    const built = validateWorld();
    const card = bookRunnable(built);
    change(built, (tx) => {
      const [employment] = tx.view.tables.employments.lookup('byPerson', who(built, 6));
      if (employment === undefined) {
        throw new Error('Mia Torres has no contract');
      }
      tx.update('employments', employment.id, {
        brandId: built.brandTwo,
      } satisfies Partial<Employment>);
    });
    expect(validate(built).warnings.map((issue) => issue.code)).toEqual(['otherBrand']);
    const engine = engineOver(built);
    const result = run(engine, built.show);
    expect(result.ok && result.data).toEqual({ eventInstanceId: built.show });
    expect(statusOf(engine, built.show)).toBe('completed');
    expect(showEvents(engine).map((event) => [event.type, segmentIdOf(event)])).toEqual([
      ['segment.completed', card.opener],
      ['segment.completed', card.promo],
      ['segment.completed', card.mainEvent],
      ['show.completed', null],
    ]);
    expect(engine.query('shows.results', { eventInstanceId: built.show }, AS_PLAYER_ONE).ok).toBe(
      true,
    );
  });

  it('clears the show-day gate, so Next Day moves on and the shows phase leaves it alone', async () => {
    const built = validateWorld();
    bookRunnable(built);
    const engine = engineOver(built);
    expect(gateSubjects(engine)).toEqual([built.show]);
    expect(run(engine, built.show).ok).toBe(true);
    expect(gateSubjects(engine)).toEqual([]);
    const advanced = await engine.advanceDays({ maxDays: 1 });
    expect(advanced.failures).toEqual([]);
    expect(advanced.daysAdvanced).toBe(1);
    expect(showEvents(engine).filter((event) => event.type === 'show.completed')).toHaveLength(1);
    const clock = engine.query('clock.get', {}, AS_PLAYER_ONE);
    expect(clock.ok && clock.data.date).toBe(parseGameDate('2026-01-06'));
  });

  it('treats a show an old save left locked (booked) as open: editable, gated and runnable', () => {
    const built = validateWorld();
    bookRunnable(built);
    change(built, (tx) => {
      tx.update('eventInstances', built.show, { status: 'booked' });
    });
    const engine = engineOver(built);
    expect(gateSubjects(engine)).toEqual([built.show]);
    const added = engine.command(
      'booking.addSegment',
      { eventInstanceId: built.show, preShow: false, slot: 1, draft: angle([who(built, 11)]) },
      PLAYER_ONE,
    );
    expect(added.ok).toBe(true);
    expect(run(engine, built.show).ok).toBe(true);
    expect(statusOf(engine, built.show)).toBe('completed');
  });

  describe('before-a-show-runs hooks', () => {
    afterEach(() => {
      unregisterBeforeShowRuns('test.renameShow');
    });

    it('run first, and the show runs with what they wrote', () => {
      const seen: { human: boolean; status: string }[] = [];
      registerBeforeShowRuns({
        id: 'test.renameShow',
        order: 10,
        run: (ctx, input) => {
          seen.push({ human: input.human, status: input.show.status });
          ctx.tx.update('eventInstances', input.show.id, { name: 'Test Renamed Show' });
        },
      });
      const built = validateWorld();
      bookRunnable(built);
      const engine = engineOver(built);
      expect(run(engine, built.show).ok).toBe(true);
      expect(seen).toEqual([{ human: true, status: 'scheduled' }]);
      const completed = showEvents(engine).find((event) => event.type === 'show.completed');
      expect(completed).toBeDefined();
      const show = engine
        .exportState()
        .world.tables.eventInstances.find((instance) => instance.id === built.show);
      expect(show?.name).toBe('Test Renamed Show');
    });
  });
});

/**
 * The old path, for the determinism check: a phase that runs the player's shows of the day the way
 * the shows phase did before EVT2-09 (`runShowCard` on each), placed just before `shows.runShows`.
 */
const oldPathSystem: SystemBundle = defineSystem({
  id: 'oldPath',
  phases: [
    definePhase({
      id: 'oldPath.runMyShows',
      group: 'shows',
      order: 5,
      cadence: { kind: 'daily' },
      run: (ctx) => {
        const shows = ctx.read.tables.eventInstances
          .lookup('byDate', ctx.date)
          .filter(
            (show) =>
              show.status === 'scheduled' && showControllerOf(ctx.read, show).kind === 'human',
          );
        for (const show of shows) {
          runShowCard(ctx, show);
        }
      },
    }),
  ],
});

describe('shows.runTonight determinism', () => {
  it('leaves the same world and events as running the show inside the day', async () => {
    const commandPath = validateWorld();
    bookRunnable(commandPath);
    const phasePath = validateWorld();
    bookRunnable(phasePath);
    // Nobody is tired going in, so the show sees the same world whether it runs before the day or
    // inside it.
    for (const built of [commandPath, phasePath]) {
      expect([...built.world.tables.people.values()].every((person) => person.fatigue === 0)).toBe(
        true,
      );
    }

    // The show tires its workers (MTCH4-04). Run by command, it runs before the day's housekeeping,
    // so that day's fatigue recovery would see them tired; run inside the day it runs after it. The
    // health system is left out on both paths so the comparison is about running the show only.
    const withoutHealth = defaultSystems.filter((system) => system.id !== 'health');
    const viaCommand = engineOver(commandPath, withoutHealth);
    expect(run(viaCommand, commandPath.show).ok).toBe(true);
    expect((await viaCommand.advanceDays({ maxDays: 1 })).daysAdvanced).toBe(1);

    const viaPhase = engineOver(phasePath, [
      ...withoutHealth.map((system) => (system.id === 'shows' ? { ...system, gates: [] } : system)),
      oldPathSystem,
    ]);
    expect((await viaPhase.advanceDays({ maxDays: 1 })).daysAdvanced).toBe(1);

    expect(statusOf(viaCommand, commandPath.show)).toBe('completed');
    const commandState = viaCommand.exportState();
    const phaseState = viaPhase.exportState();
    expect(commandState.world).toEqual(phaseState.world);
    expect(commandState.rng).toEqual(phaseState.rng);
    // Traces match too, apart from their store-wide sequence number.
    const withoutSeq = (state: typeof commandState) =>
      state.traces.full
        .map(({ ref, date, trace, value }) => ({
          key: `${ref.kind}:${ref.id}`,
          date,
          trace,
          value,
        }))
        .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    expect(withoutSeq(commandState).length).toBeGreaterThan(0);
    expect(withoutSeq(commandState)).toEqual(withoutSeq(phaseState));
    expect(showEvents(viaCommand)).toEqual(showEvents(viaPhase));
  });
});
