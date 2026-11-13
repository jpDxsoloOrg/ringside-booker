// The venue pick: preferred → region → country → generic. Design: docs/design/box-office.md#pick
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../src/core/trace';
import type { DecisionNode, Traced } from '../../../src/core/trace/types';
import {
  genericVenueSizes,
  pickVenue,
  pickVenueFor,
  type PickVenueInputs,
  type VenueOptionKey,
} from '../../../src/systems/boxOffice';
import { createEngineTunables } from '../../../src/systems/tunables';
import { testId } from '../../support';
import { expectSerialisable } from '../../support/trace';
import { SHOW_DATE, venueWorld, type VenueWorldOptions } from './venueWorld';

function pick(options: VenueWorldOptions) {
  const built = venueWorld(options);
  const result = pickVenueFor(built.world, built.tunables, built.show);
  return { ...built, result };
}

function decisionOf(result: Traced<VenueOptionKey>): DecisionNode {
  const { trace } = result;
  if (trace.kind !== 'decision') {
    throw new Error(`Expected a decision, got ${trace.kind}`);
  }
  return trace;
}

/** Every rule the pick checked, as "text: passed". */
function rulesOf(result: Traced<VenueOptionKey>): string[] {
  return findTraceNodes(decisionOf(result), 'branch').map(
    (node) => `${node.condition}: ${String(node.taken)}`,
  );
}

function reasonFor(result: Traced<VenueOptionKey>, option: VenueOptionKey): string | undefined {
  return decisionOf(result).considered.find((entry) => entry.option === option)?.reason;
}

