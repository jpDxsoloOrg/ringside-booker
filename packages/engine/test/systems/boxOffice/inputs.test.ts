// The forecast's world inputs: recent form and other big shows.
// Design: docs/design/box-office.md#recent-form and docs/design/box-office.md#big-show-fatigue
import { describe, expect, it } from 'vitest';
import { parseGameDate, type GameDate } from '../../../src/core/date';
import type { EventInstanceId } from '../../../src/core/ids';
import type { EventInstance } from '../../../src/model/entities/event-instance';
import { bigShowsBefore, recentFormOf } from '../../../src/systems/boxOffice';
import { createEngineTunables, type EngineTunables } from '../../../src/systems/tunables';
import { worldBuilder, type DeepPartial } from '../../support';

const DEFAULTS = createEngineTunables();
const TODAY = parseGameDate('2026-06-01');

function on(date: string): { date: GameDate; airDate: GameDate } {
  const day = parseGameDate(date);
  return { date: day, airDate: day };
}

type ShowSpec = DeepPartial<EventInstance>;

function completed(date: string, score: number, extra: ShowSpec = {}): ShowSpec {
  return {
    ...on(date),
    status: 'completed',
    result: { score, rawScore: score, traceId: null, attendance: null, gate: null, viewers: null },
    ...extra,
  };
}

function worldWith(shows: readonly ShowSpec[], rivalShows: readonly ShowSpec[] = []) {
  let builder = worldBuilder({ startDate: TODAY })
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A' })
    .withPromotion({ name: 'Test Promotion B' });
  for (const show of shows) {
    builder = builder.withEventInstance(show);
  }
  for (const show of rivalShows) {
    builder = builder.withEventInstance(show, 'B');
  }
  return builder.build();
}

function formOf(
  shows: readonly ShowSpec[],
  excludeIndex: number | null,
  tunables: EngineTunables = DEFAULTS,
  rivalShows: readonly ShowSpec[] = [],
) {
  const { world, ids } = worldWith(shows, rivalShows);
  const promotionId = ids.promotions.A;
  if (promotionId === undefined) {
    throw new Error('No promotion A');
  }
  const exclude: EventInstanceId | null =
    excludeIndex === null ? null : (ids.eventInstances[excludeIndex] ?? null);
  return {
    ids,
    form: recentFormOf(world, {
      promotionId,
      beforeDate: TODAY,
      excludeEventInstanceId: exclude,
      tunables,
    }),
  };
}

describe('recentFormOf', () => {
  it('averages the completed shows strictly before the date', () => {
    const { form, ids } = formOf(
      [completed('2026-05-01', 60), completed('2026-05-15', 80), completed('2026-05-31', 70)],
      null,
    );
    expect(form.showCount).toBe(3);
    expect(form.averageScore).toBeCloseTo(70, 12);
    expect(form.eventInstanceIds).toEqual([...ids.eventInstances].sort());
  });

  it('is empty with no shows', () => {
    const { form } = formOf([], null);
    expect(form).toEqual({ averageScore: null, showCount: 0, eventInstanceIds: [] });
  });

  it('never counts the excluded show', () => {
    const { form } = formOf([completed('2026-05-01', 60), completed('2026-05-15', 100)], 1);
    expect(form.showCount).toBe(1);
    expect(form.averageScore).toBe(60);
  });

  it('never counts a show on the same day, even a completed one', () => {
    const { form } = formOf([completed('2026-05-01', 60), completed(TODAY, 100)], null);
    expect(form.showCount).toBe(1);
    expect(form.averageScore).toBe(60);
  });

  it('keeps the window start and drops the day before it', () => {
    // 120 days before 2026-06-01 is 2026-02-01.
    const { form } = formOf([completed('2026-01-31', 10), completed('2026-02-01', 90)], null);
    expect(form.showCount).toBe(1);
    expect(form.averageScore).toBe(90);
  });

  it('counts nothing with a window of 0 days', () => {
    const none = createEngineTunables({ 'boxOffice.recentForm.windowDays': 0 });
    const { form } = formOf([completed('2026-05-31', 90)], null, none);
    expect(form.showCount).toBe(0);
  });

  it('skips cancelled and scheduled shows', () => {
    const { form } = formOf(
      [
        completed('2026-05-01', 60),
        { ...on('2026-05-10'), status: 'cancelled' },
        { ...on('2026-05-20'), status: 'scheduled' },
      ],
      null,
    );
    expect(form.showCount).toBe(1);
  });

  it('skips house shows unless told to count them', () => {
    const shows = [
      completed('2026-05-01', 60),
      completed('2026-05-10', 20, { importance: 'house' }),
    ];
    expect(formOf(shows, null).form.showCount).toBe(1);
    const withHouse = createEngineTunables({ 'boxOffice.recentForm.countHouseShows': true });
    const { form } = formOf(shows, null, withHouse);
    expect(form.showCount).toBe(2);
    expect(form.averageScore).toBe(40);
  });

  it("ignores another promotion's shows", () => {
    const { form } = formOf([completed('2026-05-01', 60)], null, DEFAULTS, [
      completed('2026-05-02', 10),
    ]);
    expect(form.showCount).toBe(1);
    expect(form.averageScore).toBe(60);
  });
});

describe('bigShowsBefore', () => {
  function bigShows(shows: readonly ShowSpec[], self: ShowSpec, tunables = DEFAULTS) {
    const { world, ids } = worldWith([...shows, self]);
    const promotionId = ids.promotions.A;
    const selfId = ids.eventInstances[shows.length];
    if (promotionId === undefined || selfId === undefined) {
      throw new Error('Missing ids');
    }
    return bigShowsBefore(world, {
      promotionId,
      date: TODAY,
      excludeEventInstanceId: selfId,
      tunables,
    });
  }

  const SELF: ShowSpec = { importance: 'major', name: 'Tonight', date: TODAY, airDate: TODAY };

  it('counts scheduled and completed major and flagship shows, oldest first', () => {
    const result = bigShows(
      [
        { ...completed('2026-05-20', 70), importance: 'flagship', name: 'Big One' },
        { ...on('2026-05-10'), importance: 'major', name: 'Earlier' },
      ],
      SELF,
    );
    expect(result).toEqual({ count: 2, names: ['Earlier', 'Big One'] });
  });

  it('leaves out cancelled shows, smaller shows and the show itself', () => {
    const result = bigShows(
      [
        {
          ...on('2026-05-20'),
          importance: 'major',
          status: 'cancelled',
        },
        { ...completed('2026-05-21', 70), importance: 'regular' },
        { ...completed('2026-05-22', 70), importance: 'minor' },
      ],
      SELF,
    );
    expect(result.count).toBe(0);
  });

  it('leaves out shows on the same day or later, and before the window', () => {
    const result = bigShows(
      [
        { date: TODAY, airDate: TODAY, importance: 'major', name: 'Same day' },
        { ...on('2026-06-05'), importance: 'major', name: 'Later' },
        // 28 days before 2026-06-01 is 2026-05-04.
        { ...on('2026-05-03'), importance: 'major', name: 'Too early' },
        { ...on('2026-05-04'), importance: 'major', name: 'Window start' },
      ],
      SELF,
    );
    expect(result).toEqual({ count: 1, names: ['Window start'] });
  });
});
