// EVT4-08: a segment's booked time, the show's time budget and its booking check.
// Design: docs/design/match-rating.md#show-time
import { describe, expect, it } from 'vitest';
import type { SegmentId } from '../../../src/core/ids';
import { RngRegistry } from '../../../src/core/rng/registry';
import { walkTrace, type TraceNode } from '../../../src/core/trace';
import { matchesToLengthen } from '../../../src/systems/aip/card/lengthenMatches';
import { draftFromSegment } from '../../../src/systems/booking';
import { buildCardView } from '../../../src/systems/booking/view';
import { durationClassOf, slotWeightOf } from '../../../src/systems/match';
import { crowdExpectation } from '../../../src/systems/match/formulas/crowdExpectation';
import { staminaCheckOf } from '../../../src/systems/match/formulas/workRate';
import { ratingInputFromSegment } from '../../../src/systems/match/rating/fromSegment';
import { rateSegment } from '../../../src/systems/match/rating/rateSegment';
import type { SegmentRatingResult } from '../../../src/systems/match/rating/types';
import { segmentDurationOf, showTimeOf } from '../../../src/systems/match/showTime';
import { OVER_TIME_CODE, SHOW_TIME_CHECK_ID } from '../../../src/systems/match/showTimeCheck';
import { constantOf } from '../../../src/core/trace';
import { createEngineTunables } from '../../../src/systems/tunables';
import { OMNISCIENT_VIEWER } from '../../../src/core/api/controller';
import {
  book,
  bookRunnable,
  change,
  match,
  validate,
  validateWorld,
  who,
  type ValidateWorld,
} from '../booking/validate-world';

const TUNABLES = createEngineTunables();
const DEPS = { tunables: TUNABLES };
const SINGLES = { name: 'Singles', durationShift: 0 } as const;
const BATTLE_ROYAL = { name: 'Battle Royal', durationShift: 1 } as const;

function labels(node: TraceNode): string[] {
  const found: string[] = [];
  walkTrace(node, (each) => {
    found.push(each.label);
  });
  return found;
}

function setLength(
  built: ValidateWorld,
  segmentId: SegmentId,
  length: 'short' | 'standard' | 'long',
): void {
  change(built, (tx) => {
    tx.update('segments', segmentId, (previous) => ({ ...previous, bookedLength: length }));
  });
}

function rate(built: ValidateWorld, segmentId: SegmentId): SegmentRatingResult {
  const result = rateSegment(ratingInputFromSegment(built.world, segmentId), {
    read: built.world,
    tunables: TUNABLES,
    mode: 'preview',
    seed: 'show-time',
    rng: new RngRegistry('show-time').stream('match.preview'),
  });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  return result.data;
}

describe('durationClassOf with a booked time', () => {
  it('uses the booked time in place of the role, and says so', () => {
    const result = durationClassOf({ role: 'midcard', matchType: SINGLES, booked: 'long' }, DEPS);
    expect(result.value).toBe('long');
    expect(labels(result.trace)).toContain('Booked Long (Midcard is usually Standard)');
  });

  it('still lets the match type shift the booked time', () => {
    expect(
      durationClassOf({ role: 'opener', matchType: BATTLE_ROYAL, booked: 'short' }, DEPS).value,
    ).toBe('standard');
  });

  it('keeps the main event long whatever is booked', () => {
    const result = durationClassOf(
      { role: 'mainEvent', matchType: SINGLES, booked: 'short' },
      DEPS,
    );
    expect(result.value).toBe('long');
    expect(labels(result.trace)).toContain('Booked Short, but the main event stays long');
  });

  it('reads exactly as before when nothing is booked', () => {
    const before = durationClassOf({ role: 'midcard', matchType: SINGLES }, DEPS);
    const unset = durationClassOf({ role: 'midcard', matchType: SINGLES, booked: null }, DEPS);
    expect(unset).toStrictEqual(before);
  });
});

