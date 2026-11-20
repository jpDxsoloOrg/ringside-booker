// The schedule editor's commands and previews. Design: docs/design/calendar.md#schedule-editor
import { describe, expect, it } from 'vitest';
import type { EventDefinitionId, EventInstanceId } from '../../../../src/core/ids';
import { aMatch, aNews } from '../../../support';
import {
  advance,
  COMPUTER,
  gameDate,
  lifecycleWorld,
  lifecycleWorldWith,
  PLAYER_ONE,
} from '../lifecycle-world';
import {
  editorEngine,
  everyWeekday,
  expectNoDanglingShowRefs,
  expectSavesAndLoadsClean,
  HORIZON_END,
  showsOf,
  weeklyDraft,
} from './editor-world';

describe('calendar.createDefinition', () => {
  it('creates a weekly Friday show with dates from the next Friday to the horizon', async () => {
    const built = lifecycleWorld();
    const engine = editorEngine(built);
    const preview = engine.query(
      'calendar.previewDefinition',
      { promotionId: built.promotionA, eventDefinitionId: null, draft: weeklyDraft() },
      { kind: 'controller', controller: PLAYER_ONE },
    );
    expect(preview).toMatchObject({
      ok: true,
      data: {
        reasons: [],
        recurrenceText: 'Every Friday',
        nextDates: ['2026-01-09', '2026-01-16', '2026-01-23', '2026-01-30', '2026-02-06'],
        plan: null,
      },
    });

    const result = engine.command(
      'calendar.createDefinition',
      { promotionId: built.promotionA, draft: weeklyDraft() },
      PLAYER_ONE,
    );
    if (!result.ok) {
      expect.fail(JSON.stringify(result.reasons));
    }
    const fridays = everyWeekday('2026-01-09', HORIZON_END);
    expect(result.data.added).toEqual(fridays);
    expect(showsOf(engine, result.data.eventDefinitionId)).toEqual(
      fridays.map((date) => [date, 'scheduled']),
    );
    const definitions = engine.query(
      'calendar.definitions',
      {},
      { kind: 'controller', controller: PLAYER_ONE },
    );
    expect(definitions).toMatchObject({
      ok: true,
      data: [
        {
          eventDefinitionId: result.data.eventDefinitionId,
          name: 'Test Friday',
          recurrenceText: 'Every Friday',
          state: 'starts',
          nextDate: '2026-01-09',
          editable: true,
        },
      ],
    });
    const loaded = await expectSavesAndLoadsClean(engine, built.promotionA);
    expect(loaded.tables.eventDefinitions.get(result.data.eventDefinitionId)?.name).toBe(
      'Test Friday',
    );
  });

  it('refuses out-of-range slots in the player words and leaves the world alone', () => {
    const built = lifecycleWorld();
    const engine = editorEngine(built);
    const before = engine.exportState().world;
    const cases: [DefinitionDraftFormat, string, string][] = [
      [{ slots: 2, preShowSlots: 0 }, 'tooFewSlots', 'A show needs at least 3 slots'],
      [{ slots: 13, preShowSlots: 0 }, 'tooManySlots', 'A show can have at most 12 slots'],
      [{ slots: 6, preShowSlots: 4 }, 'tooManyPreShowSlots', 'Pre-show slots go from 0 to 3'],
    ];
    for (const [format, code, message] of cases) {
      const result = engine.command(
        'calendar.createDefinition',
        { promotionId: built.promotionA, draft: weeklyDraft({ format }) },
        PLAYER_ONE,
      );
      expect(result).toEqual({ ok: false, reasons: [expect.objectContaining({ code, message })] });
    }
    expect(engine.exportState().world).toEqual(before);
  });

  it("refuses a rival promotion's schedule and a name already in use", () => {
    const built = lifecycleWorld({ weeklyShow: true });
    const engine = editorEngine(built);
    expect(
      engine.command(
        'calendar.createDefinition',
        { promotionId: built.promotionB, draft: weeklyDraft() },
        PLAYER_ONE,
      ),
    ).toMatchObject({
      ok: false,
      reasons: [{ code: 'notYourShow', message: 'You can only change your own shows' }],
    });
    expect(
      engine.command(
        'calendar.createDefinition',
        { promotionId: built.promotionA, draft: weeklyDraft({ name: 'test weekly' }) },
        PLAYER_ONE,
      ),
    ).toMatchObject({
      ok: false,
      reasons: [
        { code: 'nameTaken', message: 'Test Promotion A already has a show called test weekly' },
      ],
    });
    expect(
      engine.command(
        'calendar.createDefinition',
        { promotionId: built.promotionB, draft: weeklyDraft() },
        COMPUTER,
      ),
    ).toMatchObject({ ok: true });
  });

  it('applies from today when calendar.editor.minLeadDays is 0', () => {
    const built = lifecycleWorld();
    const engine = editorEngine(built, { 'calendar.editor.minLeadDays': 0 });
    const result = engine.command(
      'calendar.createDefinition',
      {
        promotionId: built.promotionA,
        draft: weeklyDraft({ recurrence: { kind: 'weekly', weekdays: [0] } }),
      },
      PLAYER_ONE,
    );
    expect(result.ok && result.data.added[0]).toBe('2026-01-05');
  });
});

