/**
 * Hand-made `match.simulate` answers for the gallery and the component tests: a win, a draw, a no
 * contest and a Random winners night, with small traces so every Why? opens. The real ones come
 * from the engine; these only need the shape.
 */
import type { ContentKey, FinishOption, SimulateResult, Traced, TraceNode } from '@ringside/engine';
import { parseContentKey } from '@ringside/engine';

/** A plain input line, so a Why? has something to show. */
function input(label: string, value: number): Traced<number> {
  return { value, trace: { kind: 'input', label, value } };
}

function key(value: string): ContentKey {
  return parseContentKey(value);
}

/** A two-line decision, as the engine's "Match result" is drawn. */
function resultTrace(chosen: string, reason: string, firstLabel: string): TraceNode {
  return {
    kind: 'decision',
    label: 'Match result',
    value: chosen,
    chosen,
    reason,
    considered: [],
    children: [
      {
        kind: 'decision',
        label: firstLabel,
        value: chosen,
        chosen,
        reason: 'Highest score',
        considered: [
          { option: 'Side 1', score: 61.5 },
          { option: 'Side 2', score: 58 },
        ],
      },
    ],
  };
}

/** The rated night every fixture shares. */
function preview(): SimulateResult['preview'] {
  return {
    kind: 'match',
    score: input('Score', 68),
    stars: input('Stars', 3.5),
    workRate: input('Work rate', 71),
    talk: null,
    crowd: input('Crowd', 64),
    expectation: input('Crowd expectation', 60),
    starPower: input('Star power', 55),
    slot: {
      role: 'mainEvent',
      durationClass: 'long',
      weight: 1.5,
      roleTrace: {
        value: 'mainEvent',
        trace: { kind: 'input', label: 'Slot role', value: 'mainEvent' },
      },
      durationTrace: {
        value: 'long',
        trace: { kind: 'input', label: 'Duration class', value: 'long' },
      },
      weightTrace: input('Slot weight', 1.5),
    },
    workers: [],
    warnings: [],
    policy: { label: 'Full rules', simpleInputs: false, skipInMatchInjuries: false },
    previewSeed: 7,
  };
}

/** Side 1 wins by pinfall after a clean finish. */
export function winSimulation(names: readonly string[] = ['Rex Harlan']): SimulateResult {
  return {
    preview: preview(),
    outcome: { kind: 'win', winningSide: 0, methodKey: key('method.pinfall') },
    finish: {
      key: key('finish.clean'),
      name: 'Clean finish',
      category: 'clean',
      summary: 'A decisive, clean win.',
      allowsTitleChange: true,
    },
    method: { key: key('method.pinfall'), name: 'Pinfall' },
    winningSide: 0,
    winnerNames: [...names],
    resultTrace: resultTrace('Side 1 wins', 'Clean, Pinfall', 'Winner decided automatically'),
    randomWinnersMode: false,
  };
}

/** Side 2 wins by disqualification: titles stay put. */
export function disqualificationSimulation(): SimulateResult {
  return {
    ...winSimulation(['Mara Quell']),
    outcome: { kind: 'win', winningSide: 1, methodKey: key('method.disqualification') },
    finish: {
      key: key('finish.disqualification'),
      name: 'Disqualification',
      category: 'disqualification',
      summary: 'The loser is disqualified.',
      allowsTitleChange: false,
    },
    method: { key: key('method.disqualification'), name: 'Disqualification' },
    winningSide: 1,
    resultTrace: resultTrace('Side 2 wins', 'Disqualification', 'Who won'),
  };
}

/** A draw: nobody wins and the crowd wanted a winner. */
export function drawSimulation(): SimulateResult {
  return {
    ...winSimulation(),
    outcome: { kind: 'draw' },
    finish: {
      key: key('finish.stalemate'),
      name: 'Stalemate',
      category: 'draw',
      summary: 'Neither side can put the other away.',
      allowsTitleChange: false,
    },
    method: null,
    winningSide: null,
    winnerNames: [],
    resultTrace: resultTrace('Draw', 'Stalemate', 'Who won'),
  };
}

/** A no contest. */
export function noContestSimulation(): SimulateResult {
  return {
    ...drawSimulation(),
    outcome: { kind: 'noContest' },
    finish: {
      key: key('finish.no-contest'),
      name: 'No contest',
      category: 'noContest',
      summary: 'The match breaks down and nobody wins.',
      allowsTitleChange: false,
    },
    resultTrace: resultTrace('No contest', 'No contest', 'Who won'),
  };
}

/** Random winners decided the night. */
export function randomWinnersSimulation(): SimulateResult {
  return {
    ...winSimulation(['Dax Morrow']),
    randomWinnersMode: true,
    resultTrace: resultTrace(
      'Side 1 wins',
      'Clean, Pinfall',
      'Random winners mode, winner decided on the night',
    ),
  };
}

/** A finish row as `match.finishes` lists it. */
function finish(
  name: string,
  finishKey: string,
  outcomeKind: FinishOption['outcomeKind'],
  category: FinishOption['category'],
  allowsTitleChange: boolean,
  summary: string,
): FinishOption {
  return {
    key: key(finishKey),
    name,
    summary,
    category,
    outcomeKind,
    allowsTitleChange,
    effects: { workRate: 0, crowd: 0 },
    methods: [],
    autoPickable: true,
  };
}

/** Every finish a singles match may end with. */
export const SINGLES_FINISHES: readonly FinishOption[] = [
  finish('Clean finish', 'finish.clean', 'win', 'clean', true, 'A decisive, clean win.'),
  finish(
    'Cheating finish',
    'finish.cheating',
    'win',
    'cheating',
    true,
    'A win stolen by a shortcut.',
  ),
  finish('Count-out', 'finish.count-out', 'win', 'countOut', false, 'Outside past the count.'),
  finish(
    'Disqualification',
    'finish.disqualification',
    'win',
    'disqualification',
    false,
    'The loser is disqualified.',
  ),
  finish('Double count-out', 'finish.double-count-out', 'draw', 'draw', false, 'Both counted out.'),
  finish('Stalemate', 'finish.stalemate', 'draw', 'draw', false, 'Neither side wins.'),
];

/** The draw finishes only, as the list narrows to after Draw. */
export const DRAW_FINISHES: readonly FinishOption[] = SINGLES_FINISHES.filter(
  (option) => option.outcomeKind === 'draw',
);
