// Who may read a card and whether it can still change. Design: docs/design/booking.md#who-may-edit-a-show
import { describe, expect, it } from 'vitest';
import { controllerViewer, OMNISCIENT_VIEWER } from '../../../src/core/api';
import { parseGameDate } from '../../../src/core/date';
import type { EventInstance } from '../../../src/model/entities/event-instance';
import { canReadCard, editBlockOf, type CardShow } from '../../../src/systems/booking';
import { anEventInstance } from '../../support';
import {
  COMPUTER,
  lifecycleWorld,
  PLAYER_ONE,
  PLAYER_THREE,
  PLAYER_TWO,
} from '../calendar/lifecycle-world';

describe('canReadCard', () => {
  it('lets the omniscient viewer read every card', () => {
    const { world, promotionA, promotionB, rivalBrand } = lifecycleWorld();
    for (const show of [
      anEventInstance({ promotionId: promotionA }),
      anEventInstance({ promotionId: promotionA, brandId: rivalBrand }),
      anEventInstance({ promotionId: promotionB }),
    ]) {
      expect(canReadCard(world, OMNISCIENT_VIEWER, show)).toBe(true);
    }
  });

  it('lets a controller read the cards of the shows it runs, and no others', () => {
    const { world, promotionA, promotionB, sharedBrand, rivalBrand } = lifecycleWorld();
    const sharedShow = anEventInstance({ promotionId: promotionA, brandId: sharedBrand });
    const rivalShow = anEventInstance({ promotionId: promotionA, brandId: rivalBrand });
    const computerShow = anEventInstance({ promotionId: promotionB });

    expect(canReadCard(world, controllerViewer(PLAYER_ONE), sharedShow)).toBe(true);
    expect(canReadCard(world, controllerViewer(PLAYER_ONE), rivalShow)).toBe(false);
    expect(canReadCard(world, controllerViewer(PLAYER_TWO), rivalShow)).toBe(true);
    expect(canReadCard(world, controllerViewer(PLAYER_TWO), sharedShow)).toBe(false);
    expect(canReadCard(world, controllerViewer(PLAYER_THREE), sharedShow)).toBe(false);
    expect(canReadCard(world, controllerViewer(COMPUTER), computerShow)).toBe(true);
    expect(canReadCard(world, controllerViewer(PLAYER_ONE), computerShow)).toBe(false);
  });
});

describe('editBlockOf', () => {
  const TODAY = '2026-01-12';
  const { world, promotionA } = lifecycleWorld({ currentDate: TODAY });

  function show(overrides: Partial<Pick<EventInstance, 'status' | 'date'>>): CardShow {
    return anEventInstance({
      promotionId: promotionA,
      date: parseGameDate(TODAY),
      ...overrides,
    });
  }

  it("leaves a scheduled show open on its own day and later (today's show stays editable)", () => {
    expect(editBlockOf(world, show({}))).toBeNull();
    expect(editBlockOf(world, show({ date: parseGameDate('2026-02-01') }))).toBeNull();
  });

  it('leaves a show an old save locked (booked) open: there is no lock (EVT2-09)', () => {
    expect(editBlockOf(world, show({ status: 'booked' }))).toBeNull();
  });

  it('blocks a completed show and a cancelled show', () => {
    expect(editBlockOf(world, show({ status: 'completed' }))?.code).toBe('showCompleted');
    expect(editBlockOf(world, show({ status: 'cancelled' }))).toMatchObject({
      code: 'showCancelled',
      message: 'This show was cancelled',
    });
  });

  it('blocks a show whose day has passed', () => {
    const yesterday = show({ date: parseGameDate('2026-01-11') });
    expect(editBlockOf(world, yesterday)).toMatchObject({
      code: 'showPast',
      message: 'This show has already happened',
      subject: { kind: 'eventInstance', id: yesterday.id },
    });
    expect(editBlockOf(world, { ...yesterday, status: 'booked' })?.code).toBe('showPast');
  });

  it("reads today from the world unless it is given, and reports a completed show's status first", () => {
    const monday = show({ date: parseGameDate('2026-01-05') });
    expect(editBlockOf(world, monday)?.code).toBe('showPast');
    expect(editBlockOf(world, monday, parseGameDate('2026-01-05'))).toBeNull();
    expect(editBlockOf(world, { ...monday, status: 'completed' })?.code).toBe('showCompleted');
  });
});
