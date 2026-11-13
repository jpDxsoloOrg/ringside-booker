// Auto and Random in a match's Result list (MTCH2-08): a result left to the night, from the schema
// through booking and validation to show night. Design: docs/design/match-finishes.md#auto-and-random
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../src/core/content-key';
import { ZERO_CENTS } from '../../../src/core/money';
import type { PersonId, SegmentId } from '../../../src/core/ids';
import { RngRegistry } from '../../../src/core/rng/registry';
import { findTraceNodes, inputOf, walkTrace, type TraceNode } from '../../../src/core/trace';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import type { MatchSegment, Segment } from '../../../src/model/entities/segment';
import { defaultSystems } from '../../../src/systems';
import { validateCard } from '../../../src/systems/booking';
import {
  plannedResultOf,
  withPlannedResult,
  type MatchDraft,
  type PlannedResult,
} from '../../../src/systems/booking/draft';
import {
  AUTO_WINNER_LABEL,
  COIN_FLIP_LABEL,
  MATCH_AUTO_WINNER_STREAM,
  RANDOM_WINNERS_LABEL,
  RANDOM_WINNERS_SET_ASIDE_NOTE,
  autoWinner,
  coinFlipDrawLabel,
  type AutoWinnerMode,
  type AutoWinnerSideScore,
} from '../../../src/systems/match';
import { MATCH_RESULT_TRACE_KIND } from '../../../src/systems/shows';
import { createEngineTunables } from '../../../src/systems/tunables';
import { PLAYER_ONE } from '../calendar/lifecycle-world';
import { commandWorld, seed, singles, wrestler } from '../booking/command-world';
import {
  changedEvents,
  competitor,
  member,
  runNight,
  titleMatch,
  titleNightWorld,
  type TitleNightWorld,
} from '../shows/title-night-world';
import {
  check,
  emptyShowWorld,
  issueCodes,
  makeInstance,
  personId,
  putSinglesMatch,
} from '../../support/show-world';

const RUNS = 2000;
const CLEAN = parseContentKey('finish.clean');
const DISQUALIFICATION_FINISH = parseContentKey('finish.disqualification');
const STALEMATE = parseContentKey('finish.stalemate');

function side(index: number, score: number, lowest: PersonId): AutoWinnerSideScore {
  const label = `Side ${String(index + 1)}`;
  return { side: index, label, score: inputOf(`${label} score`, score), lowestPersonId: lowest };
}

/** How often each side wins over `RUNS` seeds. */
function winShares(
  sides: readonly AutoWinnerSideScore[],
  mode: AutoWinnerMode,
  randomness: number,
): number[] {
  const wins = sides.map(() => 0);
  for (let run = 0; run < RUNS; run += 1) {
    const result = autoWinner(
      { sides, randomness: inputOf('Unpredictability', randomness), mode },
      { rng: new RngRegistry(`share-${String(run)}`).stream(MATCH_AUTO_WINNER_STREAM) },
    );
    wins[result.value] = (wins[result.value] ?? 0) + 1;
  }
  return wins.map((count) => count / RUNS);
}

function textsIn(node: TraceNode): string[] {
  const texts: string[] = [];
  walkTrace(node, (visited) => {
    texts.push(visited.label);
    if (visited.kind === 'decision') {
      texts.push(visited.reason);
    }
  });
  return texts;
}

function matchOf(segment: Segment | undefined): MatchSegment {
  if (segment?.kind !== 'match') {
    throw new Error('Not a match');
  }
  return segment;
}

/** A match draft left to the night, optionally with a booked finish. */
function onTheNight(
  draft: MatchDraft,
  plan: 'auto' | 'random',
  finishKey: MatchDraft['match']['finishKey'] = null,
): MatchDraft {
  const planned = withPlannedResult(draft, plan);
  return { ...planned, match: { ...planned.match, finishKey } };
}

function resultTrace(night: ReturnType<typeof runNight>, segmentId: SegmentId): TraceNode {
  const entry = night.runtime.traces.get({ kind: MATCH_RESULT_TRACE_KIND, id: segmentId });
  if (entry === undefined || !('trace' in entry)) {
    throw new Error(`No match result trace for ${segmentId}`);
  }
  return entry.trace;
}

