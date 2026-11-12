// MTCH2 wired into booking (EVT2-07): the `match.finish` booking check, Random winners on the
// booking commands and checks, and a planned finish the quick result menu no longer fits.
// Design: docs/design/booking.md#integration and docs/design/match-finishes.md#integration.
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine, type Viewer } from '../../../src/core/api';
import { parseContentKey } from '../../../src/core/content-key';
import type { SegmentId } from '../../../src/core/ids';
import type { MatchOutcome } from '../../../src/model/entities/segment';
import type { GameWorld } from '../../../src/model/tables';
import { defaultSystems } from '../../../src/systems';
import {
  registeredBookingChecks,
  setPlannedOutcome,
  type BookingIssue,
} from '../../../src/systems/booking';
import { FINISH_BOOKING_CHECK_ID } from '../../../src/systems/match';
import { commandWorld, seed, singles, wrestler } from './command-world';
import {
  angle,
  book,
  bookRunnable,
  match,
  PINFALL,
  PLAYER_ONE,
  validate,
  validateWorld,
  who,
  type ValidateWorld,
} from './validate-world';

const DISQUALIFICATION = parseContentKey('method.disqualification');
const DQ_WIN_FOR_SIDE_2: MatchOutcome = {
  kind: 'win',
  winningSide: 1,
  methodKey: DISQUALIFICATION,
};
const RANDOM_WINNERS = 'Results on your shows are decided on the night (Random winners).';

function engineOver(world: GameWorld): Engine {
  return createEngine({ state: initialEngineState(world), systems: defaultSystems });
}

function finishIssues(built: ValidateWorld): Pick<BookingIssue, 'code' | 'severity' | 'message'>[] {
  const result = validate(built);
  return [...result.errors, ...result.warnings]
    .filter((issue) => issue.checkId === FINISH_BOOKING_CHECK_ID)
    .map(({ code, severity, message }) => ({ code, severity, message }));
}

function finishKeyOf(world: GameWorld, segmentId: SegmentId): string | null | undefined {
  const segment = world.tables.segments.get(segmentId);
  return segment?.kind === 'match' ? segment.match.finishKey : undefined;
}

