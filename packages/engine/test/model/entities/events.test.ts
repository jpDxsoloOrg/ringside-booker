import { describe, expect, it } from 'vitest';
import {
  EventDefinitionSchema,
  RecurrenceSchema,
} from '../../../src/model/entities/event-definition';
import { EventInstanceSchema } from '../../../src/model/entities/event-instance';
import {
  check,
  date,
  definitionId,
  emptyShowWorld,
  instanceId,
  makeDefinition,
  makeInstance,
  promotionId,
} from '../../support/show-world';

describe('RecurrenceSchema', () => {
  it('rejects a weekly recurrence with duplicate weekdays', () => {
    expect(RecurrenceSchema.safeParse({ kind: 'weekly', weekdays: [0, 3, 0] }).success).toBe(false);
    expect(RecurrenceSchema.safeParse({ kind: 'weekly', weekdays: [0, 3] }).success).toBe(true);
  });

  it('rejects a weekly recurrence with no weekdays', () => {
    expect(RecurrenceSchema.safeParse({ kind: 'weekly', weekdays: [] }).success).toBe(false);
  });

  it('rejects an unsorted or duplicated dates list', () => {
    const unsorted = { kind: 'dates', dates: [date('2026-03-04'), date('2026-03-01')] };
    expect(RecurrenceSchema.safeParse(unsorted).success).toBe(false);
    const duplicated = { kind: 'dates', dates: [date('2026-03-01'), date('2026-03-01')] };
    expect(RecurrenceSchema.safeParse(duplicated).success).toBe(false);
    const sorted = { kind: 'dates', dates: [date('2026-03-01'), date('2026-03-04')] };
    expect(RecurrenceSchema.safeParse(sorted).success).toBe(true);
  });

  it('accepts everyNWeeks intervals 2-8 only', () => {
    const recurrence = (intervalWeeks: number): unknown => ({
      kind: 'everyNWeeks',
      intervalWeeks,
      weekday: 2,
      anchor: date('2026-01-07'),
    });
    expect(RecurrenceSchema.safeParse(recurrence(1)).success).toBe(false);
    expect(RecurrenceSchema.safeParse(recurrence(9)).success).toBe(false);
    expect(RecurrenceSchema.safeParse(recurrence(2)).success).toBe(true);
    expect(RecurrenceSchema.safeParse(recurrence(8)).success).toBe(true);
  });

  it('rejects an unknown kind and a monthly week outside 1-4 or last', () => {
    expect(RecurrenceSchema.safeParse({ kind: 'daily' }).success).toBe(false);
    expect(RecurrenceSchema.safeParse({ kind: 'monthly', week: 5, weekday: 0 }).success).toBe(
      false,
    );
    expect(RecurrenceSchema.safeParse({ kind: 'monthly', week: 'last', weekday: 0 }).success).toBe(
      true,
    );
  });

  it('rejects an annual month outside 1-12', () => {
    expect(
      RecurrenceSchema.safeParse({ kind: 'annual', month: 13, week: 1, weekday: 0 }).success,
    ).toBe(false);
  });
});