/** A singles match between roster 4 and 5 on the player's show, left to the night. */
function bookedNight(plan: 'auto' | 'random', options: { randomWinners?: boolean } = {}) {
  const built = titleNightWorld(options);
  const segmentId = seed(
    built.world,
    built.show,
    0,
    onTheNight(singles(member(built, 4), member(built, 5)), plan),
  );
  return { built, segmentId };
}

function segmentAfter(built: TitleNightWorld, segmentId: SegmentId): MatchSegment {
  return matchOf(built.world.tables.segments.get(segmentId));
}

describe('the planned result helpers', () => {
  it('round-trip every Result-list choice through a draft', () => {
    const draft = singles(personId(1), personId(2));
    const choices: PlannedResult[] = [
      'auto',
      'random',
      { kind: 'draw' },
      { kind: 'noContest' },
      { kind: 'win', winningSide: 1, methodKey: parseContentKey('method.pinfall') },
      null,
    ];
    for (const choice of choices) {
      const next = withPlannedResult(draft, choice);
      expect(plannedResultOf(next)).toEqual(choice);
    }
    const auto = withPlannedResult(draft, 'auto');
    expect(auto.outcome).toBeNull();
    expect('resultPlan' in withPlannedResult(auto, { kind: 'draw' }).match).toBe(false);
  });
});

describe('the segment schema', () => {
  it('reports a planned outcome next to Auto or Random before the show runs', () => {
    const world = emptyShowWorld();
    world.tables.eventInstances._put(makeInstance(1));
    putSinglesMatch(world, 1, {
      match: {
        matchTypeKey: parseContentKey('match.singles'),
        stipulationKeys: [],
        titleIds: [],
        finishKey: null,
        resultPlan: 'auto',
      },
      outcome: { kind: 'draw' },
    });
    expect(issueCodes(check(world))).toEqual(['segments.resultPlanWithOutcome']);
  });

  it('keeps the plan as a record once the show is completed', () => {
    const world = emptyShowWorld();
    world.tables.eventInstances._put(
      makeInstance(1, {
        status: 'completed',
        result: {
          score: 60,
          rawScore: 60,
          traceId: null,
          attendance: 900,
          gate: ZERO_CENTS,
          viewers: null,
        },
      }),
    );
    putSinglesMatch(world, 1, {
      match: {
        matchTypeKey: parseContentKey('match.singles'),
        stipulationKeys: [],
        titleIds: [],
        finishKey: null,
        resultPlan: 'random',
      },
      outcome: { kind: 'win', winningSide: 0, methodKey: parseContentKey('method.pinfall') },
    });
    expect(issueCodes(check(world))).toEqual([]);
  });
});

