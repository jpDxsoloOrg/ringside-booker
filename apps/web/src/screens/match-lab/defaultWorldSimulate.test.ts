// The Match lab's Run hand-test script (MTCH2-06, MTCH2-07) run against a new default-world game as
// Altura: Auto winner and finish, a booked side, Draw, a booked finish, a tag match, a match type
// that limits its finishes, a fresh seed per Run, Runs at 50, and a game started with Random winners. Every Why? the
// result block offers (Winner, Stars, Score, Work rate, Crowd) is read in the player's words:
// readable labels, the settings named by key, no raw codes, no broken numbers, no running time.
import { describe, expect, it } from 'vitest';
import type {
  ContentKey,
  FinishOption,
  LabOptions,
  LabWorkerRow,
  MatchCatalog,
  PlannedWinner,
  SimulateArgs,
  SimulateBatchResult,
  SimulateResult,
  TraceNode,
} from '@ringside/engine';
import { traceToText } from '@/components/Trace/traceToText';
import { DEFAULT_WORLD_VIEWER as VIEWER, startDefaultWorldGame } from '@/test/defaultWorld';
import { RUNNING_TIME_WORDS } from '@/test/runningTimeWords';
import { regionWhyTrace } from './aftermath/aftermathText';
import { finishesArgsOf } from './result/FinishSelect';
import { methodLineText, outcomeHeadline } from './result/resultText';

