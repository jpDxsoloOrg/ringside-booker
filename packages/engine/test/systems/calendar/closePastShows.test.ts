// Closing shows that did not run. Design: docs/design/calendar.md#lifecycle
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState } from '../../../src/core/api';
import { compareDates } from '../../../src/core/date';
import { defaultSystems } from '../../../src/systems';
import {
  SYSTEMS_WITHOUT_SHOW_DAY_GATE,
  SYSTEMS_WITHOUT_SHOW_NIGHT,
  tinyWorld,
  type BuiltWorld,
} from '../../support';
import {
  advance,
  cancelledEvents,
  engineOver,
  gameDate,
  lifecycleWorldWith,
  LIFECYCLE_START,
  OMNISCIENT,
  showIn,
} from './lifecycle-world';

const TODAY = gameDate(LIFECYCLE_START);

// Show night (`shows.runShows`) runs a locked show and a computer show before the day closes. These
// tests are about the safety net for shows nothing ran, so they leave show night out;
// shows/runShows.test.ts covers how the two meet.
function engineWithoutShowNight(built: BuiltWorld) {
  return createEngine({
    state: initialEngineState(built.world),
    systems: SYSTEMS_WITHOUT_SHOW_NIGHT,
  });
}

describe('calendar.closePastShows', () => {
  it('is a daily settlement phase at order 90, after the whole shows group', () => {
    const phase = defaultSystems
      .flatMap((system) => system.phases)
      .find((candidate) => candidate.id === 'calendar.closePastShows');
    expect(phase).toMatchObject({ group: 'settlement', order: 90, cadence: { kind: 'daily' } });
  });

  it("closes today's scheduled and booked shows as not run when the day ends", async () => {
    const built = lifecycleWorldWith((addShow) => [
      addShow({ date: TODAY }),
      addShow({ date: TODAY, status: 'booked' }),
    ]);
    const state = await advance(engineWithoutShowNight(built), 1);
    expect(built.shows).toHaveLength(2);
    for (const id of built.shows) {
      expect(showIn(state, id)).toMatchObject({
        status: 'cancelled',
        cancellation: { reason: 'notRun', on: TODAY },
        result: null,
      });
    }
  });

  it('leaves completed, cancelled and future shows as they were', async () => {
    const built = lifecycleWorldWith((addShow) => ({
      completed: addShow({ date: TODAY, status: 'completed' }),
      cancelled: addShow({ date: TODAY, status: 'cancelled' }),
      tomorrow: addShow({ date: gameDate('2026-01-06') }),
    }));
    const engine = engineOver(built);
    const before = engine.exportState();
    const after = await advance(engine, 1);
    // Tomorrow's show gets its venue the day before (EVT6-03's boxOffice.assignVenues); that is
    // not the close-past-shows rule, so the venue fields are left out of the comparison.
    const withoutVenue = (state: typeof before, id: (typeof built.shows)['completed']) => ({
      ...showIn(state, id),
      venueId: null,
      genericVenue: null,
      regionId: null,
    });
    for (const id of Object.values(built.shows)) {
      expect(withoutVenue(after, id)).toEqual(withoutVenue(before, id));
    }
    expect(showIn(after, built.shows.completed).status).toBe('completed');
    expect(showIn(after, built.shows.cancelled).cancellation).toEqual({
      reason: 'byPromotion',
      on: TODAY,
    });
    expect(showIn(after, built.shows.tomorrow).status).toBe('scheduled');
    expect(cancelledEvents(engine)).toEqual([]);
  });

  it('closes a show from 3 days ago that was left open, on the next run', async () => {
    const built = lifecycleWorldWith((addShow) => addShow({ date: TODAY }), {
      currentDate: '2026-01-08',
    });
    const state = await advance(engineOver(built), 1);
    expect(showIn(state, built.shows)).toMatchObject({
      status: 'cancelled',
      // The day the show was closed, not the show's own date.
      cancellation: { reason: 'notRun', on: '2026-01-08' },
      date: TODAY,
    });
  });

  it('publishes one show.cancelled per closed show, in id order', async () => {
    const built = lifecycleWorldWith((addShow, { promotionB }) => {
      // Inserted so that id order differs from status order: booked, scheduled, booked.
      const closed = [
        addShow({ date: TODAY, status: 'booked' }),
        addShow({ date: TODAY, promotionId: promotionB }),
        addShow({ date: TODAY, status: 'booked' }),
      ];
      addShow({ date: TODAY, status: 'completed' });
      return closed;
    });
    const engine = engineWithoutShowNight(built);
    await advance(engine, 1);
    const inIdOrder = [...built.shows].sort();
    expect(inIdOrder).toEqual(built.shows);
    expect(cancelledEvents(engine)).toEqual(
      inIdOrder.map((eventInstanceId, index) => ({
        eventInstanceId,
        promotionId: index === 1 ? built.promotionB : built.promotionA,
        date: TODAY,
        reason: 'notRun',
      })),
    );
  });

  it('is listed in the day report with no failures', async () => {
    const built = lifecycleWorldWith((addShow) => addShow({ date: TODAY }));
    const engine = engineOver(built);
    await advance(engine, 1);
    const report = engine.query('sim.lastDayReport', {}, OMNISCIENT);
    if (!report.ok || report.data === null) {
      throw new Error('No day report');
    }
    expect(report.data.failedCount).toBe(0);
    const step = report.data.steps.find((entry) => entry.stepId === 'calendar.closePastShows');
    expect(step).toMatchObject({
      group: 'settlement',
      status: 'ok',
      eventsPublished: 1,
      reactionFailures: [],
      logs: ['Closed 1 show(s) that did not run'],
    });
    // It runs after every step of the shows group and before the day closes.
    const stepIds = report.data.steps.map((entry) => entry.stepId);
    const lastShowsStep = report.data.steps.map((entry) => entry.group).lastIndexOf('shows');
    expect(stepIds.indexOf('calendar.closePastShows')).toBeGreaterThan(lastShowsStep);
    expect(stepIds.indexOf('calendar.closePastShows')).toBeLessThan(
      stepIds.indexOf('pipeline.close'),
    );
  });

  it('leaves no past show open after 30 days on the tiny world', async () => {
    const engine = createEngine({
      state: initialEngineState(tinyWorld().world),
      systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE,
    });
    const state = await advance(engine, 30);
    const today = state.world.meta.currentDate;
    const past = state.world.tables.eventInstances.filter(
      (show) => compareDates(show.date, today) < 0,
    );
    // The show that ran before the game began, plus the weekly shows of the 30 days.
    expect(past.length).toBeGreaterThanOrEqual(4);
    expect(past.filter((show) => show.status === 'scheduled' || show.status === 'booked')).toEqual(
      [],
    );
    const notRun = past.filter((show) => show.status === 'cancelled');
    expect(notRun.length).toBe(past.length - 1);
    for (const show of notRun) {
      expect(show.cancellation).toEqual({ reason: 'notRun', on: show.date });
    }
    expect(past.filter((show) => show.status === 'completed')).toHaveLength(1);
    // Nothing from today onward has been touched.
    expect(
      state.world.tables.eventInstances
        .filter((show) => compareDates(show.date, today) >= 0)
        .every((show) => show.status === 'scheduled'),
    ).toBe(true);
  });
});