function firstDefinition(ids: readonly EventDefinitionId[]): EventDefinitionId {
  const [first] = ids;
  if (first === undefined) {
    throw new Error('The world has no weekly show');
  }
  return first;
}

interface DefinitionDraftFormat {
  slots: number;
  preShowSlots: number;
}

/**
 * Promotion A's weekly Monday show with shows already on the books: a plain one on 12 Jan, a
 * booked one on 19 Jan, one with a card in progress on 26 Jan, one the news points at on 2 Feb,
 * one taped on 8 Feb for 9 Feb, a cancelled one on 16 Feb, and today's.
 */
function mondaysWorld() {
  return lifecycleWorldWith(
    (addShow, { promotionA }, context) => {
      const definitionId = firstDefinition(context.ids.eventDefinitions);
      const show = (date: string, extra: Record<string, unknown> = {}): EventInstanceId =>
        addShow({
          promotionId: promotionA,
          eventDefinitionId: definitionId,
          brandId: null,
          name: 'Test Weekly',
          date: gameDate(date),
          airDate: gameDate(date),
          ...extra,
        });
      const today = show('2026-01-05');
      const plain = show('2026-01-12');
      const booked = show('2026-01-19', { status: 'booked' });
      const withCard = show('2026-01-26');
      context.insert('segments', aMatch({ eventInstanceId: withCard }, context.sequence));
      const referenced = show('2026-02-02');
      context.insert('news', aNews({ refs: { eventInstanceId: referenced } }, context.sequence));
      const taped = show('2026-02-08', { airDate: gameDate('2026-02-09') });
      const cancelled = show('2026-02-16', {
        status: 'cancelled',
        cancellation: { reason: 'byPromotion', on: gameDate('2026-01-02') },
      });
      return { definitionId, today, plain, booked, withCard, referenced, taped, cancelled };
    },
    { weeklyShow: true },
  );
}

describe('calendar.updateDefinition', () => {
  it('switching weekly to every 2 weeks keeps invested shows and the preview matches the result', () => {
    const built = mondaysWorld();
    const { definitionId } = built.shows;
    const engine = editorEngine(built);
    const draft = weeklyDraft({
      name: 'Test Weekly',
      recurrence: {
        kind: 'everyNWeeks',
        intervalWeeks: 2,
        weekday: 0,
        anchor: gameDate('2026-01-12'),
      },
    });
    const preview = engine.query(
      'calendar.previewDefinition',
      { promotionId: built.promotionA, eventDefinitionId: definitionId, draft },
      { kind: 'controller', controller: PLAYER_ONE },
    );
    if (!preview.ok || preview.data.plan === null) {
      expect.fail(JSON.stringify(preview));
    }
    const plan = preview.data.plan;
    expect(plan.add).toEqual(['2026-02-23', '2026-03-09', '2026-03-23']);
    expect(plan.remove).toEqual([
      {
        eventInstanceId: built.shows.referenced,
        date: '2026-02-02',
        name: 'Test Weekly',
        cancel: true,
      },
    ]);
    expect(
      plan.kept.map((row) => [row.eventInstanceId, row.reason, row.reasonText, row.stillOnRule]),
    ).toEqual([
      [built.shows.booked, 'booked', 'Card already booked', false],
      [built.shows.withCard, 'hasCard', 'Card in progress', true],
      [built.shows.taped, 'taped', 'Taped, airs Mon 9 Feb 2026', true],
    ]);

    const result = engine.command(
      'calendar.updateDefinition',
      { eventDefinitionId: definitionId, draft },
      PLAYER_ONE,
    );
    if (!result.ok) {
      expect.fail(JSON.stringify(result.reasons));
    }
    expect(result.data.added).toEqual(plan.add);
    expect(result.data.removed).toEqual(plan.remove.map((row) => row.date));
    expect(result.data.kept).toEqual(plan.kept);

    const shows = new Map(
      engine.exportState().world.tables.eventInstances.map((show) => [show.id, show]),
    );
    expect(shows.get(built.shows.today)?.status).toBe('scheduled');
    expect(shows.get(built.shows.booked)?.status).toBe('booked');
    expect(shows.get(built.shows.referenced)).toMatchObject({
      status: 'cancelled',
      cancellation: { reason: 'byPromotion', on: '2026-01-05' },
    });
    expect(shows.get(built.shows.cancelled)?.cancellation?.on).toBe('2026-01-02');
    expectNoDanglingShowRefs(engine);
  });

  it('a format change refreshes unbooked shows and leaves kept ones on the old format', () => {
    const built = mondaysWorld();
    const engine = editorEngine(built);
    const draft = weeklyDraft({
      name: 'Test Weekly',
      recurrence: { kind: 'weekly', weekdays: [0] },
      format: { slots: 8, preShowSlots: 1 },
    });
    const result = engine.command(
      'calendar.updateDefinition',
      { eventDefinitionId: built.shows.definitionId, draft },
      PLAYER_ONE,
    );
    expect(result).toMatchObject({ ok: true, data: { removed: [] } });
    const shows = new Map(
      engine.exportState().world.tables.eventInstances.map((show) => [show.id, show]),
    );
    expect(shows.get(built.shows.plain)?.format).toEqual({ slots: 8, preShowSlots: 1 });
    expect(shows.get(built.shows.today)?.format).not.toEqual({ slots: 8, preShowSlots: 1 });
    expect(shows.get(built.shows.booked)?.format).not.toEqual({ slots: 8, preShowSlots: 1 });
  });

  it('refuses a draft that switches to set dates', () => {
    const built = mondaysWorld();
    const engine = editorEngine(built);
    const result = engine.command(
      'calendar.updateDefinition',
      {
        eventDefinitionId: built.shows.definitionId,
        draft: weeklyDraft({
          name: 'Test Weekly',
          recurrence: { kind: 'dates', dates: [gameDate('2026-03-01')] },
        }),
      },
      PLAYER_ONE,
    );
    expect(result).toMatchObject({ ok: false, reasons: [{ code: 'datesNotAllowed' }] });
  });
});