describe('the match.finish booking check', () => {
  it('is registered at order 200, after the built-in checks', () => {
    const check = registeredBookingChecks().find((entry) => entry.id === FINISH_BOOKING_CHECK_ID);
    expect(check).toMatchObject({ order: 200, label: 'Finishes fit their matches' });
    expect(registeredBookingChecks().at(-1)?.id).toBe(FINISH_BOOKING_CHECK_ID);
  });

  it('says nothing about a card whose matches are left to Auto', () => {
    const built = validateWorld();
    bookRunnable(built);
    expect(finishIssues(built)).toEqual([]);
    expect(validate(built).checklist.map((line) => line.id)).not.toContain(FINISH_BOOKING_CHECK_ID);
  });

  it('refuses a finish the match type and side count do not allow', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(
      built,
      1,
      match([[who(built, 0)], [who(built, 1)], [who(built, 2)]], {
        type: 'match.triple-threat',
        outcome: { kind: 'win', winningSide: 0, methodKey: DISQUALIFICATION },
        finishKey: 'finish.disqualification',
      }),
    );
    expect(finishIssues(built)).toEqual([
      {
        code: 'finishNotAllowed',
        severity: 'error',
        message:
          "Slot 2: a Disqualification finish can't end this match; pick another finish or Auto",
      },
    ]);
    const result = validate(built);
    expect(result.runnable).toBe(false);
    expect(result.checklist.at(-1)).toMatchObject({
      id: FINISH_BOOKING_CHECK_ID,
      label: 'Finishes fit their matches',
      passed: false,
      severity: 'error',
    });
  });

  it('refuses a planned result the finish cannot end in', () => {
    const built = validateWorld();
    book(
      built,
      0,
      match([[who(built, 6)], [who(built, 7)]], {
        outcome: { kind: 'draw' },
        finishKey: 'finish.disqualification',
      }),
    );
    expect(finishIssues(built)).toEqual([
      {
        code: 'finishOutcomeMismatch',
        severity: 'error',
        message: 'Opener: a Disqualification finish ends in a winner, but the plan is a draw',
      },
    ]);
  });

  it('refuses a win by a method the finish does not end with', () => {
    const built = validateWorld();
    book(
      built,
      0,
      match([[who(built, 6)], [who(built, 7)]], { finishKey: 'finish.disqualification' }),
    );
    expect(finishIssues(built)).toEqual([
      {
        code: 'methodNotInFinish',
        severity: 'error',
        message: "Opener: a Disqualification finish can't be won by Pinfall",
      },
    ]);
  });

  it('only warns when a challenger wins a title match on a finish that keeps the title', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(
      built,
      1,
      match([[who(built, 0)], [who(built, 5)]], {
        titleIds: [built.heavyweight],
        outcome: DQ_WIN_FOR_SIDE_2,
        finishKey: 'finish.disqualification',
      }),
    );
    expect(finishIssues(built)).toEqual([
      {
        code: 'finishBlocksTitleChange',
        severity: 'warning',
        message: "The title can't change hands on a Disqualification finish",
      },
    ]);
    const result = validate(built);
    expect(result.runnable).toBe(true);
    expect(result.warnings.find((issue) => issue.code === 'finishBlocksTitleChange')).toMatchObject(
      { titleId: built.heavyweight, slot: { preShow: false, slot: 1 } },
    );
  });

  it('says nothing when the champion wins by disqualification or a challenger wins clean', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(
      built,
      1,
      match([[who(built, 0)], [who(built, 5)]], {
        titleIds: [built.heavyweight],
        outcome: { kind: 'win', winningSide: 0, methodKey: DISQUALIFICATION },
        finishKey: 'finish.disqualification',
      }),
    );
    expect(finishIssues(built)).toEqual([]);

    const clean = validateWorld();
    book(
      clean,
      1,
      match([[who(clean, 0)], [who(clean, 5)]], {
        titleIds: [clean.heavyweight],
        outcome: { kind: 'win', winningSide: 1, methodKey: PINFALL },
        finishKey: 'finish.clean',
      }),
    );
    expect(finishIssues(clean)).toEqual([]);
  });
});

describe('Random winners on the booking checks', () => {
  it('locks a card with no planned results', () => {
    const built = validateWorld({ randomWinners: true });
    book(built, 0, match([[who(built, 6)], [who(built, 7)]], { outcome: null }));
    book(built, 2, angle([who(built, 5)]));
    book(built, 5, match([[who(built, 8)], [who(built, 9)]], { outcome: null }));
    const result = validate(built);
    expect(result.errors).toEqual([]);
    expect(result.checklist.find((line) => line.id === 'results')).toMatchObject({ passed: true });

    const engine = engineOver(built.world);
    expect(
      engine.command('booking.lockCard', { eventInstanceId: built.show }, PLAYER_ONE),
    ).toMatchObject({ ok: true, data: { status: 'booked' } });
  });

  it('refuses a planned result or finish left on a Random winners show', () => {
    const built = validateWorld({ randomWinners: true });
    book(
      built,
      0,
      match([[who(built, 6)], [who(built, 7)]], {
        finishKey: 'finish.clean',
      }),
    );
    expect(finishIssues(built)).toEqual([
      {
        code: 'randomWinners',
        severity: 'error',
        message: 'Opener: results on your shows are decided on the night (Random winners)',
      },
      {
        code: 'randomWinners',
        severity: 'error',
        message: 'Opener: finishes on your shows are decided on the night (Random winners)',
      },
    ]);
  });

  it('still needs a planned result when the setting is off', () => {
    const built = validateWorld({ randomWinners: false });
    book(built, 0, match([[who(built, 6)], [who(built, 7)]], { outcome: null }));
    expect(validate(built).errors.map((issue) => issue.code)).toContain('noPlannedResult');
  });
});

