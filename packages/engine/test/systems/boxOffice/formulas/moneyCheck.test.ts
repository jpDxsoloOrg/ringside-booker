// Show-day money stays in whole, non-negative cents, and the net adds up exactly.
// Design: docs/design/box-office.md#box-office-net
import { describe, expect, it } from 'vitest';
import { intBetween, pick } from '../../../../src/core/rng/odds';
import { inputOf } from '../../../../src/core/trace';
import { EVENT_IMPORTANCES } from '../../../../src/model/entities/event-definition';
import { VENUE_KINDS } from '../../../../src/model/entities/venue';
import {
  computeActualAttendance,
  computeBoxOfficeNet,
  computeLiveMerch,
  computeTicketPrice,
  computeVenueRent,
  computeWorkerShare,
} from '../../../../src/systems/boxOffice';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { crowdStream, merchStream } from './rngSupport';

const TUNABLES = createEngineTunables();
const RUNS = 1000;

function expectWholeCents(value: number): void {
  expect(Number.isSafeInteger(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(0);
}

describe('show-day money check', () => {
  it(`keeps every amount in whole cents for ${String(RUNS)} seeded shows`, () => {
    // A separate seed, so drawing the random inputs never moves the streams under test.
    const inputs = crowdStream('money-check-inputs');
    const crowdRng = crowdStream('money-check');
    const merchRng = merchStream('money-check');
    for (let run = 0; run < RUNS; run += 1) {
      const capacity = intBetween(inputs, 0, 200_000);
      const attendance = computeActualAttendance(
        {
          expected: inputOf('Expected crowd', intBetween(inputs, 0, 250_000)),
          capacity,
          venueName: 'Venue',
        },
        { tunables: TUNABLES, rng: crowdRng },
      );
      const ticket = computeTicketPrice(
        {
          reach: inputOf('Reach', inputs.nextFloat() * 100),
          importance: pick(inputs, EVENT_IMPORTANCES),
        },
        { tunables: TUNABLES },
      );
      const rent = computeVenueRent(
        {
          capacity,
          venueKind: pick(inputs, VENUE_KINDS),
          venueName: 'Venue',
          ownVenue: inputs.nextFloat() < 0.2,
        },
        { tunables: TUNABLES },
      );
      const merch = computeLiveMerch(
        { attendance: attendance.value, showScore: inputs.nextFloat() * 100 },
        { tunables: TUNABLES, rng: merchRng },
      );
      const grossGate = ticket.value * attendance.value;
      const shares = Array.from({ length: intBetween(inputs, 0, 6) }, (_, index) => ({
        name: `Worker ${String(index)}`,
        bp: intBetween(inputs, 0, 10_000),
      }));
      const gateShare = computeWorkerShare(
        { gross: grossGate, label: 'Gate', shares },
        { tunables: TUNABLES },
      );
      const merchShare = computeWorkerShare(
        { gross: merch.value, label: 'Merch', shares },
        { tunables: TUNABLES },
      );
      for (const amount of [
        attendance.value,
        ticket.value,
        grossGate,
        rent.value,
        merch.value,
        gateShare.value,
        merchShare.value,
      ]) {
        expectWholeCents(amount);
      }
      expect(attendance.value).toBeLessThanOrEqual(capacity);
      expect(gateShare.value).toBeLessThanOrEqual(grossGate / 2);
      expect(merchShare.value).toBeLessThanOrEqual(merch.value / 2);

      const net = computeBoxOfficeNet({
        grossGate,
        gateShare,
        rent,
        grossMerch: merch,
        merchShare,
      });
      expect(net.value).toBe(
        grossGate - gateShare.value - rent.value + merch.value - merchShare.value,
      );
      expect(Number.isSafeInteger(net.value)).toBe(true);
      // Shares never take the takings below the rent: only rent can make the net negative.
      expect(net.value + rent.value).toBeGreaterThanOrEqual(0);
    }
  });
});