describe('calendar.retireDefinition', () => {
  it('removes the unbooked dates, keeps the invested ones, and the preview predicts it', () => {
    const built = mondaysWorld();
    const engine = editorEngine(built);
    const viewer = { kind: 'controller', controller: PLAYER_ONE } as const;
    const preview = engine.query(
      'calendar.previewRetire',
      { eventDefinitionId: built.shows.definitionId },
      viewer,
    );
    if (!preview.ok) {
      expect.fail(JSON.stringify(preview.reasons));
    }
    expect(preview.data.activeUntil).toBe('2026-01-05');
    expect(preview.data.removed.map((row) => row.date)).toEqual(['2026-01-12', '2026-02-02']);
    const result = engine.command(
      'calendar.retireDefinition',
      { eventDefinitionId: built.shows.definitionId },
      PLAYER_ONE,
    );
    if (!result.ok) {
      expect.fail(JSON.stringify(result.reasons));
    }
    expect(result.data.removed).toEqual(['2026-01-12', '2026-02-02']);
    expect(result.data.kept.map((row) => row.reason)).toEqual(['booked', 'hasCard', 'taped']);
    expect(
      engine.command(
        'calendar.retireDefinition',
        { eventDefinitionId: built.shows.definitionId },
        PLAYER_ONE,
      ),
    ).toMatchObject({ ok: false, reasons: [{ code: 'alreadyRetired' }] });
    expectNoDanglingShowRefs(engine);
  });

  it('a show retired before it ever ran stays valid and produces nothing', () => {
    const built = lifecycleWorld();
    const engine = editorEngine(built);
    const created = engine.command(
      'calendar.createDefinition',
      { promotionId: built.promotionA, draft: weeklyDraft({ activeFrom: gameDate('2026-03-02') }) },
      PLAYER_ONE,
    );
    if (!created.ok) {
      expect.fail(JSON.stringify(created.reasons));
    }
    const retired = engine.command(
      'calendar.retireDefinition',
      { eventDefinitionId: created.data.eventDefinitionId },
      PLAYER_ONE,
    );
    expect(retired).toMatchObject({ ok: true, data: { activeUntil: '2026-01-05' } });
    const stored = engine
      .exportState()
      .world.tables.eventDefinitions.find((row) => row.id === created.data.eventDefinitionId);
    expect(stored).toMatchObject({ activeFrom: '2026-01-05', activeUntil: '2026-01-05' });
    expect(showsOf(engine, created.data.eventDefinitionId)).toEqual([]);
  });
});

