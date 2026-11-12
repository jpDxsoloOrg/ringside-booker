// WRK1's availability as one line for the lab and the warnings (MTCH1-08).
// Design: docs/design/match-rating.md#warnings
import { describe, expect, it } from 'vitest';
import { parseGameDate } from '../../../src/core/date';
import { availabilityText, shortDayText } from '../../../src/systems/match/availabilityText';

const TODAY = parseGameDate('2026-11-20');

describe('availabilityText', () => {
  it('writes the day back, with the year only when it is another year', () => {
    expect(shortDayText(parseGameDate('2026-12-03'), TODAY)).toBe('3 Dec');
    expect(shortDayText(parseGameDate('2027-03-12'), TODAY)).toBe('12 Mar 2027');
  });

  it('adds the day back to the reason, before any extra clause', () => {
    expect(
      availabilityText(
        {
          status: 'personalLeave',
          reason: 'On personal leave',
          until: parseGameDate('2026-12-12'),
          canWorkAngles: false,
        },
        TODAY,
      ),
    ).toBe('On personal leave until 12 Dec');
    expect(
      availabilityText(
        {
          status: 'injured',
          reason: 'Injured (leg injury); can still do talking segments',
          until: parseGameDate('2027-01-05'),
          canWorkAngles: true,
        },
        TODAY,
      ),
    ).toBe('Injured (leg injury) until 5 Jan 2027; can still do talking segments');
  });

  it('keeps the reason alone with no end date, and says when a debut is', () => {
    expect(
      availabilityText(
        { status: 'personalLeave', reason: 'On hiatus', until: null, canWorkAngles: false },
        TODAY,
      ),
    ).toBe('On hiatus');
    expect(
      availabilityText(
        {
          status: 'notDebuted',
          reason: 'Has not debuted yet',
          until: parseGameDate('2026-12-01'),
          canWorkAngles: false,
        },
        TODAY,
      ),
    ).toBe('Has not debuted yet (debuts 1 Dec)');
  });
});
