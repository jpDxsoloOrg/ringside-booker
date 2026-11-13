/**
 * Hand-written AIP5 result views for the gallery (AIP5-05): a win with its method and reason, a
 * draw, a title retained, a new champion, a match whose full reasons are no longer kept and one
 * with long names. The traces copy the shape the rival booker stores (`aip.winner`, `aip.title`);
 * the people, titles and numbers are made up. No engine runs. Options read as words, as the booker
 * stores them since AIP5-06 (side names, finish and method names).
 */
import { parseId } from '@ringside/engine';
import type {
  AipTitleChange,
  SegmentDecisionTitle,
  SegmentDecisionView,
  TraceNode,
  TraceRef,
} from '@ringside/engine';
import { parseGameDate } from '@ringside/engine';
import type { RivalResultSide } from '@/screens/promotions/profile/shows/RivalResultLine';

const DOC = 'rival-booking.md#how-a-rival-shows-results-are-decided';
const SHOW = parseId('eventInstance', 'evi_0000000001');

/** The winner call's Why?, as the booker stores it for a two-sided match. */
export const galleryWinnerTrace: TraceNode = {
  kind: 'decision',
  label: 'Booked result: Kai Moreno vs Rex Hale',
  value: 'Kai Moreno',
  chosen: 'Kai Moreno',
  reason: 'Higher value',
  considered: [],
  docRef: DOC,
  children: [
    {
      kind: 'decision',
      label: 'Who wins',
      value: 'Kai Moreno',
      chosen: 'Kai Moreno',
      reason: 'Higher value on the night',
      considered: [
        { option: 'Kai Moreno', score: 64.2 },
        { option: 'Rex Hale', score: 51.8 },
      ],
      children: [
        { kind: 'input', label: 'Card value, Kai Moreno', value: 62, unit: 'points' },
        { kind: 'input', label: 'Card value, Rex Hale', value: 53, unit: 'points' },
        { kind: 'note', label: 'Draws are off (0)', value: null },
        { kind: 'note', label: 'No storyline on this match', value: null },
        { kind: 'note', label: 'Squash: card positions 1 apart, needs 3', value: null },
      ],
    },
    {
      kind: 'decision',
      label: 'How the match ends',
      value: 'Clean finish',
      chosen: 'Clean finish',
      reason: 'Picked by weighted roll',
      considered: [
        { option: 'Clean finish', score: 60 },
        { option: 'Flash finish', score: 10 },
        { option: 'Cheating finish', score: 12 },
        { option: 'Count-out', score: 4 },
        { option: 'Disqualification', score: 4 },
      ],
      docRef: 'match-finishes.md#finish-on-the-night',
    },
    {
      kind: 'decision',
      label: 'How the match is won',
      value: 'Pinfall',
      chosen: 'Pinfall',
      reason: 'Picked by weighted roll',
      considered: [
        { option: 'Pinfall', score: 6 },
        { option: 'Submission', score: 3 },
        { option: 'Knockout', score: 1 },
      ],
      docRef: 'match-finishes.md#method',
    },
  ],
};

/** A title call's Why?: the challengers, the contract rule, the change chance and the roll. */
export const galleryTitleTrace: TraceNode = {
  kind: 'decision',
  label: 'Title decision: Coastal Heavyweight Title',
  value: 'retain',
  chosen: 'retain',
  reason: 'Champion retains',
  considered: [
    { option: 'retain', score: 71, reason: 'Big Joe Sato keeps it' },
    { option: 'Dante Rivers', score: 66 },
  ],
  docRef: DOC,
  children: [
    { kind: 'note', label: 'Challengers: Dante Rivers is a strong challenger', value: null },
    { kind: 'input', label: 'Reign so far', value: 34, unit: 'days' },
    { kind: 'input', label: 'Reign band chance', value: 12, unit: 'percent' },
    { kind: 'input', label: 'Prestige 70 vs pivot 60', value: -0.5, unit: 'percent' },
    { kind: 'input', label: 'Major show', value: 4, unit: 'percent' },
    { kind: 'input', label: 'Change chance', value: 15.5, unit: 'percent' },
    { kind: 'note', label: 'Rolled 41 against 15.5: the champion keeps it', value: null },
  ],
};

/** Winner refs open the winner breakdown, title refs the title one. */
export const galleryResultTraceOf = (ref: TraceRef): TraceNode =>
  ref.kind === 'aip.title' ? galleryTitleTrace : galleryWinnerTrace;

let personCount = 900;

function people(...names: readonly string[]): RivalResultSide['people'] {
  return names.map((name) => {
    personCount += 1;
    return { personId: parseId('person', `per_${String(personCount).padStart(10, '0')}`), name };
  });
}

/** A one-wrestler side. */
export function gallerySide(name: string): RivalResultSide {
  return { name, people: people(name) };
}

/** A team side, named for the team. */
export function galleryTeam(name: string, ...members: readonly string[]): RivalResultSide {
  return { name, people: people(...members) };
}

let segmentCount = 900;

function view(
  winners: RivalResultSide | null,
  overrides: Partial<Omit<SegmentDecisionView, 'winner'>> & {
    readonly winner?: Partial<SegmentDecisionView['winner']>;
  } = {},
): SegmentDecisionView {
  segmentCount += 1;
  const segmentId = parseId('segment', `seg_${String(segmentCount).padStart(10, '0')}`);
  const { winner, ...rest } = overrides;
  return {
    segmentId,
    eventInstanceId: SHOW,
    reasonText: 'Higher value',
    winnerTraceRef: { kind: 'aip.winner', id: segmentId },
    titles: [],
    ...rest,
    winner: {
      kind: 'win',
      sideLabel: winners?.name ?? null,
      personIds: winners?.people.map((person) => person.personId) ?? [],
      methodName: 'Pinfall',
      finishName: 'Clean finish',
      ...winner,
    },
  };
}