describe('pickVenue', () => {
  it('chooses the preferred venue even when it is too small for the crowd', () => {
    const { result, venueId } = pick({
      crowd: 5000,
      venues: [
        { name: 'Tiny Room', capacity: 200 },
        { name: 'Big Arena', capacity: 8000 },
      ],
      preferred: 'Tiny Room',
    });
    expect(result.value).toBe(venueId('Tiny Room'));
    expect(rulesOf(result)).toEqual(['Preferred venue Tiny Room is open and can be booked: true']);
  });

  it.each([
    {
      why: 'exclusive to a rival',
      planned: { name: 'Their Studio', capacity: 600, exclusiveTo: 'B' as const },
      rival: [] as string[],
      reason: 'Their Studio: Exclusive to Test Promotion B',
    },
    {
      why: 'closed on the day',
      planned: { name: 'Their Studio', capacity: 600, closedOn: '2026-05-01' },
      rival: [] as string[],
      reason: 'Their Studio: Closed on that date',
    },
    {
      why: 'taken by a rival that night',
      planned: { name: 'Their Studio', capacity: 600 },
      rival: ['Their Studio'],
      reason: 'Their Studio: Test Promotion B runs Rival Night there that night',
    },
  ])('skips a preferred venue that is $why and says why', ({ planned, rival, reason }) => {
    const { result, venueId } = pick({
      crowd: 1000,
      venues: [planned, { name: 'Civic Hall', capacity: 1500 }],
      preferred: 'Their Studio',
      rivalShowsAt: rival,
    });
    expect(result.value).toBe(venueId('Civic Hall'));
    expect(reasonFor(result, venueId('Their Studio'))).toBe(reason);
    expect(rulesOf(result)[0]).toBe(
      'Preferred venue Their Studio is open and can be booked: false',
    );
  });

  it('allows a venue exclusive to the show’s own promotion', () => {
    const { result, venueId } = pick({
      crowd: 500,
      venues: [{ name: 'Our Studio', capacity: 600, exclusiveTo: 'A' }],
      preferred: 'Our Studio',
    });
    expect(result.value).toBe(venueId('Our Studio'));
  });

  it('never picks a region venue that is exclusive to a rival, even when it fits best', () => {
    const { result, venueId } = pick({
      crowd: 1000,
      venues: [
        { name: 'Their Hall', capacity: 1200, exclusiveTo: 'B' },
        { name: 'Civic Hall', capacity: 2000 },
      ],
    });
    expect(result.value).toBe(venueId('Civic Hall'));
    expect(reasonFor(result, venueId('Their Hall'))).toBe(
      'Their Hall: Exclusive to Test Promotion B',
    );
  });

  it('chooses the smallest venue in the region that fits the crowd with headroom', () => {
    const { result, venueId } = pick({
      crowd: 1000,
      venues: [
        { name: 'Big Arena', capacity: 8000 },
        { name: 'Just Too Small', capacity: 1050 },
        { name: 'Civic Hall', capacity: 1200 },
        { name: 'Elsewhere Hall', capacity: 1100, region: 1 },
      ],
    });
    // 1,000 × 1.1 = 1,100: the 1,050 room is too small, the 1,200 hall is the smallest that fits.
    expect(result.value).toBe(venueId('Civic Hall'));
    expect(rulesOf(result)).toEqual([
      'Smallest venue in Test Region North 1 that fits 1,000 × 1.1 (1,100): true',
    ]);
    expect(reasonFor(result, venueId('Just Too Small'))).toBe(
      'Just Too Small: Too small (holds 1,050)',
    );
  });

  it('looks elsewhere in the country when nothing in the region fits', () => {
    const { result, venueId } = pick({
      crowd: 1000,
      venues: [
        { name: 'Local Room', capacity: 300 },
        { name: 'North Two Hall', capacity: 1500, region: 1 },
        { name: 'South Hall', capacity: 1200, region: 2 },
      ],
    });
    expect(result.value).toBe(venueId('North Two Hall'));
    expect(rulesOf(result)).toEqual([
      'Smallest venue in Test Region North 1 that fits 1,000 × 1.1 (1,100): false',
      'Smallest venue elsewhere in Test Country North that fits 1,100: true',
    ]);
  });

  it('falls back to the smallest generic size that fits when the country has nothing', () => {
    const { result } = pick({
      crowd: 1000,
      venues: [
        { name: 'Local Room', capacity: 300 },
        { name: 'South Hall', capacity: 5000, region: 2 },
      ],
    });
    // 1,100 needed: the 1,200 local hall.
    expect(result.value).toBe('generic:hall');
    expect(rulesOf(result).at(-1)).toBe('Generic venue: smallest size that fits: true');
    expect(reasonFor(result, 'generic:smallHall')).toBe('Local small hall: Too small (holds 500)');
  });

  it('chooses the stadium size when the crowd is bigger than every size', () => {
    // The walk-up crowd tops out at 5,000, so the big sizes are shrunk below it instead.
    const { result } = pick({
      crowd: 5000,
      tunables: {
        'boxOffice.generic.smallArena.capacity': 3500,
        'boxOffice.generic.arena.capacity': 3600,
        'boxOffice.generic.largeArena.capacity': 3700,
        'boxOffice.generic.stadium.capacity': 4000,
      },
    });
    expect(result.value).toBe('generic:stadium');
    expect(decisionOf(result).reason).toBe('Bigger than any venue size: Local stadium');
    expect(rulesOf(result).at(-1)).toBe('Generic venue: smallest size that fits: false');
  });

  it('picks the smallest fitting size even when an override reorders the sizes', () => {
    const { result } = pick({
      crowd: 1000,
      tunables: { 'boxOffice.generic.room.capacity': 1150 },
    });
    expect(result.value).toBe('generic:room');
    const sizes = genericVenueSizes(
      createEngineTunables({ 'boxOffice.generic.stadium.capacity': 100 }),
    );
    expect(sizes[0]).toEqual({ tier: 'stadium', capacity: 100 });
  });

  it('breaks ties by capacity, then by id', () => {
    const { result, venue } = pick({
      crowd: 1000,
      venues: [
        { name: 'Second Hall', capacity: 1500 },
        { name: 'First Hall', capacity: 1500 },
      ],
    });
    const lower = [venue('Second Hall').id, venue('First Hall').id].sort()[0];
    expect(result.value).toBe(lower);
  });

  it('keeps a serialisable trace with the expected crowd and every rule it checked', () => {
    const { result, venueId } = pick({
      crowd: 1000,
      venues: [
        { name: 'Their Studio', capacity: 600, exclusiveTo: 'B' },
        { name: 'Local Room', capacity: 300 },
      ],
      preferred: 'Their Studio',
    });
    expectSerialisable(result);
    expect(result.value).toBe('generic:hall');
    expect(rulesOf(result)).toEqual([
      'Preferred venue Their Studio is open and can be booked: false',
      'Smallest venue in Test Region North 1 that fits 1,000 × 1.1 (1,100): false',
      'Smallest venue elsewhere in Test Country North that fits 1,100: false',
      'Generic venue: smallest size that fits: true',
    ]);
    const notes = findTraceNodes(decisionOf(result), 'note').map((node) => node.label);
    expect(notes).toContain('Expected crowd in Test Region North 1: 1,000');
    const tunables = findTraceNodes(decisionOf(result), 'tunable').map((node) => node.label);
    expect(tunables).toEqual(['Room left for a good night']);
    expect(reasonFor(result, venueId('Their Studio'))).toBe(
      'Their Studio: Exclusive to Test Promotion B',
    );
  });

  it('is pure: the same inputs give the same pick', () => {
    const inputs: PickVenueInputs = {
      show: {
        promotionId: testId('promotion'),
        date: SHOW_DATE,
        regionId: testId('region'),
        regionName: 'Somewhere',
        countryId: testId('country'),
        countryName: 'Some Country',
      },
      expected: 100,
      preferred: null,
      inRegion: [],
      inCountry: [],
      genericSizes: genericVenueSizes(createEngineTunables()),
    };
    const tunables = createEngineTunables();
    expect(pickVenue(inputs, { tunables })).toEqual(pickVenue(inputs, { tunables }));
    expect(pickVenue(inputs, { tunables }).value).toBe('generic:room');
  });
});