describe('the show time budget', () => {
  it('fits a regular show at its usual times, with room for one more step', () => {
    const built = validateWorld();
    bookRunnable(built);
    const instance = built.world.tables.eventInstances.require(built.show);
    const time = showTimeOf(built.world, instance, TUNABLES);
    // Pre-show short 1 + opener, three midcard and semi-main standard 2 each + main event long 3,
    // plus a regular show's room of 1.
    expect(time.budget.value).toBe(15);
    // The opener (2), the promo in slot 3 (2) and the main event (3).
    expect(time.used.value).toBe(7);
    expect(time.over).toBe(0);
    expect(time.lengthened).toBe(false);
    expect(labels(time.budget.trace)).toContain('Regular show: room for +1');
    expect(labels(time.used.trace)).toContain('Slot 6: Long +3');
  });

  it('counts a booked time, and only a longer one as lengthened', () => {
    const built = validateWorld();
    const card = bookRunnable(built);
    setLength(built, card.opener, 'short');
    const instance = built.world.tables.eventInstances.require(built.show);
    expect(showTimeOf(built.world, instance, TUNABLES)).toMatchObject({ lengthened: false });
    expect(showTimeOf(built.world, instance, TUNABLES).used.value).toBe(6);
    setLength(built, card.opener, 'long');
    const time = showTimeOf(built.world, instance, TUNABLES);
    expect(time.used.value).toBe(8);
    expect(time.lengthened).toBe(true);
    const duration = segmentDurationOf(
      built.world,
      built.world.tables.segments.require(card.opener),
      instance.format,
      TUNABLES,
    );
    expect(duration).toMatchObject({ usual: 'standard', steps: 1 });
    expect(duration?.duration.value).toBe('long');
  });
});

describe('match.showTime', () => {
  /** Fills the main-card slots the runnable card leaves open with matches of `type`. */
  function fullCard(built: ValidateWorld, type = 'match.singles'): SegmentId[] {
    const card = bookRunnable(built);
    return [
      card.opener,
      book(built, 1, match([[who(built, 0)], [who(built, 1)]], { type })),
      book(built, 3, match([[who(built, 2)], [who(built, 11)]], { type })),
      book(built, 4, match([[who(built, 5)], [who(built, 7)]], { type, outcome: null })),
    ];
  }

  function showTimeIssues(built: ValidateWorld) {
    const result = validate(built);
    return [...result.errors, ...result.warnings].filter(
      (issue) => issue.checkId === SHOW_TIME_CHECK_ID,
    );
  }

  it('lets a card with two matches booked long run', () => {
    const built = validateWorld();
    const [opener, second] = fullCard(built);
    if (opener === undefined || second === undefined) throw new Error('no segments');
    setLength(built, opener, 'long');
    setLength(built, second, 'long');
    // Usual 13 of 15 (the pre-show is open), plus two steps: 15 of 15.
    expect(showTimeIssues(built)).toEqual([]);
  });

  it('blocks a card the booker lengthened past the show time, until another is shortened', () => {
    const built = validateWorld();
    const [opener, second, third, fourth] = fullCard(built);
    if (
      opener === undefined ||
      second === undefined ||
      third === undefined ||
      fourth === undefined
    ) {
      throw new Error('no segments');
    }
    setLength(built, opener, 'long');
    setLength(built, second, 'long');
    setLength(built, third, 'long');
    const result = validate(built);
    const issue = result.errors.find((error) => error.checkId === SHOW_TIME_CHECK_ID);
    expect(issue).toMatchObject({
      code: OVER_TIME_CODE,
      severity: 'error',
      message: "Over the show's time by 1: shorten a match or drop a segment.",
    });
    expect(result.runnable).toBe(false);
    setLength(built, fourth, 'short');
    expect(showTimeIssues(built)).toEqual([]);
  });

  it('only warns when match types alone push a card at its usual times over', () => {
    const built = validateWorld();
    fullCard(built, 'match.endurance');
    const issues = showTimeIssues(built);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: OVER_TIME_CODE, severity: 'warning' });
  });
});

describe('the booked time on the card', () => {
  it('round-trips through the draft and shows in the booking view', () => {
    const built = validateWorld();
    const card = bookRunnable(built);
    setLength(built, card.opener, 'long');
    expect(draftFromSegment(built.world, card.opener).bookedLength).toBe('long');
    const instance = built.world.tables.eventInstances.require(built.show);
    const view = buildCardView(built.world, instance, instance.date, {
      viewer: OMNISCIENT_VIEWER,
      tunables: TUNABLES,
    });
    const main = view.sections.find((section) => !section.preShow);
    const opener = main?.slots[0];
    expect(opener).toMatchObject({
      durationClass: 'long',
      usualLength: 'standard',
      bookedLength: 'long',
      lengthLocked: false,
      timeUnits: 3,
    });
    expect(main?.slots[5]?.lengthLocked).toBe(true);
    expect(view.time).toMatchObject({ used: 8, budget: 15, over: 0, lengthened: true });
  });
});