describe('booking Auto and Random', () => {
  function engineWithMatch(options: { randomWinners?: boolean } = {}) {
    const booked = commandWorld(options);
    const match = seed(
      booked.world,
      booked.shows.open,
      0,
      singles(wrestler(booked, 0), wrestler(booked, 1)),
    );
    const engine: Engine = createEngine({
      state: initialEngineState(booked.world),
      systems: defaultSystems,
    });
    return { booked, match, engine };
  }

  function stored(engine: Engine, id: SegmentId): MatchSegment {
    return matchOf(engine.exportState().world.tables.segments.find((row) => row.id === id));
  }

  it('sets Auto and Random from the row menu, and a side clears them', () => {
    const { engine, match } = engineWithMatch();
    const setResult = (result: PlannedResult) =>
      engine.command('booking.setResult', { segmentId: match, result }, PLAYER_ONE);
    expect(setResult('auto').ok).toBe(true);
    expect(stored(engine, match)).toMatchObject({ outcome: null, match: { resultPlan: 'auto' } });
    expect(setResult('random').ok).toBe(true);
    expect(stored(engine, match).match.resultPlan).toBe('random');
    // The same choice again changes nothing.
    expect(setResult('random')).toEqual({ ok: true, data: null, events: [] });
    expect(setResult({ kind: 'draw' }).ok).toBe(true);
    expect(stored(engine, match).outcome).toEqual({ kind: 'draw' });
    expect(stored(engine, match).match.resultPlan).toBeUndefined();
  });

  it('accepts Auto and Random in a draft, but not with a planned outcome too', () => {
    const { booked, engine } = engineWithMatch();
    const draft = singles(wrestler(booked, 2), wrestler(booked, 3));
    const added = engine.command(
      'booking.addSegment',
      {
        eventInstanceId: booked.shows.open,
        preShow: false,
        slot: 1,
        draft: withPlannedResult(draft, 'random'),
      },
      PLAYER_ONE,
    );
    expect(added.ok).toBe(true);
    const both = engine.command(
      'booking.addSegment',
      {
        eventInstanceId: booked.shows.open,
        preShow: false,
        slot: 2,
        draft: { ...withPlannedResult(draft, 'auto'), outcome: { kind: 'draw' } },
      },
      PLAYER_ONE,
    );
    expect(both).toMatchObject({ ok: false, reasons: [{ code: 'resultPlanWithOutcome' }] });
  });

  it('sends a finish nobody wins back to Auto when the result becomes Auto', () => {
    const booked = commandWorld();
    const draw = singles(wrestler(booked, 0), wrestler(booked, 1), { kind: 'draw' });
    const match = seed(booked.world, booked.shows.open, 0, {
      ...draw,
      match: { ...draw.match, finishKey: STALEMATE },
    });
    const engine = createEngine({
      state: initialEngineState(booked.world),
      systems: defaultSystems,
    });
    const result = engine.command(
      'booking.setResult',
      { segmentId: match, result: 'auto' },
      PLAYER_ONE,
    );
    expect(result.ok).toBe(true);
    expect(stored(engine, match).match).toMatchObject({ finishKey: null, resultPlan: 'auto' });
  });

  it('is refused on a Random winners game with the existing message', () => {
    const { engine, match } = engineWithMatch({ randomWinners: true });
    for (const result of ['auto', 'random'] as const) {
      expect(
        engine.command('booking.setResult', { segmentId: match, result }, PLAYER_ONE),
      ).toMatchObject({
        ok: false,
        reasons: [
          {
            code: 'randomWinners',
            message: 'Results on your shows are decided on the night (Random winners).',
          },
        ],
      });
    }
  });
});

