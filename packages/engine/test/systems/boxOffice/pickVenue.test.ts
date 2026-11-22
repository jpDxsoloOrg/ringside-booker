// The venue pick: preferred → best fit in the region (real or generic) → country → largest.
// Design: docs/design/box-office.md#pick
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

/** Every generic size shrunk below a 5,000 crowd (the walk-up crowd tops out at 5,000). */
const SHRUNK_SIZES = {
  'boxOffice.generic.smallArena.capacity': 3500,
  'boxOffice.generic.arena.capacity': 3600,
  'boxOffice.generic.largeArena.capacity': 3700,
  'boxOffice.generic.stadium.capacity': 4000,
} as const;

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
        { name: 'Just Too Small', capacity: 1240 },
        { name: 'Civic Hall', capacity: 1300 },
        { name: 'Elsewhere Hall', capacity: 1260, region: 1 },
      ],
    });
    // 1,000 + 25% = 1,250: the 1,240 room is too small, the 1,300 hall is the smallest that fits.
    expect(result.value).toBe(venueId('Civic Hall'));
    expect(rulesOf(result)).toEqual([
      'Best fit in Test Region North 1 for 1,000 + 25% (1,250): true',
    ]);
    expect(reasonFor(result, venueId('Just Too Small'))).toBe(
      'Just Too Small: Too small (holds 1,240)',
    );
    expect(reasonFor(result, venueId('Civic Hall'))).toBe(
      'Civic Hall: Smallest that fits (holds 1,300, rent $4,800)',
    );
    expect(reasonFor(result, venueId('Big Arena'))).toBe(
      'Big Arena: Bigger than needed (holds 8,000)',
    );
  });

  it('takes a generic local size over a real venue far bigger than the crowd', () => {
    // The audit case: a 150 crowd was put in a 3,000-seat hall because it was the only real venue.
    const { result, venueId } = pick({
      crowd: 150,
      venues: [{ name: 'Big Hall', capacity: 3000 }],
    });
    // 150 + 25% = 188: the 150 room is too small, the 500 small hall fits.
    expect(result.value).toBe('generic:smallHall');
    expect(reasonFor(result, venueId('Big Hall'))).toBe(
      'Big Hall: Bigger than needed (holds 3,000)',
    );
  });

  it('leaves boxOffice.venueHeadroom of room above the expected crowd', () => {
    const venues = [
      { name: 'Snug Hall', capacity: 1100 },
      { name: 'Roomy Hall', capacity: 1300 },
    ];
    const tight = pick({ crowd: 1000, venues, tunables: { 'boxOffice.venueHeadroom': 0 } });
    expect(tight.result.value).toBe(tight.venueId('Snug Hall'));
    const roomy = pick({ crowd: 1000, venues });
    expect(roomy.result.value).toBe(roomy.venueId('Roomy Hall'));
    const wide = pick({ crowd: 1000, venues, tunables: { 'boxOffice.venueHeadroom': 0.5 } });
    // 1,500 needed: the 3,000 local large hall.
    expect(wide.result.value).toBe('generic:largeHall');
  });

  it('breaks close sizes on the lower rent, but never past the tie band', () => {
    const close = pick({
      crowd: 1000,
      venues: [
        { name: 'Arena Annex', capacity: 1300, kind: 'arena' },
        { name: 'Cheap Studio', capacity: 1350, kind: 'studio' },
      ],
    });
    // 1,350 is within 10% of 1,300, and a studio rents for less than an arena.
    expect(close.result.value).toBe(close.venueId('Cheap Studio'));
    expect(reasonFor(close.result, close.venueId('Cheap Studio'))).toBe(
      'Cheap Studio: Close in size and cheaper (holds 1,350, rent $3,085)',
    );
    expect(reasonFor(close.result, close.venueId('Arena Annex'))).toBe(
      'Arena Annex: Close in size but dearer (holds 1,300, rent $5,938)',
    );

    const far = pick({
      crowd: 1000,
      venues: [
        { name: 'Arena Annex', capacity: 1300, kind: 'arena' },
        { name: 'Big Studio', capacity: 1500, kind: 'studio' },
      ],
    });
    // 1,500 is more than 10% bigger: the smallest that fits wins, however cheap the other is.
    expect(far.result.value).toBe(far.venueId('Arena Annex'));
    const wideBand = pick({
      crowd: 1000,
      venues: [
        { name: 'Arena Annex', capacity: 1300, kind: 'arena' },
        { name: 'Big Studio', capacity: 1500, kind: 'studio' },
      ],
      tunables: { 'boxOffice.venueTieBand': 0.2 },
    });
    expect(wideBand.result.value).toBe(wideBand.venueId('Big Studio'));
  });

  it('counts the discount on the promotion’s own venue in a close tie', () => {
    const { result, venueId } = pick({
      crowd: 1000,
      venues: [
        { name: 'Civic Hall', capacity: 1300 },
        { name: 'Our Hall', capacity: 1400, exclusiveTo: 'A' },
      ],
    });
    expect(result.value).toBe(venueId('Our Hall'));
  });

  it('looks elsewhere in the country only when nothing in the region fits', () => {
    const { result, venueId } = pick({
      crowd: 5000,
      tunables: SHRUNK_SIZES,
      venues: [
        { name: 'Local Room', capacity: 300 },
        { name: 'North Two Hall', capacity: 7000, region: 1 },
        { name: 'South Hall', capacity: 6500, region: 2 },
      ],
    });
    // 6,250 needed: bigger than every local size, so North Two Hall in the same country.
    expect(result.value).toBe(venueId('North Two Hall'));
    expect(rulesOf(result)).toEqual([
      'Best fit in Test Region North 1 for 5,000 + 25% (6,250): false',
      'Best fit elsewhere in Test Country North for 6,250: true',
    ]);
  });

  it('takes the largest venue it can book when none is big enough', () => {
    const real = pick({
      crowd: 5000,
      tunables: SHRUNK_SIZES,
      venues: [
        { name: 'Region Hall', capacity: 4500 },
        { name: 'Bigger But Closed', capacity: 6000, closedOn: '2026-05-01' },
      ],
    });
    expect(real.result.value).toBe(real.venueId('Region Hall'));
    expect(decisionOf(real.result).reason).toBe('Bigger than any venue: Region Hall');

    const generic = pick({ crowd: 5000, tunables: SHRUNK_SIZES });
    expect(generic.result.value).toBe('generic:stadium');
    expect(decisionOf(generic.result).reason).toBe('Bigger than any venue: Local stadium');
    expect(rulesOf(generic.result)).toEqual([
      'Best fit in Test Region North 1 for 5,000 + 25% (6,250): false',
      'Best fit elsewhere in Test Country North for 6,250: false',
    ]);
  });

  it('picks the smallest fitting size even when an override reorders the sizes', () => {
    const { result } = pick({
      crowd: 1000,
      tunables: { 'boxOffice.generic.room.capacity': 1260 },
    });
    expect(result.value).toBe('generic:room');
    const sizes = genericVenueSizes(
      createEngineTunables({ 'boxOffice.generic.stadium.capacity': 100 }),
    );
    expect(sizes[0]).toEqual({ tier: 'stadium', capacity: 100 });
  });

  it('breaks exact ties by capacity, then by id', () => {
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
    // 1,250 needed: the 3,000 local large hall.
    expect(result.value).toBe('generic:largeHall');
    expect(rulesOf(result)).toEqual([
      'Preferred venue Their Studio is open and can be booked: false',
      'Best fit in Test Region North 1 for 1,000 + 25% (1,250): true',
    ]);
    const notes = findTraceNodes(decisionOf(result), 'note').map((node) => node.label);
    expect(notes).toContain('Expected crowd in Test Region North 1: 1,000');
    const tunables = findTraceNodes(decisionOf(result), 'tunable').map((node) => node.label);
    expect(tunables).toEqual([
      'Room left for a good night',
      'How much bigger a cheaper venue may be',
    ]);
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
