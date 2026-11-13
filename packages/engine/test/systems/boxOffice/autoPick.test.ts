// The automatic venue picks (EVT6-03): the daily `boxOffice.assignVenues` phase and the
// before-a-show-runs hook. Design: docs/design/box-office.md#automatic-picks
import { describe, expect, it } from 'vitest';
import type { StepContext } from '../../../src/core/pipeline/context';
import { runStep } from '../../../src/core/pipeline/runStep';
import { createRuntime } from '../../../src/core/pipeline/runtime';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import {
  ASSIGN_VENUES_PHASE_ID,
  PICK_ON_SHOW_NIGHT_HOOK_ID,
  assignVenuesPhase,
  pickOnShowNightHook,
  venueAvailability,
  venuePickTraceRef,
} from '../../../src/systems/boxOffice';
import { listBeforeShowRuns } from '../../../src/systems/shows/beforeRun';
import { runShowNow } from '../../../src/systems/shows/runShow';
import {
  SHOW_NAMES,
  venueCommandWorld,
  type ShowName,
  type VenueCommandWorld,
} from './venueCommandWorld';

const SOURCE = { kind: 'phase', id: ASSIGN_VENUES_PHASE_ID } as const;

function runtimeOn(built: VenueCommandWorld) {
  return createRuntime({ world: built.world, tunables: built.tunables });
}

function inStep(runtime: ReturnType<typeof runtimeOn>, run: (ctx: StepContext) => void): void {
  const report = runStep(runtime, ASSIGN_VENUES_PHASE_ID, SOURCE, run);
  expect(report.error?.message).toBeUndefined();
}

function runPhase(runtime: ReturnType<typeof runtimeOn>): void {
  inStep(runtime, (ctx) => {
    assignVenuesPhase.run(ctx);
  });
}

function venueOf(built: VenueCommandWorld, show: ShowName): string | null {
  const row = built.world.tables.eventInstances.require(built.shows[show]);
  return row.venueId ?? (row.genericVenue === null ? null : `generic:${row.genericVenue.tier}`);
}

function picks(built: VenueCommandWorld): Record<string, string | null> {
  return Object.fromEntries(SHOW_NAMES.map((show) => [show, venueOf(built, show)]));
}

function phaseWorld(tunables?: TunableOverrides) {
  const built = venueCommandWorld(tunables === undefined ? {} : { tunables });
  const runtime = runtimeOn(built);
  runPhase(runtime);
  return { built, runtime };
}