describe('EventDefinitionSchema', () => {
  it('accepts a valid definition', () => {
    expect(EventDefinitionSchema.safeParse(makeDefinition(1)).success).toBe(true);
  });

  it('accepts 3 and 12 main-card slots and rejects 2 and 13', () => {
    const withSlots = (slots: number): unknown => ({
      ...makeDefinition(1),
      format: { slots, preShowSlots: 0 },
    });
    expect(EventDefinitionSchema.safeParse(withSlots(2)).success).toBe(false);
    expect(EventDefinitionSchema.safeParse(withSlots(13)).success).toBe(false);
    expect(EventDefinitionSchema.safeParse(withSlots(3)).success).toBe(true);
    expect(EventDefinitionSchema.safeParse(withSlots(12)).success).toBe(true);
  });

  it('accepts 0-3 pre-show slots and rejects 4', () => {
    const withPreShow = (preShowSlots: number): unknown => ({
      ...makeDefinition(1),
      format: { slots: 8, preShowSlots },
    });
    expect(EventDefinitionSchema.safeParse(withPreShow(3)).success).toBe(true);
    expect(EventDefinitionSchema.safeParse(withPreShow(4)).success).toBe(false);
  });

  it('rejects any field outside the schema', () => {
    expect(
      EventDefinitionSchema.safeParse({ ...makeDefinition(1), runningTimeMinutes: 120 }).success,
    ).toBe(false);
    expect(
      EventDefinitionSchema.safeParse({
        ...makeDefinition(1),
        format: { slots: 6, preShowSlots: 0, minutes: 120 },
      }).success,
    ).toBe(false);
  });

  it('rejects activeUntil before activeFrom', () => {
    const definition = makeDefinition(1, {
      activeFrom: date('2026-02-01'),
      activeUntil: date('2026-01-01'),
    });
    expect(EventDefinitionSchema.safeParse(definition).success).toBe(false);
  });
});

describe('EventInstanceSchema', () => {
  it('accepts a valid instance, live or taped', () => {
    expect(EventInstanceSchema.safeParse(makeInstance(1)).success).toBe(true);
    const taped = makeInstance(1, { date: date('2026-01-05'), airDate: date('2026-01-12') });
    expect(EventInstanceSchema.safeParse(taped).success).toBe(true);
  });

  it('rejects an airDate before the date', () => {
    const instance = makeInstance(1, { date: date('2026-01-05'), airDate: date('2026-01-04') });
    expect(EventInstanceSchema.safeParse(instance).success).toBe(false);
  });

  it('rejects a result on a scheduled instance and requires one on a completed one', () => {
    const result = {
      score: 70,
      rawScore: 70,
      traceId: null,
      attendance: 1200,
      gate: 0,
      viewers: null,
    };
    expect(
      EventInstanceSchema.safeParse({ ...makeInstance(1, { status: 'scheduled' }), result })
        .success,
    ).toBe(false);
    expect(EventInstanceSchema.safeParse(makeInstance(1, { status: 'completed' })).success).toBe(
      false,
    );
    expect(
      EventInstanceSchema.safeParse({ ...makeInstance(1, { status: 'completed' }), result })
        .success,
    ).toBe(true);
  });

  it('rejects an instance without a format', () => {
    const withoutFormat = Object.fromEntries(
      Object.entries(makeInstance(1)).filter(([field]) => field !== 'format'),
    );
    expect(EventInstanceSchema.safeParse(withoutFormat).success).toBe(false);
  });
});

describe('eventDefinitions and eventInstances tables', () => {
  it('index instances by promotion, date and definition', () => {
    const world = emptyShowWorld();
    world.tables.eventDefinitions._put(makeDefinition(1));
    world.tables.eventInstances._put(makeInstance(1, { eventDefinitionId: definitionId(1) }));
    world.tables.eventInstances._put(
      makeInstance(2, { date: date('2026-01-12'), airDate: date('2026-01-12') }),
    );
    expect(world.tables.eventInstances.lookup('byPromotion', promotionId(1))).toHaveLength(2);
    expect(world.tables.eventInstances.lookup('byDate', date('2026-01-12'))[0]?.id).toBe(
      instanceId(2),
    );
    expect(world.tables.eventInstances.lookup('byDefinition', definitionId(1))[0]?.id).toBe(
      instanceId(1),
    );
    expect(world.tables.eventDefinitions.lookup('byPromotion', promotionId(1))).toHaveLength(1);
    expect(check(world)).toEqual({ ok: true, issues: [], truncated: 0 });
  });

  it('reports an instance whose definition does not exist', () => {
    const world = emptyShowWorld();
    world.tables.eventInstances._put(makeInstance(1, { eventDefinitionId: definitionId(9) }));
    expect(check(world).issues).toEqual([
      expect.objectContaining({ code: 'ref.dangling', path: 'eventDefinitionId' }),
    ]);
  });
});
