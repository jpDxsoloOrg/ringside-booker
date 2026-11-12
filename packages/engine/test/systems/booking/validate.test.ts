// The booking checks and `booking.validate`. Design: docs/design/booking.md#validation
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Viewer } from '../../../src/core/api';
import { RegistryError } from '../../../src/core/errors';
import type { Employment } from '../../../src/model/entities/employment';
import type { DeepReadonly } from '../../../src/model/world';
import { parseContentKey } from '../../../src/core/content-key';
import { defaultSystems } from '../../../src/systems';
import {
  CHECK_FAILED_CODE,
  registerBookingCheck,
  registeredBookingChecks,
  type BookingIssue,
  type BookingValidation,
} from '../../../src/systems/booking';
import { TEST_CATALOGS } from '../../support/catalogs';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';
import {
  angle,
  book,
  bookRunnable,
  change,
  match,
  PLAYER_ONE,
  PLAYER_TWO,
  START,
  validate,
  validateWorld,
  who,
  type ValidateWorld,
} from './validate-world';

/** The code and message of every issue, in order. */
function said(issues: readonly BookingIssue[]): { code: string; message: string }[] {
  return issues.map(({ code, message }) => ({ code, message }));
}

function codes(issues: readonly BookingIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function updateEmployment(
  built: ValidateWorld,
  index: number,
  edit: (employment: DeepReadonly<Employment>) => Partial<Employment>,
): void {
  change(built, (tx) => {
    const [employment] = tx.view.tables.employments.lookup('byPerson', who(built, index));
    if (employment === undefined) {
      throw new Error(`Roster ${String(index)} has no contract`);
    }
    tx.update('employments', employment.id, edit(employment));
  });
}

const removals: (() => void)[] = [];
afterEach(() => {
  for (const remove of removals.splice(0)) {
    remove();
  }
});

describe('a runnable card', () => {
  it('has no issues and a passing checklist', () => {
    const built = validateWorld();
    bookRunnable(built);
    const result = validate(built);
    expectSerialisable(result);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.runnable).toBe(true);
    expect(result.checklist.map(({ id, label, passed }) => ({ id, label, passed }))).toEqual([
      { id: 'mainCardFilled', label: 'Main card filled (3 of 6, needs 3)', passed: true },
      { id: 'mainEvent', label: 'Main event booked', passed: true },
      { id: 'results', label: 'Every match has a result', passed: true },
      { id: 'available', label: 'Everyone is available', passed: true },
      { id: 'notTwice', label: 'Nobody is booked twice', passed: true },
      { id: 'sides', label: 'Sides fit their match types', passed: true },
      { id: 'titles', label: 'Title matches are set up correctly', passed: true },
    ]);
  });

  it("carries the minimum-filled trace on the main card's line for its Why?", () => {
    const built = validateWorld();
    bookRunnable(built);
    const [filled] = validate(built).checklist;
    expect(filled?.trace).toMatchObject({
      kind: 'formula',
      label: 'Main card slots that must be filled',
      value: 3,
    });
  });
});

describe('the people checks', () => {
  it('refuses an injured worker in a match', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, match([[who(built, 3)], [who(built, 4)]]));
    const result = validate(built);
    expect(result.runnable).toBe(false);
    expect(said(result.errors)).toEqual([
      {
        code: 'personUnavailable',
        message:
          "Tia Cruz can't wrestle: Injured (leg injury) until 12 Feb; can still do talking segments",
      },
      {
        code: 'personUnavailable',
        message: "Max Dorn can't wrestle: Injured (leg injury) until 12 Feb",
      },
    ]);
    expect(result.errors[0]).toMatchObject({
      checkId: 'booking.people',
      severity: 'error',
      slot: { preShow: false, slot: 1 },
      personId: who(built, 3),
    });
  });

  it('only warns about an injured worker who can still talk in a talking segment', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, angle([who(built, 3)]));
    const result = validate(built);
    expect(result.runnable).toBe(true);
    expect(said(result.warnings)).toEqual([
      { code: 'injuredTalking', message: 'Tia Cruz is injured: can talk but not wrestle' },
    ]);
    const available = result.checklist.find((line) => line.id === 'available');
    expect(available).toMatchObject({ passed: false, severity: 'warning' });
  });

  it('refuses an injured worker who may not talk in a talking segment', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, angle([who(built, 4)]));
    expect(said(validate(built).errors)).toEqual([
      {
        code: 'personUnavailable',
        message: "Max Dorn can't appear: Injured (leg injury) until 12 Feb",
      },
    ]);
  });

  it('refuses someone whose contract ended after they were booked', () => {
    const built = validateWorld();
    bookRunnable(built);
    updateEmployment(built, 6, () => ({ status: 'released', endedOn: START }));
    expect(said(validate(built).errors)).toEqual([
      { code: 'notOnRoster', message: 'Mia Torres is no longer on the Test Promotion A roster' },
    ]);
  });

  it('refuses a competitor who is not a wrestler', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, match([[who(built, 10)], [who(built, 11)]]));
    expect(said(validate(built).errors)).toEqual([
      { code: 'notAWrestler', message: "Sam Reed isn't a wrestler, so can't compete in a match" },
    ]);
  });
});