describe('validating a card with Auto and Random', () => {
  const tunables = createEngineTunables();

  it('counts Auto and Random as a planned result', () => {
    for (const plan of ['auto', 'random'] as const) {
      const { built } = bookedNight(plan);
      const codes = validateCard(built.world, built.show, { tunables }).errors.map(
        (issue) => issue.code,
      );
      expect(codes).not.toContain('noPlannedResult');
    }
  });

  it('accepts a finish somebody wins and refuses one nobody wins', () => {
    const built = titleNightWorld();
    const draft = singles(member(built, 4), member(built, 5));
    seed(built.world, built.show, 0, onTheNight(draft, 'auto', CLEAN));
    seed(
      built.world,
      built.show,
      1,
      onTheNight(singles(member(built, 6), member(built, 7)), 'random', STALEMATE),
    );
    const issues = validateCard(built.world, built.show, { tunables }).errors.filter(
      (issue) => issue.code === 'finishOutcomeMismatch',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('Random always gives a winner');
  });
});

describe('show night with Auto and Random', () => {
  it('decides an Auto match with the auto-winner and gives it a finish', () => {
    const { built, segmentId } = bookedNight('auto');
    const night = runNight(built);
    const segment = segmentAfter(built, segmentId);
    expect(segment.outcome?.kind).toBe('win');
    expect(segment.match.finishKey).not.toBeNull();
    expect(segment.match.resultPlan).toBe('auto');
    expect(textsIn(resultTrace(night, segmentId))).toContain(AUTO_WINNER_LABEL);
  });

  it('decides a Random match with a coin flip, each side drawing once', () => {
    const { built, segmentId } = bookedNight('random');
    const night = runNight(built);
    const segment = segmentAfter(built, segmentId);
    expect(segment.outcome?.kind).toBe('win');
    const texts = textsIn(resultTrace(night, segmentId));
    expect(texts).toContain(COIN_FLIP_LABEL);
    expect(texts).toContain(coinFlipDrawLabel('Side 1'));
    expect(texts).toContain(coinFlipDrawLabel('Side 2'));
    expect(texts).not.toContain(AUTO_WINNER_LABEL);
  });

  it('is the same over the same seed', () => {
    for (const plan of ['auto', 'random'] as const) {
      const first = bookedNight(plan);
      runNight(first.built);
      const second = bookedNight(plan);
      runNight(second.built);
      expect(segmentAfter(second.built, second.segmentId).outcome).toEqual(
        segmentAfter(first.built, first.segmentId).outcome,
      );
    }
  });

  it('sets Auto and Random aside in a Random winners game, and says so', () => {
    const { built, segmentId } = bookedNight('random', { randomWinners: true });
    const night = runNight(built);
    expect(segmentAfter(built, segmentId).outcome?.kind).toBe('win');
    const texts = textsIn(resultTrace(night, segmentId));
    expect(texts).toContain(RANDOM_WINNERS_SET_ASIDE_NOTE);
    // The game-wide setting is a true coin flip as well, under its own label.
    expect(texts).toContain(RANDOM_WINNERS_LABEL);
    expect(texts).toContain(COIN_FLIP_LABEL);
  });

  it('changes a title only on a finish that allows it', () => {
    for (const [finishKey, canChange] of [
      [DISQUALIFICATION_FINISH, false],
      [CLEAN, true],
    ] as const) {
      const built = titleNightWorld();
      const draft = titleMatch(
        [competitor(member(built, 0), 0), competitor(member(built, 1), 1)],
        null,
        [built.titles.world],
      );
      const segmentId = seed(built.world, built.show, 0, onTheNight(draft, 'random', finishKey));
      const night = runNight(built);
      const segment = segmentAfter(built, segmentId);
      expect(segment.match.finishKey).toBe(finishKey);
      const challengerWon = segment.outcome?.kind === 'win' && segment.outcome.winningSide === 1;
      expect(changedEvents(night.runtime)).toHaveLength(canChange && challengerWon ? 1 : 0);
    }
  });
});

describe('the auto-winner modes over many runs', () => {
  const randomness = createEngineTunables().get('match.autoWinner.randomness');

  it('gives every side an equal chance on a coin flip, whatever the scores', () => {
    for (const mode of ['coinFlip', 'randomWinners'] as const) {
      const shares = winShares([side(0, 10, personId(1)), side(1, 90, personId(2))], mode, 60);
      for (const share of shares) {
        expect(share).toBeGreaterThan(0.45);
        expect(share).toBeLessThan(0.55);
      }
    }
    const three = winShares(
      [side(0, 5, personId(1)), side(1, 50, personId(2)), side(2, 95, personId(3))],
      'coinFlip',
      0,
    );
    for (const share of three) {
      expect(share).toBeGreaterThan(0.28);
      expect(share).toBeLessThan(0.39);
    }
  });

  it('lets the favourite win most but not all Auto matches, and names the upsets', () => {
    const favourite = side(1, 60, personId(2));
    const underdog = side(0, 60 - randomness / 2, personId(1));
    const shares = winShares([underdog, favourite], 'standard', randomness);
    expect(shares[1]).toBeGreaterThan(0.6);
    expect(shares[1]).toBeLessThan(0.99);

    let upsets = 0;
    for (let run = 0; run < 200; run += 1) {
      const result = autoWinner(
        {
          sides: [underdog, favourite],
          randomness: inputOf('Unpredictability', randomness),
          mode: 'standard',
          // Any lower-scored win counts as an upset here (MTCH2-09's gap setting at 0).
          upsetNoteGap: inputOf('Upset gap', 0),
        },
        { rng: new RngRegistry(`upset-${String(run)}`).stream(MATCH_AUTO_WINNER_STREAM) },
      );
      const notes = findTraceNodes(result.trace, 'note').map((node) => node.label);
      const upset = notes.some((note) => note.startsWith('Upset: Side 1 won from'));
      expect(upset).toBe(result.value === 0);
      upsets += upset ? 1 : 0;
    }
    expect(upsets).toBeGreaterThan(0);
  });

  it('never rolls a draw: a coin flip always names one side', () => {
    const result = autoWinner(
      {
        sides: [side(0, 0, personId(3)), side(1, 0, personId(4))],
        randomness: inputOf('Unpredictability', 0),
        mode: 'coinFlip',
      },
      { rng: new RngRegistry('one').stream(MATCH_AUTO_WINNER_STREAM) },
    );
    expect([0, 1]).toContain(result.value);
    expect(result.trace.label).toBe(COIN_FLIP_LABEL);
    expect(findTraceNodes(result.trace, 'roll')).toHaveLength(2);
  });
});
