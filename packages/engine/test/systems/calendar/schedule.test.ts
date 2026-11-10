// Scheduling shows from definitions. Design: docs/design/calendar.md#horizon
import { describe, expect, it } from 'vitest';
import { parseGameDate, type GameDate } from '../../../src/core/date';
import type { EventDefinitionId } from '../../../src/core/ids';
import type { EventDefinition } from '../../../src/model/entities/event-definition';
import type { GameWorld } from '../../../src/model/tables';
import {
  isSchedulable,
  MAX_OCCURRENCES_PER_WINDOW,
  occurrencesBetween,
  scheduleAll,
  scheduleDefinitionWindow,
} from '../../../src/systems/calendar';
import {
  aBrand,
  anEventDefinition,
  anEventInstance,
  aPromotion,
  testId,
  worldBuilder,
  type BuildContext,
  type BuiltWorld,
  type DeepPartial,
} from '../../support';

const START = '2026-01-05'; // a Monday

function day(text: string): GameDate {
  return parseGameDate(text);
}

function occurrences(
  overrides: DeepPartial<EventDefinition>,
  from: string,
  to: string,
): readonly string[] {
  return occurrencesBetween(anEventDefinition(overrides), day(from), day(to));
}

/** A world with one promotion that has one definition, built from `overrides`. */
function worldWithDefinition(overrides: DeepPartial<EventDefinition> = {}): BuiltWorld {
  return worldBuilder({ startDate: START })
    .withGeography('mini')
    .withPromotion({}, (promotion) => promotion.withWeeklyShow({ name: 'Test Weekly' }, overrides))
    .build();
}

function firstDefinition(built: BuiltWorld): EventDefinitionId {
  const [definitionId] = built.ids.eventDefinitions;
  if (definitionId === undefined) {
    throw new Error('the world should have a definition');
  }
  return definitionId;
}

function must<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('expected a value');
  }
  return value;
}

function runSchedule(world: GameWorld, from: string, to: string) {
  const result = world.transact('schedule', (tx) => scheduleAll(tx, tx.view, day(from), day(to)));
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

function showDates(world: GameWorld): string[] {
  return world.tables.eventInstances.values().map((instance) => instance.airDate);
}

describe('occurrencesBetween', () => {
  it('lists a weekly show on each of its weekdays, both ends included', () => {
    expect(
      occurrences({ recurrence: { kind: 'weekly', weekdays: [0, 3] } }, '2026-01-05', '2026-01-19'),
    ).toEqual(['2026-01-05', '2026-01-08', '2026-01-12', '2026-01-15', '2026-01-19']);
  });

  it('lists an every-other-week show from its anchor and nothing before it', () => {
    const recurrence = {
      kind: 'everyNWeeks',
      intervalWeeks: 2,
      weekday: 2,
      anchor: day('2026-01-21'),
    } as const;
    expect(occurrences({ recurrence }, '2026-01-05', '2026-02-20')).toEqual([
      '2026-01-21',
      '2026-02-04',
      '2026-02-18',
    ]);
    expect(occurrences({ recurrence }, '2026-01-05', '2026-01-20')).toEqual([]);
  });

  it('lists a monthly show on the last Sunday of each month', () => {
    expect(
      occurrences(
        { recurrence: { kind: 'monthly', week: 'last', weekday: 6 } },
        '2026-01-05',
        '2026-03-31',
      ),
    ).toEqual(['2026-01-25', '2026-02-22', '2026-03-29']);
  });

  it('lists an annual show once a year', () => {
    expect(
      occurrences(
        { recurrence: { kind: 'annual', month: 2, week: 2, weekday: 6 } },
        '2026-01-05',
        '2027-12-31',
      ),
    ).toEqual(['2026-02-08', '2027-02-14']);
  });

  it('lists only the dates of a dates recurrence that fall in the window', () => {
    expect(
      occurrences(
        {
          recurrence: {
            kind: 'dates',
            dates: [day('2026-01-01'), day('2026-01-10'), day('2026-02-01'), day('2026-06-01')],
          },
          activeFrom: day('2026-01-01'),
        },
        '2026-01-05',
        '2026-02-01',
      ),
    ).toEqual(['2026-01-10', '2026-02-01']);
  });

  it('includes the first day of the window when the show runs on it', () => {
    expect(occurrences({}, '2026-01-05', '2026-01-05')).toEqual(['2026-01-05']);
  });

  it('clips the window to activeFrom and activeUntil', () => {
    expect(
      occurrences(
        { activeFrom: day('2026-01-12'), activeUntil: day('2026-01-26') },
        '2026-01-05',
        '2026-03-01',
      ),
    ).toEqual(['2026-01-12', '2026-01-19', '2026-01-26']);
    expect(
      occurrences({ activeFrom: day('2026-03-02') }, '2026-01-05', '2026-03-01'),
      'not active yet',
    ).toEqual([]);
    expect(
      occurrences(
        { activeFrom: day('2025-01-06'), activeUntil: day('2026-01-04') },
        '2026-01-05',
        '2026-03-01',
      ),
      'already ended',
    ).toEqual([]);
  });

  it('returns nothing for a window that ends before it starts', () => {
    expect(occurrences({}, '2026-02-01', '2026-01-05')).toEqual([]);
  });

  it(`stops a daily show at ${String(MAX_OCCURRENCES_PER_WINDOW)} dates`, () => {
    const daily = occurrences(
      { recurrence: { kind: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] } },
      '2026-01-05',
      '2028-01-05',
    );
    expect(daily).toHaveLength(MAX_OCCURRENCES_PER_WINDOW);
    expect(daily[0]).toBe('2026-01-05');
    // 400 days in a row: the 400th is 399 days after the first.
    expect(daily.at(-1)).toBe('2027-02-08');
  });
});