describe('the card-wide checks', () => {
  it('refuses someone in a second match, naming the first', () => {
    const built = validateWorld();
    const card = bookRunnable(built);
    book(built, 1, match([[who(built, 6)], [who(built, 11)]]));
    const result = validate(built);
    expect(said(result.errors)).toEqual([
      { code: 'alreadyOnCard', message: 'Mia Torres is already in a match on this card (Opener)' },
    ]);
    expect(result.errors[0]?.slot).toEqual({ preShow: false, slot: 1 });
    expect(result.errors[0]?.segmentId).not.toBe(card.opener);
    expect(validate(built, { 'booking.maxMatchesPerPersonPerShow': 2 }).errors).toEqual([]);
  });

  it('refuses a third segment of any kind for one person', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, angle([who(built, 5)]));
    book(built, 3, angle([who(built, 5)], 'angle.interview'));
    expect(said(validate(built).errors)).toEqual([
      {
        code: 'tooManyAppearances',
        message: 'Kai Moreno is in 3 segments on this card; the most is 2',
      },
    ]);
    expect(validate(built, { 'booking.maxAppearancesPerShow': 3 }).errors).toEqual([]);
  });
});

describe('the structure checks', () => {
  it('refuses a match with the wrong number of sides', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, match([[who(built, 11)], [who(built, 5)]], { type: 'match.triple-threat' }));
    expect(said(validate(built).errors)).toEqual([
      { code: 'sideCount', message: 'Slot 2: Two sides in a Three-Way match; it takes 3' },
    ]);
  });

  it('refuses a side of the wrong size', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(
      built,
      1,
      match([[who(built, 11), who(built, 1)], [who(built, 2)]], { type: 'match.tag-team' }),
    );
    expect(said(validate(built).errors)).toEqual([
      { code: 'sideSize', message: 'Slot 2: Side 2 has 1 wrestler; Tag Team takes 2 a side' },
    ]);
  });

  it('refuses uneven sides in a match type that takes equal sides', () => {
    const built = validateWorld();
    const key = parseContentKey('match.test-even');
    const handicap = TEST_CATALOGS.matchTypes?.[parseContentKey('match.handicap')];
    if (handicap === undefined) {
      throw new Error('The test catalogs have no handicap match');
    }
    change(built, (tx) => {
      tx.setMeta({
        catalogs: {
          ...TEST_CATALOGS,
          matchTypes: {
            ...TEST_CATALOGS.matchTypes,
            [key]: { ...handicap, key, name: 'Test Even', equalSides: true },
          },
        },
      });
    });
    bookRunnable(built);
    book(
      built,
      1,
      match([[who(built, 11), who(built, 1)], [who(built, 2)]], { type: 'match.test-even' }),
    );
    expect(said(validate(built).errors)).toEqual([
      {
        code: 'unequalSides',
        message: 'Slot 2: the sides are uneven (2 against 1); Test Even takes equal sides',
      },
    ]);
  });

  it('refuses an angle with too few speakers', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, angle([who(built, 11)], 'angle.confrontation'));
    expect(said(validate(built).errors)).toEqual([
      {
        code: 'speakerCount',
        message: 'Slot 2: One speaker in a Confrontation; it takes 2 to 8',
      },
    ]);
  });

  it('refuses a match without a planned result', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, match([[who(built, 11)], [who(built, 1)]], { outcome: null }));
    const result = validate(built);
    expect(said(result.errors)).toEqual([
      {
        code: 'noPlannedResult',
        message: 'Slot 2: no result planned; pick a winner, a draw or a no contest',
      },
    ]);
    expect(result.checklist.find((line) => line.id === 'results')).toMatchObject({
      passed: false,
      severity: 'error',
      detail: 'Slot 2: no result planned; pick a winner, a draw or a no contest',
    });
  });

  it('needs 3 of 6 main-card slots filled at the default share', () => {
    const built = validateWorld();
    book(built, 0, match([[who(built, 6)], [who(built, 7)]]));
    book(built, 5, match([[who(built, 8)], [who(built, 9)]]));
    const short = validate(built);
    expect(said(short.errors)).toEqual([
      { code: 'tooFewFilled', message: 'Main card: 2 of 6 slots filled (needs 3)' },
    ]);
    expect(short.checklist[0]).toMatchObject({
      label: 'Main card filled (2 of 6, needs 3)',
      passed: false,
      detail: 'Main card: 2 of 6 slots filled (needs 3)',
    });
    book(built, 2, angle([who(built, 5)]));
    expect(validate(built).errors).toEqual([]);
  });

  it('follows the share at 0 and at 1', () => {
    const built = validateWorld();
    book(built, 5, match([[who(built, 8)], [who(built, 9)]]));
    expect(validate(built, { 'booking.minFilledMainShare': 0 }).errors).toEqual([]);
    expect(said(validate(built, { 'booking.minFilledMainShare': 1 }).errors)).toEqual([
      { code: 'tooFewFilled', message: 'Main card: 1 of 6 slots filled (needs 6)' },
    ]);
    const [filled] = validate(built, { 'booking.minFilledMainShare': 0 }).checklist;
    expect(filled?.label).toBe('Main card filled (1 of 6, needs 0)');
  });

  it('needs the main event unless the tunable turns it off', () => {
    const built = validateWorld();
    book(built, 0, match([[who(built, 6)], [who(built, 7)]]));
    book(built, 1, match([[who(built, 8)], [who(built, 9)]]));
    book(built, 2, angle([who(built, 5)]));
    const result = validate(built);
    expect(said(result.errors)).toEqual([
      { code: 'emptyMainEvent', message: 'The main event (Slot 6) is empty' },
    ]);
    expect(result.errors[0]?.slot).toEqual({ preShow: false, slot: 5 });
    expect(validate(built, { 'booking.requireMainEvent': false }).errors).toEqual([]);
  });

  it('flags an empty card for both the fill and the main event', () => {
    const built = validateWorld();
    expect(codes(validate(built).errors)).toEqual(['tooFewFilled', 'emptyMainEvent']);
  });
});

