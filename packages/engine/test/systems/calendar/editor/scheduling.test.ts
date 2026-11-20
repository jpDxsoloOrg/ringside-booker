// Manage shows lists only dates the Calendar has, and says why a show has none (UNITY-40).
// Design: docs/design/calendar.md#schedule-editor
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../../src/core/api';
import type { PromotionId } from '../../../../src/core/ids';
import type { DefinitionRow } from '../../../../src/systems/calendar/editor';
import { SYSTEMS_WITHOUT_SHOW_DAY_GATE, worldBuilder } from '../../../support';
import type { PromotionLabel } from '../../../support/world-builder';
import { advance, gameDate, OMNISCIENT } from '../lifecycle-world';

/**
 * One promotion per case, each with one show, starting Monday 5 January 2026:
 * - `running`: a weekly Monday show;
 * - `annual`: a show on the second Friday of October (past the 90-day horizon);
 * - `closed`: a closed promotion's weekly show;
 * - `darkBrand`: a weekly show on a brand that is not running;
 * - `noDates`: a show whose only date is before the start.
 */
function schedulingWorld(horizonDays?: number) {
  const built = worldBuilder({ startDate: '2026-01-05' })
    .withGeography('mini')
    .withPromotion({ name: 'Test Running' }, (promotion) =>
      promotion.withWeeklyShow({ name: 'Test Weekly', weekdays: [0] }),
    )
    .withPromotion({ name: 'Test Annual' }, (promotion) =>
      promotion.withWeeklyShow(
        { name: 'Test October Special' },
        { recurrence: { kind: 'annual', month: 10, week: 2, weekday: 4 } },
      ),
    )
    .withPromotion({ name: 'Test Closed', status: 'closed' }, (promotion) =>
      promotion.withWeeklyShow({ name: 'Test Closed Weekly' }),
    )
    .withPromotion({ name: 'Test Dark' }, (promotion) =>
      promotion
        .withBrand({ name: 'Test Dark Brand', active: false })
        .withWeeklyShow({ name: 'Test Dark Weekly' }),
    )
    .withPromotion({ name: 'Test Ended' }, (promotion) =>
      promotion.withWeeklyShow(
        { name: 'Test Old Tour' },
        { recurrence: { kind: 'dates', dates: [gameDate('2025-12-01')] } },
      ),
    )
    .build();
  const ids = built.ids.promotions;
  const promotion = (letter: PromotionLabel): PromotionId => {
    const id = ids[letter];
    if (id === undefined) {
      throw new Error(`The scheduling world has no promotion ${letter}`);
    }
    return id;
  };
  const running = promotion('A');
  const annual = promotion('B');
  const closed = promotion('C');
  const darkBrand = promotion('D');
  const noDates = promotion('E');
  const overrides: Record<string, number> =
    horizonDays === undefined ? {} : { 'calendar.scheduleHorizonDays': horizonDays };
  const engine = createEngine({
    state: { ...initialEngineState(built.world), tunableOverrides: overrides },
    systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE,
  });
  return { engine, promotions: { running, annual, closed, darkBrand, noDates } };
}

function rowOf(engine: Engine, promotionId: PromotionId): DefinitionRow {
  const result = engine.query('calendar.definitions', { promotionId }, OMNISCIENT);
  if (!result.ok) {
    expect.fail(JSON.stringify(result.reasons));
  }
  const [row] = result.data;
  if (row === undefined) {
    expect.fail('The promotion has no recurring show');
  }
  return row;
}

/** The dates of the stored shows the Calendar lists for the promotion from `from` through `to`. */
function calendarDates(engine: Engine, promotionId: PromotionId, from: string, to: string) {
  const result = engine.query(
    'calendar.range',
    { from: gameDate(from), to: gameDate(to), scope: 'world', promotionId },
    OMNISCIENT,
  );
  if (!result.ok) {
    expect.fail(JSON.stringify(result.reasons));
  }
  return result.data.shows.map((show) => show.date);
}