describe('Random winners on the booking commands', () => {
  it('refuses a planned result from the quick menu and the editor, and accepts none', () => {
    const booked = commandWorld({ randomWinners: true });
    const eventInstanceId = booked.shows.open;
    const matchId = seed(
      booked.world,
      eventInstanceId,
      0,
      singles(wrestler(booked, 0), wrestler(booked, 1)),
    );
    const engine = engineOver(booked.world);
    const planned = singles(wrestler(booked, 2), wrestler(booked, 3), {
      kind: 'win',
      winningSide: 0,
      methodKey: PINFALL,
    });
    const refused = {
      ok: false,
      reasons: [expect.objectContaining({ code: 'randomWinners', message: RANDOM_WINNERS })],
    };

    expect(
      engine.command(
        'booking.setResult',
        { segmentId: matchId, result: { kind: 'draw' } },
        PLAYER_ONE,
      ),
    ).toEqual(refused);
    expect(
      engine.command(
        'booking.addSegment',
        { eventInstanceId, preShow: false, slot: 1, draft: planned },
        PLAYER_ONE,
      ),
    ).toEqual(refused);
    const withFinish = singles(wrestler(booked, 0), wrestler(booked, 1));
    expect(
      engine.command(
        'booking.updateSegment',
        {
          segmentId: matchId,
          draft: {
            ...withFinish,
            match: { ...withFinish.match, finishKey: parseContentKey('finish.clean') },
          },
        },
        PLAYER_ONE,
      ),
    ).toEqual({
      ok: false,
      reasons: [expect.objectContaining({ code: 'randomWinners', field: 'match.finishKey' })],
    });

    expect(
      engine.command('booking.setResult', { segmentId: matchId, result: null }, PLAYER_ONE).ok,
    ).toBe(true);
    expect(
      engine.command(
        'booking.addSegment',
        {
          eventInstanceId,
          preShow: false,
          slot: 1,
          draft: singles(wrestler(booked, 2), wrestler(booked, 3)),
        },
        PLAYER_ONE,
      ).ok,
    ).toBe(true);
  });

  it("marks the card for the editor on human-run shows (a human-run brand too), not the computer's", () => {
    const booked = commandWorld({ randomWinners: true });
    const [left, right] = booked.rivals;
    if (left === undefined || right === undefined) {
      throw new Error('The command world has no rival roster');
    }
    const engine = engineOver(booked.world);
    const omniscient: Viewer = { kind: 'omniscient' };
    const cardOf = (eventInstanceId: (typeof booked.shows)['open']) => {
      const result = engine.query('booking.card', { eventInstanceId }, omniscient);
      if (!result.ok) throw new Error(JSON.stringify(result.reasons));
      return result.data;
    };
    expect(cardOf(booked.shows.open).randomWinners).toBe(true);
    expect(cardOf(booked.shows.rival).randomWinners).toBe(true);
    expect(cardOf(booked.shows.computer).randomWinners).toBe(false);

    const plain = commandWorld();
    const plainCard = engineOver(plain.world).query(
      'booking.card',
      { eventInstanceId: plain.shows.open },
      omniscient,
    );
    expect(plainCard.ok && plainCard.data.randomWinners).toBe(false);
  });
});

describe('a planned finish and the quick result menu', () => {
  it('keeps a finish the new result fits and sends one it no longer fits back to Auto', () => {
    const built = validateWorld();
    const segmentId = book(
      built,
      0,
      match([[who(built, 6)], [who(built, 7)]], {
        outcome: { kind: 'win', winningSide: 0, methodKey: DISQUALIFICATION },
        finishKey: 'finish.disqualification',
      }),
    );
    const plan = (outcome: MatchOutcome | null): void => {
      const result = built.world.transact('test plan', (tx) => {
        setPlannedOutcome(tx, segmentId, outcome);
      });
      if (!result.ok) throw result.error;
    };

    plan(DQ_WIN_FOR_SIDE_2);
    expect(finishKeyOf(built.world, segmentId)).toBe('finish.disqualification');
    plan(null);
    expect(finishKeyOf(built.world, segmentId)).toBe('finish.disqualification');
    plan({ kind: 'win', winningSide: 0, methodKey: PINFALL });
    expect(finishKeyOf(built.world, segmentId)).toBeNull();
    expect(finishIssues(built)).toEqual([]);
  });
});