describe('rating a match booked longer', () => {
  it('raises the expectation and the star limit, never the slot weight', () => {
    const built = validateWorld();
    const card = bookRunnable(built);
    const usual = rate(built, card.opener);
    setLength(built, card.opener, 'long');
    const long = rate(built, card.opener);
    expect(usual.slot.durationClass).toBe('standard');
    expect(long.slot.durationClass).toBe('long');
    expect(long.slot.bookedSteps).toBe(1);
    expect(long.expectation.value - usual.expectation.value).toBe(4);
    expect(labels(long.expectation.trace)).toContain('Booked long: crowd expects +4');
    expect(labels(usual.expectation.trace).some((label) => label.startsWith('Booked'))).toBe(false);
    expect(long.slot.weight).toBe(usual.slot.weight);
    expect(long.slot.weight).toBe(slotWeightOf({ role: 'opener' }, DEPS).value);
  });

  it('lowers the expectation for a match booked shorter', () => {
    const built = validateWorld();
    const card = bookRunnable(built);
    const usual = rate(built, card.opener);
    setLength(built, card.opener, 'short');
    const short = rate(built, card.opener);
    expect(short.slot.durationClass).toBe('short');
    expect(short.expectation.value - usual.expectation.value).toBe(-4);
    expect(labels(short.expectation.trace)).toContain('Booked short: crowd expects −4');
  });
});

describe('the formulas behind a longer match', () => {
  it('adds the booked line to the expectation only when booked', () => {
    const inputs = {
      starPower: constantOf('Star power', 50, 'Test'),
      momentum: 0,
      role: 'midcard' as const,
      roleLabel: 'Midcard',
      importance: 'regular' as const,
      televised: true,
    };
    const plain = crowdExpectation(inputs, DEPS);
    const zero = crowdExpectation(
      { ...inputs, booked: { steps: 0, durationClass: 'standard' } },
      DEPS,
    );
    const twoUp = crowdExpectation(
      { ...inputs, booked: { steps: 2, durationClass: 'long' } },
      DEPS,
    );
    expect(zero).toStrictEqual(plain);
    expect(twoUp.value - plain.value).toBe(8);
  });

  it('makes a tired worker short of stamina in a match booked longer', () => {
    const fresh = staminaCheckOf(
      { name: 'Ana Vale', stamina: 70 },
      { durationClass: 'long', workerCount: 2 },
      TUNABLES,
    );
    const tired = staminaCheckOf(
      { name: 'Ana Vale', stamina: 70, tiredness: 20 },
      { durationClass: 'long', workerCount: 2 },
      TUNABLES,
    );
    expect(tired.have).toBe(50);
    expect(tired.penalty.value).toBeGreaterThan(fresh.penalty.value);
    expect(labels(tired.penalty.trace)).toContain('Ana Vale is tired for a match booked longer');
  });
});

describe('rival bookers lengthen big matches', () => {
  it('lengthens nothing on a regular show', () => {
    const built = validateWorld();
    const card = bookRunnable(built);
    const instance = built.world.tables.eventInstances.require(built.show);
    expect(
      matchesToLengthen(built.world, instance, [card.opener, card.mainEvent], TUNABLES),
    ).toEqual([]);
  });

  it('spends a major show’s spare time from the top of the card down, never the main event', () => {
    const built = validateWorld();
    change(built, (tx) => {
      tx.update('eventInstances', built.show, (previous) => ({ ...previous, importance: 'major' }));
    });
    const card = bookRunnable(built);
    const second = book(built, 1, match([[who(built, 0)], [who(built, 1)]]));
    const fourth = book(built, 3, match([[who(built, 5)], [who(built, 11)]]));
    const fifth = book(built, 4, match([[who(built, 2)], [who(built, 7)]], { outcome: null }));
    const instance = built.world.tables.eventInstances.require(built.show);
    const ids = [card.opener, second, fourth, fifth, card.mainEvent];
    // Spare: a major show's room of 3 plus the open pre-show's 1. The semi-main goes first, then
    // down the card; the main event is already long.
    expect(matchesToLengthen(built.world, instance, ids, TUNABLES)).toEqual([
      fifth,
      fourth,
      second,
      card.opener,
    ]);
    // With no room, only the open pre-show's time is spare.
    const tight = createEngineTunables({ 'match.time.room.major': 0 });
    expect(matchesToLengthen(built.world, instance, ids, tight)).toEqual([fifth]);
  });
});
