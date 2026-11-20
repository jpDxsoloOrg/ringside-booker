// DRF-08 draft follow-ups: the first show a week out, and each pool wrestler's card level kept on
// the draft row and returned by draft.pool. Design: docs/design/draft.md
import { describe, expect, it } from 'vitest';
import { addDays, compareDates } from '../../../src/core/date';
import { createEngineTunables } from '../../../src/systems/tunables';
import { engineOf, PLAYER_VIEW, run, startDraftGame } from './draft-game';

describe('the first show in a draft game', () => {
  const state = startDraftGame({ settings: { draftNegotiateAfter: true } });
  const world = state.world;
  const start = world.meta.startDate;
  const delay = createEngineTunables().get('draft.firstShowDelayDays');

  it('defaults to a week', () => {
    expect(delay).toBe(7);
  });

  it('comes at least a week after the start date, for every promotion', () => {
    const firstShowDay = addDays(start, delay);
    const active = world.tables.promotions.filter((row) => row.status === 'active');
    const shows = world.tables.eventInstances.filter((row) => row.status !== 'cancelled');
    expect(shows.length).toBeGreaterThan(0);
    for (const show of shows) {
      expect(
        compareDates(show.date, firstShowDay),
        `${show.name} on ${show.date}`,
      ).toBeGreaterThanOrEqual(0);
    }
    for (const promotion of active) {
      const first = shows
        .filter((row) => row.promotionId === promotion.id)
        .map((row) => row.date)
        .sort()[0];
      expect(first, promotion.name).toBeDefined();
      // Weekly: the first one falls in the week after the delay.
      expect(compareDates(first!, addDays(firstShowDay, 7))).toBeLessThan(0);
    }
  });

  it('leaves a game without a draft as it was', () => {
    const plain = startDraftGame({ settings: { draftStart: false } });
    const earliest = plain.world.tables.eventInstances.map((row) => row.date).sort()[0];
    expect(compareDates(earliest!, addDays(plain.world.meta.startDate, delay))).toBeLessThan(0);
  });
});

describe('card levels in the pool', () => {
  const state = startDraftGame();
  const [draft] = state.world.tables.drafts;

  it('keeps every pool wrestler card level on the draft row, matching the mix', () => {
    expect(draft).toBeDefined();
    const levels = draft!.cardLevels;
    expect(levels).toHaveLength(draft!.poolLeft.wrestlers);
    expect([...levels].map((entry) => entry.personId)).toEqual(
      [...levels].map((entry) => entry.personId).sort(),
    );
    for (const mix of draft!.poolMix) {
      expect(
        levels.filter((entry) => entry.level === mix.level),
        mix.level,
      ).toHaveLength(mix.inPool);
    }
  });

  it('returns the level from draft.pool, filters and sorts by it', () => {
    const engine = engineOf(state);
    const all = run(engine.query('draft.pool', { limit: 200 }, PLAYER_VIEW));
    expect(all.rows.every((row) => row.level !== null)).toBe(true);
    const mainEvent = run(
      engine.query('draft.pool', { level: 'mainEvent', limit: 200 }, PLAYER_VIEW),
    );
    const inMix = draft!.poolMix.find((entry) => entry.level === 'mainEvent')!.inPool;
    expect(mainEvent.total).toBe(inMix);
    expect(mainEvent.rows.every((row) => row.level === 'mainEvent')).toBe(true);
    const topDown = run(engine.query('draft.pool', { sort: 'level', limit: 5 }, PLAYER_VIEW));
    expect(topDown.rows.every((row) => row.level === 'mainEvent')).toBe(true);
    const bottomUp = run(
      engine.query('draft.pool', { sort: 'level', descending: false, limit: 5 }, PLAYER_VIEW),
    );
    expect(bottomUp.rows.every((row) => row.level === 'enhancement')).toBe(true);
  });
});