/** What a number or a name that failed to format leaves behind. */
const BROKEN_TEXT = /undefined|NaN|Infinity|\[object /;
/** A camelCase code, such as `mainEvent`, outside a dotted setting key or stream name. */
const RAW_CODE = /(?<![.\w])[a-z]+[A-Z]\w*(?![.\w])/;
/** A content key, such as `finish.disqualification`, outside a setting key or stream name. */
const CONTENT_KEY = /\b(finish|method|match-type|stip)\.[a-z-]+\b/;
const MINUTES = /\bminutes?\b|\bmins?\b/i;

/** Re-rolls the Random winners check may spend before a close pair must have changed winner. */
const RANDOM_WINNERS_REROLLS = 20;
/** Seeds the Auto finish is rolled on to check the clean finish is the usual one. */
const FINISH_SAMPLE = 60;
const AUDIT_TIMEOUT_MS = 60_000;

function ask<T>(answer: { ok: true; data: T } | { ok: false; reasons: unknown }, name: string): T {
  if (!answer.ok) throw new Error(`${name} was refused: ${JSON.stringify(answer.reasons)}`);
  return answer.data;
}

/** One new default-world game and the lab's view of it. */
function labOn(settings: Readonly<Record<string, unknown>> = {}) {
  const engine = startDefaultWorldGame('match-lab-simulate-owner-test', settings);
  const options: LabOptions = ask(engine.query('match.labOptions', {}, VIEWER), 'labOptions');
  const catalog: MatchCatalog = ask(engine.query('match.catalog', {}, VIEWER), 'match.catalog');
  const homeRegion = options.defaults.regionId;
  if (homeRegion === null) throw new Error('The default world has no regions.');
  const regionId = homeRegion;
  /** The picker's My roster tab: most popular in the region first. */
  const roster: readonly LabWorkerRow[] = ask(
    engine.query('match.labWorkers', { scope: 'mine', regionId }, VIEWER),
    'match.labWorkers',
  ).rows.filter((row) => row.available && row.style !== 'nonWrestler');

  function typeKey(name: string): ContentKey {
    const type = catalog.matchTypes.find((option) => option.name === name);
    if (type === undefined) throw new Error(`No match type named ${name}.`);
    return type.key;
  }

  function finishes(typeName: string, sideCount: number, winner: PlannedWinner): FinishOption[] {
    return ask(
      engine.query('match.finishes', finishesArgsOf(typeKey(typeName), sideCount, winner), VIEWER),
      'match.finishes',
    );
  }

  function finishKey(typeName: string, name: string): ContentKey {
    const finish = finishes(typeName, 2, 'auto').find((option) => option.name === name);
    if (finish === undefined) throw new Error(`${typeName} has no finish named ${name}.`);
    return finish.key;
  }

  function args(
    typeName: string,
    sides: readonly (readonly LabWorkerRow[])[],
    plan: Partial<SimulateArgs> = {},
  ): SimulateArgs {
    return {
      kind: 'match',
      typeKey: typeKey(typeName),
      sides: sides.map((side) => side.map((row) => row.personId)),
      slotRole: options.defaults.slotRole,
      importance: options.defaults.importance,
      regionId,
      televised: options.defaults.televised,
      previewSeed: 1,
      winner: 'auto',
      finishKey: null,
      ...plan,
    };
  }

  function simulate(simulateArgs: SimulateArgs): SimulateResult {
    return ask(engine.query('match.simulate', simulateArgs, VIEWER), 'match.simulate');
  }

  /** What Run sends with Runs above 1: the same plan played out `runs` times. */
  function simulateBatch(simulateArgs: SimulateArgs, runs: number): SimulateBatchResult {
    return ask(
      engine.query('match.simulateBatch', { ...simulateArgs, runs }, VIEWER),
      'match.simulateBatch',
    );
  }

  function person(index: number): LabWorkerRow {
    const row = roster[index];
    if (row === undefined) throw new Error(`The roster has no one at ${String(index)}.`);
    return row;
  }

  return { engine, options, roster, finishes, finishKey, args, simulate, simulateBatch, person };
}

/** The Why? panels of a simulated result block, by the name each button carries. */
function panelsOf(result: SimulateResult): ReadonlyMap<string, TraceNode> {
  const panels = new Map<string, TraceNode>([
    ['Winner', result.resultTrace],
    ['Stars', result.preview.stars.trace],
    ['Score', result.preview.score.trace],
    ['Crowd', result.preview.crowd.trace],
  ]);
  if (result.preview.workRate !== null) panels.set('Work rate', result.preview.workRate.trace);
  return panels;
}

function expectReadable(name: string, text: string): void {
  for (const line of text.split('\n')) {
    expect(line, `${name}: ${line}`).not.toMatch(BROKEN_TEXT);
    expect(line, `${name}: ${line}`).not.toMatch(RAW_CODE);
    expect(line, `${name}: ${line}`).not.toMatch(CONTENT_KEY);
    expect(line, `${name}: ${line}`).not.toMatch(MINUTES);
    expect(line, `${name}: ${line}`).not.toMatch(RUNNING_TIME_WORDS);
  }
}

/** The headline, method line and every Why? panel of a result block, in the player's words. */
function expectReadableResult(result: SimulateResult): void {
  expectReadable('Headline', outcomeHeadline(result));
  expectReadable('Method line', methodLineText(result));
  expectReadable('Finish summary', result.finish.summary);
  for (const [name, trace] of panelsOf(result)) {
    expectReadable(name, traceToText(trace));
  }
  expect(result.preview.stars.value).toBeGreaterThanOrEqual(0);
  expect(result.preview.stars.value).toBeLessThanOrEqual(5);
  expect(Number.isInteger(result.preview.stars.value * 4)).toBe(true);
  expect(result.preview.score.value).toBeGreaterThanOrEqual(0);
  expect(result.preview.score.value).toBeLessThanOrEqual(100);
}

const lab = labOn();
const singles = [[lab.person(0)], [lab.person(1)]];

describe('Simulate in the Match lab on a new default-world game', () => {
  it('says results are booked, not Random winners, in a game started with the defaults', () => {
    expect(ask(lab.engine.query('match.resultMode', {}, VIEWER), 'resultMode')).toEqual({
      randomWinners: false,
    });
  });

  it('offers every finish to a singles and only Double count-out and Stalemate to a Draw', () => {
    const names = lab.finishes('Singles', 2, 'auto').map((finish) => finish.name);
    expect(names).toEqual(
      expect.arrayContaining(['Clean finish', 'Disqualification', 'Count-out', 'Stalemate']),
    );
    const draws = lab.finishes('Singles', 2, 'draw').map((finish) => finish.name);
    expect(draws.sort()).toEqual(['Double count-out', 'Stalemate']);
    const wins = lab.finishes('Singles', 2, { side: 1 });
    expect(wins.every((finish) => finish.outcomeKind === 'win')).toBe(true);
    const disqualification = wins.find((finish) => finish.name === 'Disqualification');
    expect(disqualification?.allowsTitleChange).toBe(false);
  });

  it('gives a match type with no disqualifications a shorter finish list', () => {
    const threeWay = lab.finishes('Three-Way', 3, 'auto').map((finish) => finish.name);
    expect(threeWay).not.toContain('Disqualification');
    expect(threeWay).not.toContain('Count-out');
    expect(threeWay).not.toContain('Double count-out');
    expect(threeWay).toContain('Clean finish');
    // A booked finish the match type doesn't allow is refused with a readable reason, not a crash.
    const refused = lab.engine.query(
      'match.simulate',
      lab.args('Three-Way', [[lab.person(0)], [lab.person(1)], [lab.person(2)]], {
        finishKey: lab.finishKey('Singles', 'Disqualification'),
      }),
      VIEWER,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      for (const reason of refused.reasons) expectReadable('Refusal', reason.message);
    }
  });

  it('decides an Auto winner and finish with the deciding rule and each side’s score', () => {
    const result = lab.simulate(lab.args('Singles', singles));
    expect(result.outcome.kind).toBe('win');
    expect(outcomeHeadline(result)).toMatch(/^Side [12] wins: /);
    expect(result.winnerNames).toHaveLength(1);
    expect(result.method).not.toBeNull();
    expect(result.randomWinnersMode).toBe(false);
    expectReadableResult(result);

    const winner = traceToText(result.resultTrace);
    expect(winner).toMatch(/Highest score wins|Tie broken by lowest person id/);
    expect(winner).toContain('Winner decided automatically');
    expect(winner).toMatch(/Side 1 score: [\d.]+/);
    expect(winner).toMatch(/Side 2 score: [\d.]+/);
    const region = lab.options.regions.find(
      (option) => option.id === lab.options.defaults.regionId,
    );
    expect(winner).toContain(`Popularity in ${region?.name ?? 'no region'}`);
    expect(winner).toContain(`Mean popularity in ${region?.name ?? 'no region'}`);
    expect(winner).toMatch(/\((main event|upper card|mid card|lower card|enhancement)\)/);
    expect(winner).toContain('Unpredictability, Side 1');
    expect(winner).toContain('match.autoWinner.randomness');
    // MTCH2-09: how the match would go, each factor its own line with its setting.
    for (const line of ['Ring skill', 'Stamina', 'Fatigue', 'Body wear', 'Storyline heat']) {
      expect(winner).toContain(line);
    }
    for (const key of ['skillWeight', 'staminaWeight', 'fatigueWeight', 'conditionWeight']) {
      expect(winner).toContain(`match.autoWinner.${key}`);
    }
    expect(winner).toContain('match.autoWinner.heatWeight');
    expect(winner).toContain('Not the crowd favourite in a storyline here (counts as 0)');
    expect(winner).toContain('Finish decided on the night');
  });

  it('usually ends an Auto match with a clean finish', () => {
    const counts = new Map<string, number>();
    for (let seed = 1; seed <= FINISH_SAMPLE; seed += 1) {
      const { finish } = lab.simulate(lab.args('Singles', singles, { previewSeed: seed }));
      counts.set(finish.name, (counts.get(finish.name) ?? 0) + 1);
    }
    const [mostCommon] = [...counts.entries()].sort((first, second) => second[1] - first[1]);
    expect(mostCommon?.[0]).toBe('Clean finish');
  });

  it('takes the finish’s effects off work rate and crowd for a booked Disqualification', () => {
    const result = lab.simulate(
      lab.args('Singles', singles, {
        winner: { side: 1 },
        finishKey: lab.finishKey('Singles', 'Disqualification'),
      }),
    );
    expect(result.outcome).toMatchObject({ kind: 'win', winningSide: 1 });
    expect(result.method?.name).toBe('Disqualification');
    expect(result.finish.allowsTitleChange).toBe(false);
    expect(methodLineText(result)).toBe('Disqualification finish');
    expectReadableResult(result);
    expect(traceToText(result.preview.workRate?.trace ?? result.resultTrace)).toContain(
      '−4 Disqualification finish',
    );
    expect(traceToText(result.preview.crowd.trace)).toContain('−3 Disqualification finish');
    const winner = traceToText(result.resultTrace);
    expect(winner).toContain('Booked winner');
    expect(winner).toContain('Booked finish');
    // The finish and its only method are named once.
    expect(winner).not.toContain('Disqualification, Disqualification');
  });

  it('ends a Draw with no winner and the crowd’s draw penalty', () => {
    const result = lab.simulate(lab.args('Singles', singles, { winner: 'draw' }));
    expect(result.outcome.kind).toBe('draw');
    expect(outcomeHeadline(result)).toBe('Draw');
    expect(result.winnerNames).toEqual([]);
    expect(result.method).toBeNull();
    expect(['Double count-out', 'Stalemate']).toContain(result.finish.name);
    expectReadableResult(result);
    const crowd = traceToText(result.preview.crowd.trace);
    expect(crowd).toContain('Draw: the crowd wanted a winner');
    expect(crowd).toContain('match.finish.drawCrowdPenalty');
  });

  it('keeps a booked Side 2 winning on every seed, the finish free to change', () => {
    const finishes = new Set<string>();
    for (let seed = 1; seed <= 4; seed += 1) {
      const result = lab.simulate(
        lab.args('Singles', singles, { winner: { side: 1 }, previewSeed: seed }),
      );
      expect(result.winningSide).toBe(1);
      expect(outcomeHeadline(result)).toBe(`Side 2 wins: ${lab.person(1).name}`);
      finishes.add(result.finish.name);
      expectReadableResult(result);
    }
    expect(finishes.size).toBeGreaterThan(0);
  });

  it('gives the same night for the same seed', () => {
    const setup = lab.args('Singles', singles);
    expect(lab.simulate(setup)).toEqual(lab.simulate(setup));
  });

  it('names both partners of a winning tag team and rates the tag match', () => {
    const result = lab.simulate(
      lab.args('Tag Team', [
        [lab.person(0), lab.person(1)],
        [lab.person(2), lab.person(3)],
      ]),
    );
    if (result.outcome.kind === 'win') {
      expect(result.winnerNames).toHaveLength(2);
      expect(outcomeHeadline(result)).toMatch(/^Side [12] wins: .+ & .+$/);
    }
    expectReadableResult(result);
  });

  it(
    'reads every Why? of every finish a singles can be booked with',
    () => {
      for (const finish of lab.finishes('Singles', 2, 'auto')) {
        for (const winner of ['auto', { side: 0 }, 'draw'] as const) {
          const allowed = lab
            .finishes('Singles', 2, winner)
            .some((option) => option.key === finish.key);
          if (!allowed) continue;
          expectReadableResult(
            lab.simulate(lab.args('Singles', singles, { winner, finishKey: finish.key })),
          );
        }
      }
    },
    AUDIT_TIMEOUT_MS,
  );
});

describe('Run with Runs at 50 on a new default-world game', () => {
  /** Runs on the lab's slider. */
  const RUNS = 50;

  it('counts who won, the draws and the finishes so each adds up to 50', () => {
    const batch = lab.simulateBatch(lab.args('Singles', singles), RUNS);
    expect(batch.runs).toBe(RUNS);
    expect(batch.sides.map((side) => side.names)).toEqual([
      [lab.person(0).name],
      [lab.person(1).name],
    ]);
    const outcomes = batch.sides.reduce((total, side) => total + side.wins, 0);
    expect(outcomes + batch.draws + batch.noContests).toBe(RUNS);
    expect(batch.finishes.reduce((total, finish) => total + finish.count, 0)).toBe(RUNS);
    expect(batch.histogram.reduce((total, bin) => total + bin.count, 0)).toBe(RUNS);
    // The clean finish is the usual one, and comes first.
    expect(batch.finishes[0]?.name).toBe('Clean finish');
    for (const finish of batch.finishes) expectReadable('Finish count', finish.name);
  });

  it('shows a last night that is one of the nights counted', () => {
    const setup = lab.args('Singles', singles, { winner: { side: 1 } });
    const batch = lab.simulateBatch(setup, RUNS);
    const last = lab.simulate({ ...setup, previewSeed: setup.previewSeed + RUNS - 1 });
    expect(batch.sides.map((side) => side.wins)).toEqual([0, RUNS]);
    expect(last.winningSide).toBe(1);
    expect(batch.finishes.map((finish) => finish.key)).toContain(last.finish.key);
    expect(last.preview.score.value).toBeGreaterThanOrEqual(batch.score.min);
    expect(last.preview.score.value).toBeLessThanOrEqual(batch.score.max);
  });

  it('draws every night of a booked Draw', () => {
    const batch = lab.simulateBatch(lab.args('Singles', singles, { winner: 'draw' }), RUNS);
    expect(batch.draws).toBe(RUNS);
    expect(batch.finishes.every((finish) => finish.category === 'draw')).toBe(true);
  });
});

describe('Simulate in a new game started with Random winners', () => {
  const random = labOn({ randomWinners: true });
  /** Two of Altura's wrestlers with the same push, next to each other in popularity. */
  const closePair = (() => {
    const list = ask(random.engine.query('workers.list', {}, VIEWER), 'workers.list');
    const pushOf = new Map(list.rows.map((row) => [row.personId, row.push]));
    for (let index = 0; index + 1 < random.roster.length; index += 1) {
      const first = random.person(index);
      const second = random.person(index + 1);
      if (pushOf.get(first.personId) === pushOf.get(second.personId)) return [[first], [second]];
    }
    throw new Error('No two wrestlers on the roster share a push.');
  })();

  it('says the Auto winner is decided by Random winners', () => {
    expect(ask(random.engine.query('match.resultMode', {}, VIEWER), 'resultMode')).toEqual({
      randomWinners: true,
    });
    const result = random.simulate(random.args('Singles', closePair));
    expect(result.randomWinnersMode).toBe(true);
    expect(result.resultTrace.children?.[0]?.label).toMatch(/^Random winners mode/);
    const winner = traceToText(result.resultTrace);
    // Random winners is a true coin flip (MTCH2-08): an equal chance, no scores.
    expect(winner).toContain('Random: every side had an equal chance');
    expectReadableResult(result);
  });

  it('changes the winner of a close pair within a few re-rolls', () => {
    const winners = new Set<number | null>();
    for (let seed = 1; seed <= RANDOM_WINNERS_REROLLS && winners.size < 2; seed += 1) {
      winners.add(
        random.simulate(random.args('Singles', closePair, { previewSeed: seed })).winningSide,
      );
    }
    expect(winners.size).toBe(2);
  });

  it('still honours a booked side', () => {
    const result = random.simulate(random.args('Singles', closePair, { winner: { side: 0 } }));
    expect(result.winningSide).toBe(0);
    expect(result.randomWinnersMode).toBe(false);
    expectReadableResult(result);
  });
});

describe('the Aftermath panel on a new default-world game (MTCH3-04)', () => {
  it('reads every Why? the panel offers in the player’s words, with the spill line', () => {
    const result = lab.simulate(lab.args('Singles', singles));
    const { aftermath } = result;
    expect(aftermath.workers).toHaveLength(2);
    let neighbours = 0;
    for (const worker of aftermath.workers) {
      for (const row of worker.popularity.regions) {
        const text = traceToText(regionWhyTrace(row));
        expectReadable(`Popularity in ${row.name}`, text);
        if (row.source === 'neighbour') {
          neighbours += 1;
          expect(text).toContain(`Neighbour of ${aftermath.showRegionName}`);
        }
      }
      for (const row of [...worker.popularity.countries, ...worker.popularity.continents]) {
        expectReadable(`Popularity in ${row.name}`, traceToText(row.trace));
      }
      if ('trace' in worker.momentum) {
        expectReadable(`${worker.name}'s momentum`, traceToText(worker.momentum.trace));
      }
    }
    expect(neighbours).toBeGreaterThan(0);
  });
});