describe('boxOffice.assignVenues', () => {
  it('gives rival shows inside the lead window a venue and leaves the player’s later shows alone', () => {
    const { built, runtime } = phaseWorld();
    // Its promotion's own exclusive venue is the smallest that fits 1,000 × 1.1.
    expect(venueOf(built, 'rival')).toBe(built.venues.rivalDojo);
    // Already at a venue: kept.
    expect(venueOf(built, 'rivalAtArena')).toBe(built.venues.bigArena);
    // 30 days out: outside the 14-day window.
    expect(venueOf(built, 'rivalFar')).toBeNull();
    // The player's shows a week or more out stay "not chosen yet".
    expect(venueOf(built, 'mine')).toBeNull();
    expect(venueOf(built, 'myFar')).toBeNull();
    // Tomorrow's show is picked the day before, and today's as a safety net.
    expect(venueOf(built, 'myTomorrow')).not.toBeNull();
    expect(venueOf(built, 'myToday')).not.toBeNull();
    // Past, completed and cancelled shows are never touched.
    expect(venueOf(built, 'myPast')).toBeNull();
    expect(venueOf(built, 'myCompleted')).toBeNull();
    expect(venueOf(built, 'myCancelled')).toBeNull();

    const events = runtime.bus.recent({ types: ['show.venueChosen'] });
    expect(events.map((event) => [event.payload.eventInstanceId, event.payload.auto])).toEqual(
      [built.shows.myToday, built.shows.myTomorrow, built.shows.rival].map((id) => [id, true]),
    );
    // The player's picks keep their Why?; a rival's does not.
    expect(runtime.traces.has(venuePickTraceRef(built.shows.myTomorrow))).toBe(true);
    expect(runtime.traces.has(venuePickTraceRef(built.shows.rival))).toBe(false);
  });

  it('a rival’s pick takes its venue for that night', () => {
    // 1,300 × 1.1 is too many for Rival Dojo: the rival show goes to Civic Hall.
    const { built } = phaseWorld({ 'boxOffice.draw.walkUp': 1300 });
    expect(venueOf(built, 'rival')).toBe(built.venues.civicHall);
    const civicHall = built.world.tables.venues.require(built.venues.civicHall);
    const mine = built.world.tables.eventInstances.require(built.shows.mine);
    expect(
      venueAvailability(built.world, civicHall, {
        promotionId: mine.promotionId,
        date: mine.date,
        eventInstanceId: mine.id,
      }),
    ).toMatchObject({ available: false, code: 'boxOffice.venueTaken' });
  });

  it('follows boxOffice.rivalVenueLeadDays', () => {
    const { built } = phaseWorld({ 'boxOffice.rivalVenueLeadDays': 0 });
    expect(venueOf(built, 'rival')).toBeNull();
    const wide = phaseWorld({ 'boxOffice.rivalVenueLeadDays': 30 });
    expect(venueOf(wide.built, 'rivalFar')).not.toBeNull();
    expect(venueOf(wide.built, 'myFar')).toBeNull();
  });

  it('is idempotent: a second run changes nothing', () => {
    const { built, runtime } = phaseWorld();
    const before = picks(built);
    const eventsBefore = runtime.bus.recent({ types: ['show.venueChosen'] }).length;
    runPhase(runtime);
    expect(picks(built)).toEqual(before);
    expect(runtime.bus.recent({ types: ['show.venueChosen'] })).toHaveLength(eventsBefore);
  });

  it('is deterministic: the same world gets the same picks', () => {
    expect(picks(phaseWorld().built)).toEqual(picks(phaseWorld().built));
  });
});

describe('boxOffice.pickOnShowNight', () => {
  it('is registered as a before-a-show-runs hook', () => {
    expect(listBeforeShowRuns().map((hook) => hook.id)).toContain(PICK_ON_SHOW_NIGHT_HOOK_ID);
  });

  it('a show that runs without a venue gets the automatic pick first', () => {
    const built = venueCommandWorld();
    const runtime = runtimeOn(built);
    inStep(runtime, (ctx) => {
      runShowNow(ctx, ctx.read.tables.eventInstances.require(built.shows.myToday), true);
    });
    const show = built.world.tables.eventInstances.require(built.shows.myToday);
    expect(show.status).toBe('completed');
    expect(show.venueId).toBe(built.venues.civicHall);
    expect(
      runtime.bus.recent({ types: ['show.venueChosen'] }).map((event) => event.payload),
    ).toEqual([
      {
        eventInstanceId: built.shows.myToday,
        promotionId: built.promotions.A,
        venueId: built.venues.civicHall,
        genericTier: null,
        auto: true,
      },
    ]);
    expect(runtime.traces.has(venuePickTraceRef(built.shows.myToday))).toBe(true);
  });

  it('a show that already has a venue keeps it', () => {
    const built = venueCommandWorld();
    const runtime = runtimeOn(built);
    const show = built.world.tables.eventInstances.require(built.shows.rivalAtArena);
    inStep(runtime, (ctx) => {
      pickOnShowNightHook.run(ctx, { show, human: false, beforeTheDay: false });
    });
    expect(venueOf(built, 'rivalAtArena')).toBe(built.venues.bigArena);
    expect(runtime.bus.recent({ types: ['show.venueChosen'] })).toEqual([]);
  });
});