function title(
  segmentId: SegmentDecisionView['segmentId'],
  overrides: Partial<SegmentDecisionTitle>,
): SegmentDecisionTitle {
  const titleId = parseId('title', 'tit_0000000001');
  return {
    titleId,
    titleName: 'Coastal Heavyweight Title',
    plan: 'retain',
    reasonText: 'Champion retains',
    chance: 15.5,
    reignDays: 34,
    traceRef: { kind: 'aip.title', id: `${segmentId}|${titleId}` },
    actual: 'retained',
    ...overrides,
  };
}

/** One gallery example: the view, the match's sides and its matchup. */
export interface GalleryResult {
  readonly view: SegmentDecisionView;
  readonly sides: readonly RivalResultSide[];
  readonly matchLabel: string;
}

function example(
  sides: readonly RivalResultSide[],
  winnerIndex: number | null,
  build: (winners: RivalResultSide | null) => SegmentDecisionView,
): GalleryResult {
  const winners = winnerIndex === null ? null : (sides[winnerIndex] ?? null);
  return {
    view: build(winners),
    sides,
    matchLabel: sides.map((side) => side.name).join(' vs '),
  };
}

/** Kai Moreno def. Rex Hale · Pinfall · Clean finish · Higher value. */
export const galleryWinResult = example(
  [gallerySide('Kai Moreno'), gallerySide('Rex Hale')],
  0,
  (winners) => view(winners),
);

/** A draw: no winner, the line says Draw. */
export const galleryDrawResult = example(
  [gallerySide('Ana Lucero'), gallerySide('Pip Garrow')],
  null,
  (winners) =>
    view(winners, {
      reasonText: 'Draw',
      winner: { kind: 'draw', methodName: null, finishName: null },
    }),
);

/** The champion kept the title. */
export const galleryRetainedResult = example(
  [gallerySide('Big Joe Sato'), gallerySide('Dante Rivers')],
  0,
  (winners) => {
    const base = view(winners, { reasonText: 'Champion retains' });
    return { ...base, titles: [title(base.segmentId, {})] };
  },
);

/** The champion's contract was ending, so the title moved. */
export const galleryNewChampionResult = example(
  [gallerySide('Big Joe Sato'), gallerySide('Dante Rivers')],
  1,
  (winners) => {
    const base = view(winners, {
      reasonText: 'Contract ending',
      winner: { methodName: 'Submission', finishName: 'Clean finish' },
    });
    return {
      ...base,
      titles: [
        title(base.segmentId, {
          plan: 'change',
          reasonText: 'Contract ending',
          chance: 0,
          reignDays: 212,
          actual: 'newChampion',
        }),
      ],
    };
  },
);

/** An older show: the full reasons are gone, so there is no Why?, only the plain text. */
export const gallerySummarisedResult = example(
  [gallerySide('Jet Lacroix'), gallerySide('Hugo Brandt')],
  1,
  (winners) =>
    view(winners, {
      reasonText: "The booker's full reasons are no longer kept",
      winnerTraceRef: null,
      winner: { methodName: 'Count-Out', finishName: null },
    }),
);

/** Long team and wrestler names, to check the wrapping at 390px. */
export const galleryLongNamesResult = example(
  [
    galleryTeam(
      'The Magnificent Brotherhood of the Eternal Steel Cage',
      'Bastian Thornberry-Klein',
      'Marisol Ortega-Whitfield',
    ),
    galleryTeam('Running Axe Tactical Squadron', 'Vance Troy', 'Ollie Banks'),
    gallerySide('Maximilian Featherstonehaugh-Abernathy'),
  ],
  0,
  (winners) =>
    view(winners, {
      reasonText: 'Storyline finale',
      winner: { methodName: 'Disqualification', finishName: 'Interference finish' },
    }),
);

/** Three recent title changes for the Overview panel, newest first. */
export const galleryTitleChanges: AipTitleChange[] = [
  {
    titleId: parseId('title', 'tit_0000000001'),
    titleName: 'Coastal Heavyweight Title',
    newHolderNames: ['Dante Rivers'],
    previousHolderNames: ['Big Joe Sato'],
    wonOn: parseGameDate('2026-03-07'),
    eventInstanceId: SHOW,
    showName: 'Coastal Saturday Night',
    previousReignDays: 212,
    reasonText: 'Contract ending',
    traceRef: { kind: 'aip.title', id: 'seg_0000000901|tit_0000000001' },
  },
  {
    titleId: parseId('title', 'tit_0000000002'),
    titleName: 'Coastal Tag Team Titles',
    newHolderNames: ['Vance Troy', 'Ollie Banks'],
    previousHolderNames: ['Dee Carter', 'Mo Price'],
    wonOn: parseGameDate('2026-02-21'),
    eventInstanceId: parseId('eventInstance', 'evi_0000000002'),
    showName: 'Coastal Live',
    previousReignDays: 63,
    reasonText: 'Time for a change',
    traceRef: null,
  },
  {
    titleId: parseId('title', 'tit_0000000003'),
    titleName: 'Coastal Television Title',
    newHolderNames: ['Sunny Okafor'],
    previousHolderNames: [],
    wonOn: parseGameDate('2026-01-31'),
    eventInstanceId: parseId('eventInstance', 'evi_0000000003'),
    showName: 'Coastal Live: Harbour Town',
    previousReignDays: null,
    reasonText: null,
    traceRef: null,
  },
];