describe('calendar.addOneOff', () => {
  const special = (overrides: Record<string, unknown> = {}) => ({
    name: 'Test Bash',
    brandId: null,
    importance: 'major' as const,
    format: { slots: 8, preShowSlots: 1 },
    date: gameDate('2026-01-17'),
    regionId: null,
    venueId: null,
    ...overrides,
  });

  it('adds one scheduled show with its own format and warns about a same-night show', async () => {
    const built = lifecycleWorldWith((addShow, { promotionA }) =>
      addShow({
        promotionId: promotionA,
        brandId: null,
        name: 'Test Weekly',
        date: gameDate('2026-01-12'),
      }),
    );
    const engine = editorEngine(built);
    const result = engine.command(
      'calendar.addOneOff',
      { promotionId: built.promotionA, ...special() },
      PLAYER_ONE,
    );
    if (!result.ok) {
      expect.fail(JSON.stringify(result.reasons));
    }
    const show = engine
      .exportState()
      .world.tables.eventInstances.find((row) => row.id === result.data.eventInstanceId);
    expect(show).toMatchObject({
      eventDefinitionId: null,
      status: 'scheduled',
      date: '2026-01-17',
      format: { slots: 8, preShowSlots: 1 },
    });
    const clash = engine.query(
      'calendar.checkNewShow',
      {
        show: {
          promotionId: built.promotionA,
          ...special({ name: 'Other', date: gameDate('2026-01-12') }),
        },
      },
      { kind: 'controller', controller: PLAYER_ONE },
    );
    expect(clash).toMatchObject({
      ok: true,
      data: {
        reasons: [],
        warnings: [
          { code: 'sameNightShow', message: 'Test Promotion A already has Test Weekly that night' },
        ],
      },
    });
    await expectSavesAndLoadsClean(engine, built.promotionA);
  });

  it('refuses a date before today plus the lead days, and a rival promotion', () => {
    const built = lifecycleWorld();
    const engine = editorEngine(built);
    expect(
      engine.command(
        'calendar.addOneOff',
        { promotionId: built.promotionA, ...special({ date: gameDate('2026-01-05') }) },
        PLAYER_ONE,
      ),
    ).toMatchObject({
      ok: false,
      reasons: [{ code: 'dateTooSoon', message: 'Pick a date from Tue 6 Jan 2026' }],
    });
    expect(
      engine.command(
        'calendar.addOneOff',
        { promotionId: built.promotionB, ...special() },
        PLAYER_ONE,
      ),
    ).toMatchObject({ ok: false, reasons: [{ code: 'notYourShow' }] });
  });
});

describe('the editor queries', () => {
  it('editorOptions lists importances with their default card size', () => {
    const built = lifecycleWorld();
    const engine = editorEngine(built);
    const options = engine.query(
      'calendar.editorOptions',
      { promotionId: built.promotionA },
      { kind: 'controller', controller: PLAYER_ONE },
    );
    if (!options.ok || options.data === null) {
      expect.fail(JSON.stringify(options));
    }
    expect(options.data).toMatchObject({ editable: true, effectiveFrom: '2026-01-06' });
    expect(options.data.importances.find((row) => row.importance === 'major')).toEqual({
      importance: 'major',
      label: 'Major event',
      defaultFormat: { slots: 8, preShowSlots: 1 },
    });
    const rival = engine.query(
      'calendar.editorOptions',
      { promotionId: built.promotionB },
      { kind: 'controller', controller: PLAYER_ONE },
    );
    expect(rival).toMatchObject({ ok: true, data: { editable: false } });
  });
});

describe('the daily horizon after editor changes', () => {
  it('never duplicates or revives the dates of a created, an updated and a retired show', async () => {
    const built = lifecycleWorld({ weeklyShow: true });
    const engine = editorEngine(built);
    const weekly = firstDefinition(built.ids.eventDefinitions);
    const created = engine.command(
      'calendar.createDefinition',
      { promotionId: built.promotionA, draft: weeklyDraft() },
      PLAYER_ONE,
    );
    if (!created.ok) {
      expect.fail(JSON.stringify(created.reasons));
    }
    expect(
      engine.command(
        'calendar.updateDefinition',
        {
          eventDefinitionId: created.data.eventDefinitionId,
          draft: weeklyDraft({ recurrence: { kind: 'weekly', weekdays: [4, 5] } }),
        },
        PLAYER_ONE,
      ),
    ).toMatchObject({ ok: true });
    expect(
      engine.command('calendar.retireDefinition', { eventDefinitionId: weekly }, PLAYER_ONE),
    ).toMatchObject({ ok: true });
    await advance(engine, 21);
    const dates = showsOf(engine, created.data.eventDefinitionId).map(([date]) => date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates.slice(0, 4)).toEqual(['2026-01-09', '2026-01-10', '2026-01-16', '2026-01-17']);
    expect(showsOf(engine, weekly).filter(([date]) => date > '2026-01-05')).toEqual([]);
    expectNoDanglingShowRefs(engine);
  });
});