describe('the title checks', () => {
  it('refuses a title match without the champion', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, match([[who(built, 11)], [who(built, 5)]], { titleIds: [built.heavyweight] }));
    const result = validate(built);
    expect(said(result.errors)).toEqual([
      { code: 'championMissing', message: "The champion Rhea Cortez isn't in this match" },
    ]);
    expect(result.errors[0]).toMatchObject({ titleId: built.heavyweight, personId: who(built, 0) });
  });

  it('refuses a tag title on a one-a-side match', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, match([[who(built, 1)], [who(built, 2)]], { titleIds: [built.tag] }));
    expect(said(validate(built).errors)).toEqual([
      {
        code: 'titleSideSize',
        message: 'The Test Tag Team Title needs 2 wrestlers on each side',
      },
    ]);
  });

  it("only warns about a man challenging for a vacant women's title", () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, match([[who(built, 11)], [who(built, 5)]], { titleIds: [built.women] }));
    const result = validate(built);
    expect(result.errors).toEqual([]);
    expect(result.runnable).toBe(true);
    expect(said(result.warnings)).toEqual([
      {
        code: 'titleDivision',
        message: "Kai Moreno: The Test Women's Title is a women's title",
      },
    ]);
  });

  it('refuses a title in a match type that takes none', () => {
    const built = validateWorld();
    book(
      built,
      5,
      match(
        [0, 1, 2, 5, 6, 7].map((index) => [who(built, index)]),
        { type: 'match.battle-royal', titleIds: [built.heavyweight] },
      ),
    );
    const result = validate(built);
    expect(said(result.errors.filter((issue) => issue.code === 'titleNotAllowed'))).toEqual([
      {
        code: 'titleNotAllowed',
        message: "Main event: titles can't be on the line in a Battle Royal",
      },
    ]);
  });

  it('refuses a title on the line twice', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, match([[who(built, 0)], [who(built, 11)]], { titleIds: [built.heavyweight] }));
    book(built, 3, match([[who(built, 5)], [who(built, 1)]], { titleIds: [built.heavyweight] }));
    expect(said(validate(built).errors)).toEqual([
      {
        code: 'titleTwiceOnCard',
        message: 'The Test Heavyweight Title is already on the line in Slot 2',
      },
      { code: 'championMissing', message: "The champion Rhea Cortez isn't in this match" },
    ]);
  });

  it('refuses a title retired since it was booked', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, match([[who(built, 0)], [who(built, 11)]], { titleIds: [built.heavyweight] }));
    change(built, (tx) => {
      tx.update('titles', built.heavyweight, { status: 'retired', retiredOn: START });
    });
    expect(said(validate(built).errors)).toEqual([
      { code: 'titleRetired', message: 'The Test Heavyweight Title has been retired' },
    ]);
  });

  it("warns about another brand's title", () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, match([[who(built, 0)], [who(built, 11)]], { titleIds: [built.heavyweight] }));
    change(built, (tx) => {
      tx.update('titles', built.heavyweight, { brandId: built.brandTwo });
    });
    const result = validate(built);
    expect(result.runnable).toBe(true);
    expect(said(result.warnings)).toEqual([
      { code: 'titleOtherBrand', message: 'The Test Heavyweight Title belongs to Test Brand Two' },
    ]);
  });
});

