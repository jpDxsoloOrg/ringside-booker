// Prior matches and win streaks (MTCH3-02). Design: docs/design/match-aftermath.md#prior-matches
import { describe, expect, it } from 'vitest';
import { parseGameDate } from '../../../../src/core/date';
import { InvalidArgumentError } from '../../../../src/core/errors';
import type { EventInstanceId, PersonId, SegmentId } from '../../../../src/core/ids';
import {
  priorMatchesOf,
  resultOf,
  winStreakBefore,
  type MatchPosition,
} from '../../../../src/systems/match';
import { initialMomentum } from '../../../../src/systems/workers';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectTraceContains, expectTraceReplays } from '../../../support/trace';
import { DEFAULT_METHOD_KEY } from '../../../support/builders/creative';
import { testId } from '../../../support/ids';
import { worldBuilder, type WorldBuilder } from '../../../support/world-builder';

const DAY_1 = parseGameDate('2026-02-02');
const DAY_2 = parseGameDate('2026-02-09');
const DAY_3 = parseGameDate('2026-02-16');
const FORMAT = { slots: 6, preShowSlots: 2 };
const STAR = 0;

/**
 * Person 0 (the star) wrestles five run matches, W W on show 0 then L W W on show 1. Shows 0..2
 * are a week apart; show 2 starts empty for the cases that add to it.
 */
function starWorld(extra: (builder: WorldBuilder) => WorldBuilder = (builder) => builder) {
  const builder = worldBuilder()
    .withGeography('mini')
    .withPromotion({}, (promotion) => promotion.withRoster(6))
    .withEventInstance({ date: DAY_1, status: 'completed', format: FORMAT })
    .withEventInstance({ date: DAY_2, status: 'completed', format: FORMAT })
    .withEventInstance({ date: DAY_3, format: FORMAT })
    .withCompletedMatch({ show: 0, slot: 0, sides: [[STAR], [1]], result: 0 })
    .withCompletedMatch({ show: 0, slot: 1, sides: [[2], [STAR]], result: 1 })
    .withCompletedMatch({ show: 1, slot: 0, sides: [[STAR], [3]], result: 1 })
    .withCompletedMatch({ show: 1, slot: 1, sides: [[STAR], [4]], result: 0 })
    .withCompletedMatch({ show: 1, slot: 2, sides: [[STAR], [5], [1]], result: 0 });
  const { world, ids } = extra(builder).build();
  const person = (index: number): PersonId => {
    const id = ids.people[index];
    if (id === undefined) throw new Error(`no person ${String(index)}`);
    return id;
  };
  const segment = (index: number): SegmentId => {
    const id = ids.segments[index];
    if (id === undefined) throw new Error(`no segment ${String(index)}`);
    return id;
  };
  const show = (index: number): EventInstanceId => {
    const id = ids.eventInstances[index];
    if (id === undefined) throw new Error(`no show ${String(index)}`);
    return id;
  };
  return { world, ids, person, segment, show };
}

type StarWorld = ReturnType<typeof starWorld>;

function at(
  built: StarWorld,
  show: number,
  slot: number,
  options: { preShow?: boolean; segment?: number } = {},
): MatchPosition {
  const instance = built.world.tables.eventInstances.require(built.show(show));
  return {
    date: instance.date,
    eventInstanceId: instance.id,
    preShow: options.preShow ?? false,
    slot,
    segmentId: options.segment === undefined ? null : built.segment(options.segment),
  };
}

describe('priorMatchesOf', () => {
  it('lists earlier run matches newest first with the side and opponents', () => {
    const built = starWorld();
    const prior = priorMatchesOf(built.world, built.person(STAR), at(built, 2, 0), 10);
    expect(prior.map((match) => match.segmentId)).toEqual(
      [4, 3, 2, 1, 0].map((index) => built.segment(index)),
    );
    expect(prior.map((match) => match.result)).toEqual(['win', 'win', 'loss', 'win', 'win']);
    expect(prior[0]).toMatchObject({
      eventInstanceId: built.show(1),
      date: DAY_2,
      sideOf: 0,
      opponentIds: [built.person(1), built.person(5)],
    });
    expect(prior[3]?.sideOf).toBe(1);
  });

  it('counts an earlier slot on the same show, not a later one or the same slot', () => {
    const built = starWorld();
    const prior = priorMatchesOf(built.world, built.person(STAR), at(built, 1, 1), 10);
    expect(prior.map((match) => match.segmentId)).toEqual(
      [2, 1, 0].map((index) => built.segment(index)),
    );
  });

  it('puts the pre-show before every main card slot', () => {
    const built = starWorld((builder) =>
      builder.withCompletedMatch({
        show: 1,
        preShow: true,
        slot: 1,
        sides: [[STAR], [2]],
        result: 'draw',
      }),
    );
    const preShowMatch = built.segment(5);
    const beforeMain = priorMatchesOf(built.world, built.person(STAR), at(built, 1, 0), 10);
    expect(beforeMain[0]?.segmentId).toBe(preShowMatch);
    const beforePreShow = priorMatchesOf(
      built.world,
      built.person(STAR),
      at(built, 1, 0, { preShow: true }),
      10,
    );
    expect(beforePreShow.map((match) => match.segmentId)).not.toContain(preShowMatch);
  });

  it('only counts earlier days for a match on no show', () => {
    const built = starWorld();
    const lab: MatchPosition = {
      date: DAY_2,
      eventInstanceId: null,
      preShow: false,
      slot: 5,
      segmentId: null,
    };
    expect(priorMatchesOf(built.world, built.person(STAR), lab, 10)).toHaveLength(2);
  });

  it('ignores ringside, unrun and unresulted matches', () => {
    const built = starWorld((builder) =>
      builder
        // At ringside for a loss: not their match.
        .withCompletedMatch({
          show: 2,
          slot: 0,
          sides: [[1], [2]],
          result: 0,
          ringside: [{ person: STAR, side: 1 }],
        })
        // A planned loss on a show that has not run.
        .withCompletedMatch({ show: 2, slot: 1, sides: [[STAR], [3]], result: 1, run: false })
        // Run, but with no result written.
        .withCompletedMatch({ show: 2, slot: 2, sides: [[STAR], [4]], result: null }),
    );
    const prior = priorMatchesOf(built.world, built.person(STAR), at(built, 2, 5), 10);
    expect(prior).toHaveLength(5);
    expect(winStreakBefore(built.world, built.person(STAR), at(built, 2, 5), 10).streak).toBe(2);
  });

  it('keeps at most `limit` matches and rejects a bad limit', () => {
    const built = starWorld();
    expect(priorMatchesOf(built.world, built.person(STAR), at(built, 2, 0), 2)).toHaveLength(2);
    expect(priorMatchesOf(built.world, built.person(STAR), at(built, 2, 0), 0)).toEqual([]);
    expect(() => priorMatchesOf(built.world, built.person(STAR), at(built, 2, 0), -1)).toThrow(
      InvalidArgumentError,
    );
    expect(() => priorMatchesOf(built.world, built.person(STAR), at(built, 2, 0), 1.5)).toThrow(
      InvalidArgumentError,
    );
  });
});