describe('isSchedulable', () => {
  function worldWith(setup: (context: BuildContext) => EventDefinition): {
    world: GameWorld;
    definition: EventDefinition;
  } {
    let definition: EventDefinition | undefined;
    const { world } = worldBuilder({ startDate: START })
      .withGeography('mini')
      .with('a definition', (context) => {
        definition = setup(context);
      })
      .build();
    if (definition === undefined) {
      throw new Error('setup should return the definition');
    }
    return { world, definition };
  }

  function promotionShow(
    context: BuildContext,
    status: 'active' | 'dormant' | 'closed',
    brandActive: boolean | null,
  ): EventDefinition {
    const regionId = must(context.ids.regions[0]);
    const promotion = context.insert(
      'promotions',
      aPromotion({ homeRegionId: regionId, status }, context.sequence),
    );
    const brand =
      brandActive === null
        ? null
        : context.insert(
            'brands',
            aBrand({ promotionId: promotion.id, active: brandActive }, context.sequence),
          );
    return context.insert(
      'eventDefinitions',
      anEventDefinition(
        { promotionId: promotion.id, brandId: brand?.id ?? null },
        context.sequence,
      ),
    );
  }

  it.each([
    ['an active promotion with no brand', 'active', null, true],
    ['an active promotion with an active brand', 'active', true, true],
    ['an active promotion with an inactive brand', 'active', false, false],
    ['a dormant promotion', 'dormant', null, false],
    ['a closed promotion', 'closed', null, false],
  ] as const)('%s', (_name, status, brandActive, expected) => {
    const { world, definition } = worldWith((context) =>
      promotionShow(context, status, brandActive),
    );
    expect(isSchedulable(world, definition)).toBe(expected);
    const summary = runSchedule(world, '2026-01-05', '2026-02-01');
    expect(summary.created).toBe(expected ? 4 : 0);
    expect(world.tables.eventInstances.values()).toHaveLength(expected ? 4 : 0);
  });
});

