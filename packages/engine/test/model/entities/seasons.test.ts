import { describe, expect, it } from 'vitest';
import { UniqueIndexError } from '../../../src/core/errors';
import { ACTIVE_SEASON_KEY, SeasonSchema } from '../../../src/model/entities/season';
import {
  check,
  date,
  emptyShowWorld,
  issueCodes,
  makeSeason,
  seasonId,
  type ShowWorld,
} from '../../support/show-world';

/** Season 1 (completed, Jan-Mar 2026) and season 2 (active, Apr-Jun 2026). */
function twoSeasonWorld(): ShowWorld {
  const world = emptyShowWorld();
  world.tables.seasons._put(
    makeSeason(1, {
      startDate: date('2026-01-01'),
      endDate: date('2026-03-31'),
      status: 'completed',
    }),
  );
  world.tables.seasons._put(
    makeSeason(2, { startDate: date('2026-04-01'), endDate: date('2026-06-30') }),
  );
  return world;
}

describe('SeasonSchema', () => {
  it('accepts a valid season and rejects an endDate before the startDate', () => {
    expect(SeasonSchema.safeParse(makeSeason(1)).success).toBe(true);
    const backwards = makeSeason(1, { startDate: date('2026-02-01'), endDate: date('2026-01-31') });
    expect(SeasonSchema.safeParse(backwards).success).toBe(false);
  });

  it('accepts a one-day season and rejects season number 0', () => {
    const oneDay = makeSeason(1, { startDate: date('2026-02-01'), endDate: date('2026-02-01') });
    expect(SeasonSchema.safeParse(oneDay).success).toBe(true);
    expect(SeasonSchema.safeParse(makeSeason(1, { number: 0 })).success).toBe(false);
  });

  it('is world-wide: it has no promotion field', () => {
    expect(Object.keys(SeasonSchema.shape)).not.toContain('promotionId');
  });
});

describe('seasons table', () => {
  it('passes when empty', () => {
    expect(check(emptyShowWorld())).toEqual({ ok: true, issues: [], truncated: 0 });
  });

  it('passes for contiguous, numbered seasons and finds the current one', () => {
    const world = twoSeasonWorld();
    expect(check(world)).toEqual({ ok: true, issues: [], truncated: 0 });
    expect(world.tables.seasons.lookupOne('activeSeason', ACTIVE_SEASON_KEY)?.id).toBe(seasonId(2));
    expect(world.tables.seasons.lookupOne('byNumber', '1')?.id).toBe(seasonId(1));
  });

  it('rejects two active seasons with activeSeason', () => {
    const world = emptyShowWorld();
    world.tables.seasons._put(makeSeason(1));
    expect(() => {
      world.tables.seasons._put(
        makeSeason(2, { startDate: date('2026-04-01'), endDate: date('2026-06-30') }),
      );
    }).toThrow(UniqueIndexError);
  });

  it('rejects two seasons with the same number with byNumber', () => {
    const world = emptyShowWorld();
    world.tables.seasons._put(makeSeason(1));
    expect(() => {
      world.tables.seasons._put({ ...makeSeason(2, { status: 'completed' }), number: 1 });
    }).toThrow(UniqueIndexError);
  });

  it('reports a table with no active season', () => {
    const world = emptyShowWorld();
    world.tables.seasons._put(makeSeason(1, { status: 'completed' }));
    expect(issueCodes(check(world))).toEqual(['seasons.activeCount']);
  });

  it('reports season numbers 1, 3 as a gap', () => {
    const world = twoSeasonWorld();
    world.tables.seasons._put({ ...world.tables.seasons.require(seasonId(2)), number: 3 });
    expect(issueCodes(check(world))).toEqual(['seasons.numberGap']);
  });

  it('reports season 2 starting two days after season 1 ends as not contiguous', () => {
    const world = twoSeasonWorld();
    world.tables.seasons._put(
      makeSeason(2, { startDate: date('2026-04-02'), endDate: date('2026-06-30') }),
    );
    expect(issueCodes(check(world))).toEqual(['seasons.notContiguous']);
  });

  it('reports overlapping seasons', () => {
    const world = twoSeasonWorld();
    world.tables.seasons._put(
      makeSeason(2, { startDate: date('2026-03-15'), endDate: date('2026-06-30') }),
    );
    expect(issueCodes(check(world))).toEqual(['seasons.overlap']);
  });

  it('reports an active season with a lower number than a completed one', () => {
    const world = emptyShowWorld();
    world.tables.seasons._put(
      makeSeason(1, { startDate: date('2026-01-01'), endDate: date('2026-03-31') }),
    );
    world.tables.seasons._put(
      makeSeason(2, {
        startDate: date('2026-04-01'),
        endDate: date('2026-06-30'),
        status: 'completed',
      }),
    );
    expect(issueCodes(check(world))).toEqual(['seasons.activeNotLatest']);
  });
});
