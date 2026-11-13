// Storing a show's venue, the generic venue column and the venue helpers (EVT6-02).
// Design: docs/design/box-office.md#venues and #generic-venues
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { StepContext } from '../../../src/core/pipeline/context';
import { runStep } from '../../../src/core/pipeline/runStep';
import { createRuntime } from '../../../src/core/pipeline/runtime';
import { isFullTrace } from '../../../src/core/trace/store';
import { EventInstanceSchema } from '../../../src/model/entities/event-instance';
import { loadSave } from '../../../src/persistence/load';
import { TABLES } from '../../../src/model/tables';
import {
  applyVenueChoice,
  pickVenueFor,
  showVenueOf,
  venueAvailability,
  venueFit,
  venueFitLabel,
  venuePickTraceRef,
  type VenueOptionKey,
} from '../../../src/systems/boxOffice';
import { createEngineTunables } from '../../../src/systems/tunables';
import { testId } from '../../support';
import { anEventInstance } from '../../support/builders/creative';
import { SHOW_DATE, venueWorld, type VenueWorld } from './venueWorld';

const BEFORE_GENERIC_VENUES = new URL(
  '../../fixtures/saves/v1-tiny-before-generic-venues.json',
  import.meta.url,
);

const SOURCE = { kind: 'phase', id: 'test.boxOffice' } as const;

function apply(built: VenueWorld, choice: VenueOptionKey, withTrace: boolean) {
  const runtime = createRuntime({ world: built.world, tunables: built.tunables });
  const trace = withTrace ? pickVenueFor(built.world, built.tunables, built.show) : undefined;
  const report = runStep(runtime, 'test.boxOffice', SOURCE, (ctx: StepContext) => {
    applyVenueChoice(ctx, built.show.id, choice, {
      auto: true,
      ...(trace === undefined ? {} : { trace }),
    });
  });
  expect(report.error?.message).toBeUndefined();
  return {
    runtime,
    show: built.world.tables.eventInstances.require(built.show.id),
    events: runtime.bus.recent({ types: ['show.venueChosen'] }),
  };
}

describe('applyVenueChoice', () => {
  it('a real venue sets the venue, clears the generic one and moves the show to its region', () => {
    const built = venueWorld({
      crowd: 1000,
      venues: [{ name: 'North Two Hall', capacity: 1500, region: 1 }],
    });
    const venueId = built.venueId('North Two Hall');
    const { show, events, runtime } = apply(built, venueId, true);
    expect(show.venueId).toBe(venueId);
    expect(show.genericVenue).toBeNull();
    expect(show.regionId).toBe(built.regions[1]);
    expect(events.map((event) => event.payload)).toEqual([
      {
        eventInstanceId: built.show.id,
        promotionId: built.promotions.A,
        venueId,
        genericTier: null,
        auto: true,
      },
    ]);
    const stored = runtime.traces.get(venuePickTraceRef(built.show.id));
    expect(stored !== undefined && isFullTrace(stored)).toBe(true);
  });

  it('a generic size clears the venue and stores the size with its capacity today', () => {
    const built = venueWorld({
      crowd: 1000,
      venues: [{ name: 'Civic Hall', capacity: 1500 }],
      tunables: { 'boxOffice.generic.hall.capacity': 1300 },
    });
    const first = apply(built, built.venueId('Civic Hall'), false);
    expect(first.show.venueId).not.toBeNull();
    const { show, events, runtime } = apply({ ...built, show: first.show }, 'generic:hall', false);
    expect(show.venueId).toBeNull();
    expect(show.genericVenue).toEqual({ tier: 'hall', capacity: 1300 });
    expect(show.regionId).toBe(built.regions[0]);
    expect(events.map((event) => event.payload)).toEqual([
      {
        eventInstanceId: built.show.id,
        promotionId: built.promotions.A,
        venueId: null,
        genericTier: 'hall',
        auto: true,
      },
    ]);
    expect(runtime.traces.get(venuePickTraceRef(built.show.id))).toBeUndefined();
  });
});