describe('scheduleDefinitionWindow and scheduleAll', () => {
  it('stores one scheduled show per date, copied from the definition', () => {
    const built = worldBuilder({ startDate: START })
      .withGeography('mini')
      .withPromotion({}, (promotion) =>
        promotion
          .withBrand({ name: 'Test Brand' })
          .withWeeklyShow(
            { name: 'Big Night' },
            { importance: 'major', format: { slots: 8, preShowSlots: 1 } },
          ),
      )
      .build();
    const { world, ids } = built;
    const summary = runSchedule(world, '2026-01-05', '2026-01-19');

    expect(summary.created).toBe(3);
    expect([...summary.createdByPromotion.entries()]).toEqual([[ids.promotions.A, 3]]);
    const instances = world.tables.eventInstances.values();
    expect(instances.map((instance) => instance.id)).toEqual(summary.instanceIds);
    expect(instances.map((instance) => instance.date)).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
    ]);
    for (const instance of instances) {
      expect(instance).toMatchObject({
        promotionId: ids.promotions.A,
        eventDefinitionId: firstDefinition(built),
        brandId: ids.brands[0],
        name: 'Big Night',
        importance: 'major',
        format: { slots: 8, preShowSlots: 1 },
        airDate: instance.date,
        status: 'scheduled',
        venueId: null,
        regionId: ids.regions[0],
        result: null,
        cancellation: null,
      });
    }
  });

  it('creates nothing the second time over the same window', () => {
    const { world } = worldWithDefinition();
    expect(runSchedule(world, '2026-01-05', '2026-02-01').created).toBe(4);
    const second = runSchedule(world, '2026-01-05', '2026-02-01');
    expect(second.created).toBe(0);
    expect(second.instanceIds).toEqual([]);
    expect(second.createdByPromotion.size).toBe(0);
    expect(world.tables.eventInstances.values()).toHaveLength(4);
  });

  it('creates only the newly reached dates when the window moves on', () => {
    const { world } = worldWithDefinition();
    runSchedule(world, '2026-01-05', '2026-01-19');
    expect(runSchedule(world, '2026-01-06', '2026-01-26').created).toBe(1);
    expect(showDates(world)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
  });

  it('never re-creates a cancelled show', () => {
    const built = worldWithDefinition();
    const { world, ids } = built;
    world.transact('cancelled show', (tx) =>
      tx.insert(
        'eventInstances',
        anEventInstance({
          promotionId: must(ids.promotions.A),
          eventDefinitionId: firstDefinition(built),
          regionId: must(ids.regions[0]),
          date: day('2026-01-12'),
          status: 'cancelled',
        }),
      ),
    );
    expect(runSchedule(world, '2026-01-05', '2026-01-19').created).toBe(2);
    expect(showDates(world).sort()).toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
    expect(
      world.tables.eventInstances.values().filter((instance) => instance.status === 'cancelled'),
    ).toHaveLength(1);
  });

  it('never re-creates a show taped on an earlier day for the same air date', () => {
    const built = worldWithDefinition();
    const { world, ids } = built;
    world.transact('taped show', (tx) =>
      tx.insert(
        'eventInstances',
        anEventInstance({
          promotionId: must(ids.promotions.A),
          eventDefinitionId: firstDefinition(built),
          regionId: must(ids.regions[0]),
          date: day('2026-01-10'),
          airDate: day('2026-01-12'),
        }),
      ),
    );
    expect(runSchedule(world, '2026-01-05', '2026-01-19').created).toBe(2);
    expect(showDates(world).sort()).toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
    expect(
      world.tables.eventInstances.values().filter((instance) => instance.date === '2026-01-10'),
    ).toHaveLength(1);
  });

  it('leaves one-off shows alone', () => {
    const { world, ids } = worldWithDefinition();
    world.transact('one-off', (tx) =>
      tx.insert(
        'eventInstances',
        anEventInstance({
          promotionId: must(ids.promotions.A),
          regionId: must(ids.regions[0]),
          date: day('2026-01-12'),
        }),
      ),
    );
    expect(runSchedule(world, '2026-01-05', '2026-01-19').created).toBe(3);
    expect(world.tables.eventInstances.lookup('byDate', '2026-01-12')).toHaveLength(2);
  });

  it('schedules definitions in id order and counts per promotion', () => {
    const { world, ids } = worldBuilder({ startDate: START })
      .withGeography('mini')
      .withPromotion({}, (promotion) =>
        promotion.withWeeklyShow({ name: 'A Monday' }).withWeeklyShow({ weekdays: [3] }),
      )
      .withPromotion({}, (promotion) => promotion.withWeeklyShow({ weekdays: [5] }))
      .build();
    const summary = runSchedule(world, '2026-01-05', '2026-01-18');
    expect([...summary.createdByPromotion.entries()]).toEqual([
      [ids.promotions.A, 4],
      [ids.promotions.B, 2],
    ]);
    const definitionOrder = summary.instanceIds.map(
      (instanceId) => world.tables.eventInstances.get(instanceId)?.eventDefinitionId,
    );
    expect(definitionOrder).toEqual([...definitionOrder].sort());
  });

  it('refuses a definition that is not in the world', () => {
    const { world } = worldWithDefinition();
    const result = world.transact('missing', (tx) =>
      scheduleDefinitionWindow(
        tx,
        tx.view,
        testId('eventDefinition', 999),
        day('2026-01-05'),
        day('2026-01-19'),
      ),
    );
    expect(result.ok).toBe(false);
  });

  it('refuses a second show for the same definition and air date at the index', () => {
    const built = worldWithDefinition();
    const { world, ids } = built;
    runSchedule(world, '2026-01-05', '2026-01-05');
    const result = world.transact('duplicate', (tx) =>
      tx.insert(
        'eventInstances',
        anEventInstance({
          promotionId: must(ids.promotions.A),
          eventDefinitionId: firstDefinition(built),
          regionId: must(ids.regions[0]),
          date: day('2026-01-05'),
        }),
      ),
    );
    expect(result.ok).toBe(false);
  });
});