describe('the contract warnings', () => {
  it('warns when a capped contract has no appearances left', () => {
    const built = validateWorld();
    bookRunnable(built);
    updateEmployment(built, 6, (employment) => ({
      appearancesThisYear: 24,
      terms: { ...employment.terms, appearanceCap: 24 },
    }));
    const result = validate(built);
    expect(result.runnable).toBe(true);
    expect(said(result.warnings)).toEqual([
      {
        code: 'appearanceCap',
        message: 'Mia Torres has used 24 of 24 contracted appearances this year',
      },
    ]);
    updateEmployment(built, 6, () => ({ appearancesThisYear: 23 }));
    expect(validate(built).warnings).toEqual([]);
  });

  it('warns about a house show for someone whose contract rules them out', () => {
    const built = validateWorld();
    bookRunnable(built);
    updateEmployment(built, 6, (employment) => ({
      terms: {
        ...employment.terms,
        perks: { ...employment.terms.perks, noHouseShows: true },
      },
    }));
    expect(validate(built).warnings).toEqual([]);
    change(built, (tx) => {
      tx.update('eventInstances', built.show, { importance: 'house' });
    });
    expect(said(validate(built).warnings)).toEqual([
      { code: 'noHouseShows', message: "Mia Torres's contract rules out house shows" },
    ]);
  });

  it('warns about someone from another brand', () => {
    const built = validateWorld();
    bookRunnable(built);
    updateEmployment(built, 6, () => ({ brandId: built.brandTwo }));
    const result = validate(built);
    expect(result.runnable).toBe(true);
    expect(said(result.warnings)).toEqual([
      { code: 'otherBrand', message: 'Mia Torres works for Test Brand Two' },
    ]);
  });
});

describe('the check registry', () => {
  it('runs the built-in checks at orders 100 to 190', () => {
    expect(registeredBookingChecks().map(({ id, order }) => ({ id, order }))).toEqual([
      { id: 'booking.people', order: 100 },
      { id: 'booking.cardWide', order: 110 },
      { id: 'booking.structure', order: 120 },
      { id: 'booking.titles', order: 130 },
      { id: 'booking.warnings', order: 190 },
    ]);
  });

  it("adds a feature check's issues and its own checklist line", () => {
    const built = validateWorld();
    const card = bookRunnable(built);
    removals.push(
      registerBookingCheck({
        id: 'test.exclusivity',
        order: 200,
        label: 'Exclusive workers stay on their brand',
        run: (input) =>
          input.segments
            .filter((segment) => segment.id === card.opener)
            .map((segment) => ({
              code: 'testExclusive',
              severity: 'error' as const,
              message: 'Mia Torres is exclusive to another brand',
              segmentId: segment.id,
              slot: { preShow: segment.preShow, slot: segment.slot },
            })),
      }),
    );
    const result = validate(built);
    expect(result.errors).toEqual([
      {
        checkId: 'test.exclusivity',
        code: 'testExclusive',
        severity: 'error',
        message: 'Mia Torres is exclusive to another brand',
        segmentId: card.opener,
        slot: { preShow: false, slot: 0 },
      },
    ]);
    expect(result.checklist.at(-1)).toEqual({
      id: 'test.exclusivity',
      label: 'Exclusive workers stay on their brand',
      passed: false,
      severity: 'error',
      detail: 'Mia Torres is exclusive to another brand',
    });
    expect(result.checklist).toHaveLength(8);
  });

  it('turns a throwing check into one warning so the card can still be locked', () => {
    const built = validateWorld();
    bookRunnable(built);
    removals.push(
      registerBookingCheck({
        id: 'test.broken',
        order: 250,
        run: () => {
          throw new Error('Test check bug');
        },
      }),
    );
    const result = validate(built);
    expect(result.runnable).toBe(true);
    expect(result.warnings).toEqual([
      {
        checkId: 'test.broken',
        code: CHECK_FAILED_CODE,
        severity: 'warning',
        message: 'A booking check (test.broken) failed; the card can still be locked',
      },
    ]);
    expect(result.checklist.at(-1)).toMatchObject({ id: 'test.broken', severity: 'warning' });
  });

  it('refuses a duplicate id and an id that is not system.camelName', () => {
    removals.push(registerBookingCheck({ id: 'test.once', order: 200, run: () => [] }));
    expect(() => registerBookingCheck({ id: 'test.once', order: 201, run: () => [] })).toThrow(
      RegistryError,
    );
    expect(() => registerBookingCheck({ id: 'Test Check', order: 200, run: () => [] })).toThrow(
      RegistryError,
    );
    expect(() => registerBookingCheck({ id: 'booking.people', order: 100, run: () => [] })).toThrow(
      RegistryError,
    );
  });

  it('runs checks in order, then by id', () => {
    removals.push(registerBookingCheck({ id: 'test.zeta', order: 200, run: () => [] }));
    removals.push(registerBookingCheck({ id: 'test.alpha', order: 200, run: () => [] }));
    removals.push(registerBookingCheck({ id: 'test.first', order: 50, run: () => [] }));
    expect(registeredBookingChecks().map((check) => check.id)).toEqual([
      'test.first',
      'booking.people',
      'booking.cardWide',
      'booking.structure',
      'booking.titles',
      'booking.warnings',
      'test.alpha',
      'test.zeta',
    ]);
  });
});

