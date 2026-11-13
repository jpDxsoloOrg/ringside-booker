// The crowd forecast for one show. Design: docs/design/box-office.md#forecast
import { describe, expect, it } from 'vitest';
import { parseGameDate, type GameDate } from '../../../src/core/date';
import type { EventInstanceId, RegionId } from '../../../src/core/ids';
import { findTraceNodes, walkTrace } from '../../../src/core/trace';
import type { EventInstance } from '../../../src/model/entities/event-instance';
import type { GameWorld } from '../../../src/model/tables';
import { forecastAttendance } from '../../../src/systems/boxOffice';
import { createEngineTunables } from '../../../src/systems/tunables';
import { worldBuilder, type DeepPartial } from '../../support';
import { aPopularityShowChange } from '../../support/builders/popularity';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';

const DEFAULTS = createEngineTunables();
const TODAY = parseGameDate('2026-06-01');

function on(date: string): { date: GameDate; airDate: GameDate } {
  const day = parseGameDate(date);
  return { date: day, airDate: day };
}

function completedOn(date: string, score: number): DeepPartial<EventInstance> {
  return {
    ...on(date),
    status: 'completed',
    result: { score, rawScore: score, traceId: null, attendance: null, gate: null, viewers: null },
  };
}

interface Built {
  readonly world: GameWorld;
  readonly show: EventInstance;
  readonly regions: readonly RegionId[];
}

/** Promotion A at popularity 60 in the first region and 30 in the second, marketing 5. */
function build(
  shows: readonly DeepPartial<EventInstance>[],
  tonight: DeepPartial<EventInstance>,
  popularityBefore: number | null = null,
): Built {
  const { world, ids } = worldBuilder({ startDate: TODAY })
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A' })
    .with('popularity and marketing', (context) => {
      const promotionId = context.ids.promotions.A;
      const [first, second] = context.ids.regions;
      if (promotionId === undefined || first === undefined || second === undefined) {
        throw new Error('Missing ids');
      }
      context.tx.update('promotions', promotionId, (promotion) => ({
        ...promotion,
        regionalPop: { [first]: 60, [second]: 30 },
        production: { ...promotion.production, marketing: 5 },
      }));
    })
    .with('shows', (context) => {
      for (const show of [...shows, tonight]) {
        const promotionId = context.ids.promotions.A;
        const [regionId] = context.ids.regions;
        if (promotionId === undefined || regionId === undefined) {
          throw new Error('Missing ids');
        }
        context.insert('eventInstances', {
          id: context.tx.mintId('eventInstances'),
          promotionId,
          eventDefinitionId: null,
          brandId: null,
          name: show.name ?? `Show ${String(context.ids.eventInstances.length + 1)}`,
          importance: show.importance ?? 'regular',
          format: { slots: 6, preShowSlots: 0 },
          date: show.date ?? TODAY,
          airDate: show.airDate ?? show.date ?? TODAY,
          status: show.status ?? 'scheduled',
          venueId: null,
          genericVenue: null,
          regionId,
          result:
            show.result === undefined || show.result === null
              ? null
              : {
                  score: show.result.score ?? 50,
                  rawScore: show.result.rawScore ?? 50,
                  traceId: null,
                  attendance: null,
                  gate: null,
                  viewers: null,
                },
          cancellation: null,
        });
      }
    })
    .with('popularity record', (context) => {
      const showId = context.ids.eventInstances.at(-1);
      const promotionId = context.ids.promotions.A;
      const [regionId] = context.ids.regions;
      if (popularityBefore === null || !showId || !promotionId || !regionId) {
        return;
      }
      context.insert(
        'popularityShowChanges',
        aPopularityShowChange(
          {
            eventInstanceId: showId,
            promotionId,
            date: TODAY,
            regions: {
              [regionId]: {
                source: 'show',
                networkId: null,
                weight: 1,
                expectation: 50,
                before: popularityBefore,
                after: 60,
                capped: false,
              },
            },
          },
          context.sequence,
        ),
      );
    })
    .build();
  const showId: EventInstanceId | undefined = ids.eventInstances.at(-1);
  const show = showId === undefined ? undefined : world.tables.eventInstances.get(showId);
  if (show === undefined) {
    throw new Error('No show');
  }
  return { world, show, regions: ids.regions };
}

