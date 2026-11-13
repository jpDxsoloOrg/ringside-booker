// The ticket price. Design: docs/design/box-office.md#ticket-price
import { describe, expect, it } from 'vitest';
import { inputOf, type Traced } from '../../../../src/core/trace';
import {
  EVENT_IMPORTANCES,
  type EventImportance,
} from '../../../../src/model/entities/event-definition';
import { computeTicketPrice } from '../../../../src/systems/boxOffice';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const DEFAULTS = createEngineTunables();

function price(
  reach: number,
  importance: EventImportance = 'regular',
  tunables: EngineTunables = DEFAULTS,
): Traced<number> {
  const result = computeTicketPrice(
    { reach: inputOf('Reach', reach, undefined, 'points'), importance },
    { tunables },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('computeTicketPrice', () => {
  it('is the base price at reach 0 for a regular show', () => {
    expect(price(0).value).toBe(1000);
  });

  it('adds 60 cents per point of reach', () => {
    expect(price(50).value).toBe(4000);
    expect(price(100).value).toBe(7000);
    expect(price(53.957).value).toBe(4237);
  });

  it('scales with the size of the show', () => {
    const expected: Readonly<Record<EventImportance, number>> = {
      house: 3200,
      minor: 3600,
      regular: 4000,
      major: 6000,
      flagship: 8000,
    };
    for (const importance of EVENT_IMPORTANCES) {
      expect(price(50, importance).value).toBe(expected[importance]);
    }
  });

  it('treats 0 as 0 for every tunable', () => {
    expect(price(50, 'regular', createEngineTunables({ 'boxOffice.ticket.base': 0 })).value).toBe(
      3000,
    );
    expect(
      price(50, 'regular', createEngineTunables({ 'boxOffice.ticket.perReachPoint': 0 })).value,
    ).toBe(1000);
    expect(
      price(50, 'major', createEngineTunables({ 'boxOffice.ticket.importance.major': 0 })).value,
    ).toBe(0);
  });

  it('reaches the most the tunables allow', () => {
    const tunables = createEngineTunables({
      'boxOffice.ticket.base': 100_000,
      'boxOffice.ticket.perReachPoint': 10_000,
      'boxOffice.ticket.importance.flagship': 5,
    });
    expect(price(100, 'flagship', tunables).value).toBe(5_500_000);
  });

  it('nests the reach Why? as its first line', () => {
    expect(price(40).trace.children?.[0]?.label).toBe('Reach');
  });
});