describe('the order of issues', () => {
  function messyCard(): ValidateWorld {
    const built = validateWorld();
    book(built, 3, match([[who(built, 4)], [who(built, 7)]], { outcome: null }));
    book(built, 0, match([[who(built, 6)], [who(built, 7)]], { titleIds: [built.heavyweight] }));
    book(built, 0, match([[who(built, 6)], [who(built, 9)]], { outcome: null }), { preShow: true });
    return built;
  }

  it('sorts card-wide issues first, then the pre-show, then the main card by slot', () => {
    const result = validate(messyCard());
    expect(
      result.errors.map((issue) => [
        issue.code,
        issue.slot === undefined
          ? 'card'
          : `${issue.slot.preShow ? 'pre' : 'main'} ${String(issue.slot.slot)}`,
      ]),
    ).toEqual([
      ['tooFewFilled', 'card'],
      ['noPlannedResult', 'pre 0'],
      ['alreadyOnCard', 'main 0'],
      ['championMissing', 'main 0'],
      ['personUnavailable', 'main 3'],
      ['alreadyOnCard', 'main 3'],
      ['noPlannedResult', 'main 3'],
      ['emptyMainEvent', 'main 5'],
    ]);
  });

  it('gives the same answer every time', () => {
    const first: BookingValidation = validate(messyCard());
    const second: BookingValidation = validate(messyCard());
    expect(second).toEqual(first);
  });
});

describe('booking.validate', () => {
  const AS_PLAYER_ONE: Viewer = { kind: 'controller', controller: PLAYER_ONE };
  const AS_PLAYER_TWO: Viewer = { kind: 'controller', controller: PLAYER_TWO };

  it('answers the show runner with the same validation as validateCard', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, match([[who(built, 3)], [who(built, 11)]]));
    const engine = createEngine({
      state: initialEngineState(built.world),
      systems: defaultSystems,
    });
    const result = engine.query('booking.validate', { eventInstanceId: built.show }, AS_PLAYER_ONE);
    expect(result).toEqual({ ok: true, data: validate(built) });
  });

  it("refuses someone else's show and an unknown show", () => {
    const built = validateWorld();
    const engine = createEngine({
      state: initialEngineState(built.world),
      systems: defaultSystems,
    });
    expect(
      engine.query('booking.validate', { eventInstanceId: built.show }, AS_PLAYER_TWO),
    ).toMatchObject({ ok: false, reasons: [{ code: 'notYourShow' }] });
    const rival = engine.query('booking.validate', { eventInstanceId: built.rival }, AS_PLAYER_ONE);
    expect(rival).toMatchObject({ ok: false, reasons: [{ code: 'notYourShow' }] });
  });

  it('replays the minimum-filled trace it carries', () => {
    const built = validateWorld();
    const [filled] = validate(built).checklist;
    expect(filled?.trace).toBeDefined();
    if (filled?.trace !== undefined) {
      expectTraceReplays({ value: 3, trace: filled.trace });
    }
  });
});