function expectedFor(popularity: number, multiplier: number): number {
  return Math.round((80 + 30_000 * (popularity / 100) ** 3) * 1.2 * multiplier);
}

describe('forecastAttendance', () => {
  it("forecasts from the promotion's popularity in the show's region and its marketing", () => {
    const { world, show } = build([], {});
    const forecast = forecastAttendance(world, DEFAULTS, show);
    expect(forecast.expected.value).toBe(expectedFor(60, 1));
    expect(forecast.inputs.popularity).toBe(60);
    expect(forecast.inputs.marketingLevel).toBe(5);
    expectTraceReplays(forecast.expected);
    expectSerialisable(forecast.expected);
  });

  it('gives the range as ± the crowd spread', () => {
    const { world, show } = build([], {});
    const forecast = forecastAttendance(world, DEFAULTS, show);
    expect(forecast.low).toBe(Math.round(forecast.expected.value * 0.9));
    expect(forecast.high).toBe(Math.round(forecast.expected.value * 1.1));
    const exact = forecastAttendance(
      world,
      createEngineTunables({ 'boxOffice.crowd.spread': 0 }),
      show,
    );
    expect(exact.low).toBe(exact.expected.value);
    expect(exact.high).toBe(exact.expected.value);
  });

  it('forecasts the same show in another region when asked', () => {
    const { world, show, regions } = build([], {});
    const second = regions[1];
    if (second === undefined) {
      throw new Error('No second region');
    }
    const forecast = forecastAttendance(world, DEFAULTS, show, { regionId: second });
    expect(forecast.expected.value).toBe(expectedFor(30, 1));
    expect(forecast.inputs.regionId).toBe(second);
  });

  it('reads the popularity from before the show once the show has moved it (same-day rule)', () => {
    const { world, show } = build([], completedOn(TODAY, 90), 40);
    const forecast = forecastAttendance(world, DEFAULTS, show);
    expect(forecast.inputs.popularity).toBe(40);
    expect(forecast.expected.value).toBe(expectedFor(40, 1));
  });

  it('uses recent form from earlier shows, never the show itself', () => {
    const earlier = [
      completedOn('2026-05-01', 75),
      completedOn('2026-05-08', 75),
      completedOn('2026-05-15', 75),
    ];
    const { world, show } = build(earlier, completedOn(TODAY, 0));
    const forecast = forecastAttendance(world, DEFAULTS, show);
    expect(forecast.inputs.recentShows.showCount).toBe(3);
    expect(forecast.inputs.recentShows.eventInstanceIds).not.toContain(show.id);
    expect(forecast.expected.value).toBe(expectedFor(60, 1.15));
  });

  it('applies big-show fatigue to a major show after two other big shows', () => {
    const big = [
      { ...on('2026-05-10'), importance: 'major' as const },
      { ...on('2026-05-20'), importance: 'flagship' as const },
    ];
    const { world, show } = build(big, { importance: 'major' });
    const forecast = forecastAttendance(world, DEFAULTS, show);
    expect(forecast.inputs.bigShows.count).toBe(2);
    expect(forecast.expected.value).toBe(expectedFor(60, 1.5 * 0.8));
  });

  it('shows every driver on its own line, each multiplier once', () => {
    const { world, show } = build([], {});
    const { expected, inputs } = forecastAttendance(world, DEFAULTS, show);
    const top = (expected.trace.children ?? []).map((node) => node.label);
    expect(top).toEqual([
      `Popularity in ${inputs.regionName}: 60`,
      'Out of 100',
      'Popularity curve',
      'Crowd at full popularity',
      'Walk-up crowd',
      'Marketing level 5',
      'Regular show',
      'Recent form',
      'Big-show fatigue',
      'Hype',
      'Rounded to whole people',
      'Never below 0',
    ]);
    const hype = findTraceNodes(expected.trace, 'constant').find((node) => node.label === 'Hype');
    expect(hype?.reason).toBe('Hype is not tracked yet');
    let formulas = 0;
    walkTrace(expected.trace, (node) => {
      if (node.kind === 'formula' && node.label === 'Recent form') {
        formulas += 1;
      }
    });
    expect(formulas).toBe(1);
  });
});