describe('eventInstances.genericVenue', () => {
  it('refuses a show with both a real venue and a generic one', () => {
    const both = { ...anEventInstance(), venueId: testId('venue') };
    const parsed = EventInstanceSchema.safeParse({
      ...both,
      genericVenue: { tier: 'hall', capacity: 1200 },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
      'a show has a real venue or a generic venue, not both',
    );
  });

  it('defaults to null for a row written before generic venues', () => {
    const older = Object.fromEntries(
      Object.entries(anEventInstance()).filter(([key]) => key !== 'genericVenue'),
    );
    expect(EventInstanceSchema.parse(older).genericVenue).toBeNull();
  });

  it('still loads a save made before generic venues', async () => {
    const report = await loadSave(new Uint8Array(readFileSync(BEFORE_GENERIC_VENUES)), TABLES);
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    for (const show of report.doc.state.world.tables.eventInstances) {
      expect(show.genericVenue).toBeNull();
    }
  });
});

describe('showVenueOf', () => {
  it('names a generic venue after its size and the show’s region', () => {
    const built = venueWorld({ crowd: 100 });
    const show = { ...built.show, genericVenue: { tier: 'hall' as const, capacity: 1200 } };
    expect(showVenueOf(built.world, show)).toEqual({
      kind: 'generic',
      tier: 'hall',
      name: 'Local hall, Test Region North 1',
      capacity: 1200,
      venueKind: 'hall',
      regionId: built.show.regionId,
      imageRef: 'placeholder:venue',
    });
  });

  it('reads a real venue from the venues table, and null when none is chosen', () => {
    const built = venueWorld({ crowd: 100, venues: [{ name: 'Civic Hall', capacity: 1500 }] });
    expect(showVenueOf(built.world, built.show)).toBeNull();
    const venue = built.venue('Civic Hall');
    expect(showVenueOf(built.world, { ...built.show, venueId: venue.id })).toEqual({
      kind: 'venue',
      venueId: venue.id,
      name: 'Civic Hall',
      capacity: 1500,
      venueKind: venue.kind,
      regionId: venue.regionId,
      imageRef: venue.imageRef,
      exclusivePromotionId: null,
    });
  });
});

describe('venueAvailability', () => {
  it('ignores a cancelled rival show and the promotion’s own shows that night', () => {
    const built = venueWorld({
      crowd: 100,
      venues: [{ name: 'Civic Hall', capacity: 1500 }],
      rivalShowsAt: ['Civic Hall'],
    });
    const venue = built.venue('Civic Hall');
    const booking = { promotionId: built.promotions.A, date: SHOW_DATE, eventInstanceId: null };
    expect(venueAvailability(built.world, venue, booking).available).toBe(false);
    // The rival itself can use it: the show there is its own.
    expect(
      venueAvailability(built.world, venue, { ...booking, promotionId: built.promotions.B }),
    ).toEqual({ available: true });
    const cancelled = venueWorld({
      crowd: 100,
      venues: [{ name: 'Civic Hall', capacity: 1500 }],
      rivalShowsAt: ['Civic Hall'],
      rivalShowsCancelled: true,
    });
    expect(
      venueAvailability(cancelled.world, cancelled.venue('Civic Hall'), {
        ...booking,
        promotionId: cancelled.promotions.A,
      }),
    ).toEqual({ available: true });
  });
});

describe('venueFit', () => {
  const tunables = createEngineTunables();

  it.each([
    { expected: 1500, capacity: 1500, fit: 'likelySellOut', label: 'Likely sell-out' },
    { expected: 1000, capacity: 1500, fit: 'goodFit', label: 'Good fit' },
    { expected: 500, capacity: 1500, fit: 'willLookEmpty', label: 'Will look empty' },
  ] as const)('$expected in $capacity is $label', ({ expected, capacity, fit, label }) => {
    expect(venueFit(expected, capacity, tunables)).toBe(fit);
    expect(venueFitLabel(fit)).toBe(label);
  });
});