describe('calendar.definitions next dates (UNITY-40)', () => {
  it("gives a running show's next date from the shows on the calendar", async () => {
    const { engine, promotions } = schedulingWorld();
    await advance(engine, 1);
    const row = rowOf(engine, promotions.running);
    expect(row.state).toBe('running');
    expect(row.nextDate).toBe('2026-01-12');
    expect(row.scheduling).toEqual({
      status: 'onCalendar',
      ruleDate: null,
      addedOn: null,
      text: null,
      fix: null,
    });
    expect(calendarDates(engine, promotions.running, '2026-01-06', '2026-01-31')[0]).toBe(
      row.nextDate,
    );
  });

  it('lists no date for a show past the horizon and says when it goes on the calendar', async () => {
    const { engine, promotions } = schedulingWorld();
    await advance(engine, 1);
    const row = rowOf(engine, promotions.annual);
    expect(row.state).toBe('running');
    // Before UNITY-40 this was the rule's 9 October, which the Calendar does not have.
    expect(row.nextDate).toBeNull();
    expect(calendarDates(engine, promotions.annual, '2026-01-06', '2026-12-31')).toEqual([]);
    expect(row.scheduling).toEqual({
      status: 'later',
      ruleDate: '2026-10-09',
      addedOn: '2026-07-11',
      text: 'Not on the calendar yet: the next show is Fri 9 Oct 2026. Shows go on the calendar 90 days ahead, so it is added on Sat 11 Jul 2026.',
      fix: null,
    });
  });

  it('stores a show once the horizon reaches its date', async () => {
    const { engine, promotions } = schedulingWorld(30);
    await advance(engine, 1);
    expect(rowOf(engine, promotions.annual).scheduling).toMatchObject({
      status: 'later',
      ruleDate: '2026-10-09',
      addedOn: '2026-09-09',
    });
    const longer = schedulingWorld(280);
    await advance(longer.engine, 1);
    const row = rowOf(longer.engine, longer.promotions.annual);
    expect(row.nextDate).toBe('2026-10-09');
    expect(row.scheduling.status).toBe('onCalendar');
    expect(
      calendarDates(longer.engine, longer.promotions.annual, '2026-10-01', '2026-10-31'),
    ).toEqual(['2026-10-09']);
  });

  it("says a closed promotion's show cannot go on the calendar", async () => {
    const { engine, promotions } = schedulingWorld();
    await advance(engine, 1);
    const row = rowOf(engine, promotions.closed);
    expect(row.nextDate).toBeNull();
    expect(row.scheduling).toEqual({
      status: 'blocked',
      ruleDate: null,
      addedOn: null,
      text: 'Not on the calendar: Test Closed has closed, so it runs no shows.',
      fix: null,
    });
  });

  it('says a show on a brand that is not running needs another brand', async () => {
    const { engine, promotions } = schedulingWorld();
    await advance(engine, 1);
    const row = rowOf(engine, promotions.darkBrand);
    expect(row.nextDate).toBeNull();
    expect(calendarDates(engine, promotions.darkBrand, '2026-01-06', '2026-03-31')).toEqual([]);
    expect(row.scheduling).toEqual({
      status: 'blocked',
      ruleDate: null,
      addedOn: null,
      text: 'Not on the calendar: the Test Dark Brand brand is not running. Edit the show to move it to another brand or the whole promotion.',
      fix: 'edit',
    });
  });

  it('says a show whose dates are all past has none left', async () => {
    const { engine, promotions } = schedulingWorld();
    await advance(engine, 1);
    const row = rowOf(engine, promotions.noDates);
    expect(row.nextDate).toBeNull();
    expect(row.scheduling).toMatchObject({ status: 'noDates', fix: 'edit' });
    expect(row.scheduling.text).toBe(
      'Not on the calendar: its schedule has no dates left. Edit the show to give it new dates, or retire it.',
    );
  });
});