describe('winStreakBefore', () => {
  it('counts the two straight wins going into a sixth match', () => {
    const built = starWorld();
    const streak = winStreakBefore(built.world, built.person(STAR), at(built, 2, 0), 10);
    expect(streak).toEqual({ streak: 2, segmentIds: [built.segment(4), built.segment(3)] });
  });

  it('never counts the match being judged, even when its result is written', () => {
    const built = starWorld();
    const fifth = at(built, 1, 2, { segment: 4 });
    expect(winStreakBefore(built.world, built.person(STAR), fifth, 10).streak).toBe(1);
    // A position that sorts after it still leaves the match itself out.
    const misplaced = { ...at(built, 2, 0), segmentId: built.segment(4) };
    expect(winStreakBefore(built.world, built.person(STAR), misplaced, 10)).toEqual({
      streak: 1,
      segmentIds: [built.segment(3)],
    });
  });

  it('skips a no contest without ending the streak', () => {
    const built = starWorld((builder) =>
      builder
        .withCompletedMatch({ show: 2, slot: 0, sides: [[STAR], [1]], result: 'noContest' })
        .withCompletedMatch({ show: 2, slot: 1, sides: [[STAR], [2]], result: 0 }),
    );
    const streak = winStreakBefore(built.world, built.person(STAR), at(built, 2, 2), 10);
    expect(streak.streak).toBe(3);
    expect(streak.segmentIds).not.toContain(built.segment(5));
  });

  it('is ended by a draw', () => {
    const built = starWorld((builder) =>
      builder.withCompletedMatch({ show: 2, slot: 0, sides: [[STAR], [1]], result: 'draw' }),
    );
    expect(winStreakBefore(built.world, built.person(STAR), at(built, 2, 1), 10).streak).toBe(0);
  });

  it('looks back no further than the lookback', () => {
    const built = starWorld();
    const position = at(built, 2, 0);
    expect(winStreakBefore(built.world, built.person(STAR), position, 1).streak).toBe(1);
    expect(winStreakBefore(built.world, built.person(STAR), position, 0)).toEqual({
      streak: 0,
      segmentIds: [],
    });
    // Person 1 lost on show 0 and has a 3-way loss since: no streak.
    expect(winStreakBefore(built.world, built.person(1), position, 10).streak).toBe(0);
  });
});

describe('resultOf', () => {
  it('reads a result from a side', () => {
    const win = {
      outcome: { kind: 'win', winningSide: 1, methodKey: DEFAULT_METHOD_KEY },
    } as const;
    expect(resultOf(win, 1)).toBe('win');
    expect(resultOf(win, 0)).toBe('loss');
    expect(resultOf({ outcome: { kind: 'draw' } }, 0)).toBe('draw');
    expect(resultOf({ outcome: { kind: 'noContest' } }, 0)).toBe('noContest');
    expect(() => resultOf({ outcome: null }, 0)).toThrow(InvalidArgumentError);
  });
});

describe('initialMomentum', () => {
  it('starts from home-region popularity times the starting share, as the door does', () => {
    const { world, ids } = worldBuilder()
      .withGeography('mini')
      .withPromotion({}, (promotion) =>
        promotion.withRoster(1, { person: () => ({ regionalPop: { [testId('region', 1)]: 40 } }) }),
      )
      .build();
    const [employmentId] = ids.employments;
    if (employmentId === undefined) throw new Error('no employment');
    const employment = world.tables.employments.require(employmentId);
    const start = initialMomentum(world, employment, createEngineTunables());
    expect(start.value).toBe(40);
    expectTraceReplays(start);
    expectTraceContains(start, {
      kind: 'note',
      label: 'First appearance: starts from home-region popularity',
    });
    const halved = initialMomentum(
      world,
      employment,
      createEngineTunables({ 'workers.momentum.initialPopFactor': 0.5 }),
    );
    expect(halved.value).toBe(20);
  });
});
