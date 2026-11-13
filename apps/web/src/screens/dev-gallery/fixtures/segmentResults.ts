/**
 * Hand-made `shows.results` segments for the SegmentResultCard gallery entry and tests. Every name
 * is invented. The trace refs point at small stand-in traces the gallery's fake engine answers.
 */
import { parseGameDate, parseId } from '@ringside/engine';
import type {
  SegmentReasonView,
  SegmentMemberView,
  SegmentResultView,
  SegmentSideView,
  StoredTrace,
  TraceNode,
  TraceRef,
} from '@ringside/engine';
import { matchRatingTrace } from './traces';

let nextPerson = 300;

/** A competitor with a made-up id. */
function competitor(name: string): SegmentMemberView {
  nextPerson += 1;
  return {
    personId: parseId('person', `per_00000${String(nextPerson).padStart(5, '0')}`),
    name,
    imageRef: null,
    role: 'competitor',
  };
}

function side(index: number, members: readonly SegmentMemberView[], label?: string) {
  const view: SegmentSideView = {
    side: index,
    label: label ?? members.map((member) => member.name).join(' & '),
    members: [...members],
  };
  return view;
}

const SEGMENT_IDS = {
  singles: parseId('segment', 'seg_0000000301'),
  tag: parseId('segment', 'seg_0000000302'),
  tripleThreat: parseId('segment', 'seg_0000000303'),
  draw: parseId('segment', 'seg_0000000304'),
  noContest: parseId('segment', 'seg_0000000305'),
  promo: parseId('segment', 'seg_0000000306'),
  longNames: parseId('segment', 'seg_0000000307'),
} as const;

const TITLE_IDS = {
  tag: parseId('title', 'tit_0000000301'),
  world: parseId('title', 'tit_0000000302'),
} as const;

/** Where a segment's score trace is kept, like `shows.segmentScore`. */
export function segmentScoreRef(segmentId: string): TraceRef {
  return { kind: 'shows.segmentScore', id: segmentId };
}

/** Where a match's result trace is kept, like `match.result`. */
export function matchResultRef(segmentId: string): TraceRef {
  return { kind: 'match.result', id: segmentId };
}

/** Where a title outcome's trace is kept, like `shows.titleOutcome`. */
export function titleOutcomeRef(segmentId: string, titleId: string): TraceRef {
  return { kind: 'shows.titleOutcome', id: `${segmentId}|${titleId}` };
}

function rating(score: number, stars: number, segmentId: string, workRate: number | null = 70) {
  return {
    score,
    stars,
    workRate,
    crowd: Math.min(100, score + 4),
    expectation: Math.max(0, score - 6),
    traceRef: segmentScoreRef(segmentId),
    reasons: reasonsFor(score, workRate),
  };
}

/** Made-up top reasons that read like the engine's: the work rate (or talk) and the crowd. */
function reasonsFor(score: number, workRate: number | null): SegmentReasonView[] {
  const pull = score - 50;
  const performance = {
    label:
      workRate === null
        ? pull >= 0
          ? 'Strong talking'
          : 'Weak talking'
        : pull >= 0
          ? 'Strong work rate'
          : 'Weak work rate',
    effect: Math.round(pull * 0.55),
  };
  const crowd = {
    label: pull >= 0 ? 'Hot crowd' : 'Quiet crowd',
    effect: Math.round(pull * 0.4),
  };
  return [performance, crowd].filter((reason) => reason.effect !== 0);
}

const BASE: Pick<SegmentResultView, 'preShow' | 'label' | 'titles' | 'storylines'> = {
  preShow: false,
  label: null,
  titles: [],
  storylines: [],
};

/** Opener: a clean singles win by pinfall. */
export function singlesWin(): SegmentResultView {
  return {
    ...BASE,
    segmentId: SEGMENT_IDS.singles,
    slot: 0,
    slotNumber: 1,
    roleKey: 'opener',
    roleLabel: 'Opener',
    durationClass: 'short',
    durationLabel: 'Short',
    kind: 'match',
    typeKey: 'match.singles',
    typeName: 'Singles',
    sides: [side(0, [competitor('Vance Troy')]), side(1, [competitor('Kai Moreno')])],
    outcome: {
      kind: 'win',
      winningSide: 1,
      methodName: 'Pinfall',
      finishName: 'Clean',
      resultTraceRef: matchResultRef(SEGMENT_IDS.singles),
    },
    rating: rating(64, 2.5, SEGMENT_IDS.singles),
    storylines: [{ id: parseId('storyline', 'sty_0000000301'), name: 'Harbour grudge' }],
  };
}

/** A tag title match the challengers win. */
export function tagNewChampions(): SegmentResultView {
  return {
    ...BASE,
    segmentId: SEGMENT_IDS.tag,
    slot: 2,
    slotNumber: 3,
    roleKey: 'midcard',
    roleLabel: 'Midcard',
    durationClass: 'standard',
    durationLabel: 'Standard',
    kind: 'match',
    typeKey: 'match.tag-team',
    typeName: 'Tag Team',
    sides: [
      side(0, [competitor('Otto Krell'), competitor('Bastian Volk')], 'The Iron Ferry'),
      side(1, [competitor('Rook Halloway'), competitor('Dax Ember')], 'Night Shift'),
    ],
    outcome: {
      kind: 'win',
      winningSide: 1,
      methodName: 'Submission',
      resultTraceRef: matchResultRef(SEGMENT_IDS.tag),
    },
    rating: rating(71, 3.25, SEGMENT_IDS.tag),
    titles: [
      {
        titleId: TITLE_IDS.tag,
        name: 'Coastline Tag Titles',
        imageRef: null,
        outcome: 'newChampion',
        newHolderNames: ['Rook Halloway', 'Dax Ember'],
        outcomeTraceRef: titleOutcomeRef(SEGMENT_IDS.tag, TITLE_IDS.tag),
      },
    ],
  };
}

/** The main event: a triple threat for the world title, retained. */
export function tripleThreatRetained(): SegmentResultView {
  return {
    ...BASE,
    segmentId: SEGMENT_IDS.tripleThreat,
    slot: 4,
    slotNumber: 5,
    roleKey: 'mainEvent',
    roleLabel: 'Main event',
    durationClass: 'long',
    durationLabel: 'Long',
    kind: 'match',
    typeKey: 'match.triple-threat',
    typeName: 'Triple Threat',
    label: 'Winner takes the crown',
    sides: [
      side(0, [competitor('Marlo Quint')]),
      side(1, [competitor('Sable Aranda')]),
      side(2, [competitor('Jonah Pike')]),
    ],
    outcome: {
      kind: 'win',
      winningSide: 0,
      methodName: 'Pinfall',
      resultTraceRef: matchResultRef(SEGMENT_IDS.tripleThreat),
    },
    rating: rating(84, 4.25, SEGMENT_IDS.tripleThreat),
    titles: [
      {
        titleId: TITLE_IDS.world,
        name: 'Coastal Crown',
        imageRef: null,
        outcome: 'retained',
        newHolderNames: [],
        outcomeTraceRef: titleOutcomeRef(SEGMENT_IDS.tripleThreat, TITLE_IDS.world),
      },
    ],
  };
}

/** A singles match that ends in a draw. */
export function drawResult(): SegmentResultView {
  return {
    ...singlesWin(),
    segmentId: SEGMENT_IDS.draw,
    slot: 1,
    slotNumber: 2,
    roleKey: 'midcard',
    roleLabel: 'Midcard',
    durationClass: 'standard',
    durationLabel: 'Standard',
    sides: [side(0, [competitor('Ivy Calder')]), side(1, [competitor('Petra Lune')])],
    outcome: {
      kind: 'draw',
      finishName: 'Time-limit draw',
      resultTraceRef: matchResultRef(SEGMENT_IDS.draw),
    },
    rating: rating(58, 2, SEGMENT_IDS.draw),
    storylines: [],
  };
}

/** A singles match that ends in a no contest, with no trace kept. */
export function noContestResult(): SegmentResultView {
  return {
    ...singlesWin(),
    segmentId: SEGMENT_IDS.noContest,
    slot: 3,
    slotNumber: 4,
    roleKey: 'semiMain',
    roleLabel: 'Semi-main',
    durationClass: 'standard',
    durationLabel: 'Standard',
    sides: [side(0, [competitor('Brick Callahan')]), side(1, [competitor('Silas Thorn')])],
    outcome: { kind: 'noContest', resultTraceRef: null },
    rating: { ...rating(41, 1, SEGMENT_IDS.noContest), traceRef: null },
    storylines: [],
  };
}

/** A pre-show promo: one side, no winner, no work rate. */
export function promoSegment(): SegmentResultView {
  return {
    ...BASE,
    segmentId: SEGMENT_IDS.promo,
    slot: 0,
    preShow: true,
    slotNumber: 1,
    roleKey: 'preShow',
    roleLabel: 'Pre-show',
    durationClass: 'short',
    durationLabel: 'Short',
    kind: 'angle',
    typeKey: 'angle.promo',
    typeName: 'Promo',
    sides: [side(0, [competitor('Marlo Quint')])],
    outcome: null,
    rating: rating(62, 2.5, SEGMENT_IDS.promo, null),
    storylines: [{ id: parseId('storyline', 'sty_0000000302'), name: 'Crown chase' }],
  };
}

/** A tag match between teams with very long ring names. */
export function longNamesResult(): SegmentResultView {
  return {
    ...tagNewChampions(),
    segmentId: SEGMENT_IDS.longNames,
    sides: [
      side(0, [
        competitor('Bartholomew "The Lighthouse" Vandermeer-Ashcombe'),
        competitor('Seraphina Okonkwo-Lindqvist'),
      ]),
      side(1, [
        competitor('Maximilian Thornbury the Third'),
        competitor('Anastasia Villanueva-Blackwood'),
      ]),
    ],
    titles: [],
    storylines: [
      { id: parseId('storyline', 'sty_0000000303'), name: 'The very long road to redemption' },
    ],
  };
}

const titleDecision: TraceNode = {
  kind: 'decision',
  label: 'Title outcome: Coastline Tag Titles',
  value: 'changed',
  chosen: 'changed',
  reason: 'Challengers won by Submission',
  considered: [],
  children: [
    {
      kind: 'branch',
      label: 'Submission can change titles',
      value: true,
      condition: 'Submission can change titles',
      taken: true,
    },
  ],
};

const resultDecision: TraceNode = {
  kind: 'decision',
  label: 'Match result',
  value: 'Side 2 wins',
  chosen: 'Side 2 wins',
  reason: 'Clean, Pinfall',
  considered: [],
  children: [
    {
      kind: 'decision',
      label: 'Who won',
      value: 'Side 2',
      chosen: 'Side 2',
      reason: 'Booked winner',
      considered: [],
    },
  ],
};

const STORED_DATE = parseGameDate('2031-03-14');

/** Stand-in traces for every ref above, for the gallery's fake engine. */
export function segmentResultTraces(): StoredTrace[] {
  const scoreRefs = [
    SEGMENT_IDS.singles,
    SEGMENT_IDS.tag,
    SEGMENT_IDS.tripleThreat,
    SEGMENT_IDS.draw,
    SEGMENT_IDS.promo,
    SEGMENT_IDS.longNames,
  ].map((id) => segmentScoreRef(id));
  const titleRefs = [
    titleOutcomeRef(SEGMENT_IDS.tag, TITLE_IDS.tag),
    titleOutcomeRef(SEGMENT_IDS.tripleThreat, TITLE_IDS.world),
  ];
  const resultRefs = [
    SEGMENT_IDS.singles,
    SEGMENT_IDS.tag,
    SEGMENT_IDS.tripleThreat,
    SEGMENT_IDS.draw,
  ].map((id) => matchResultRef(id));
  return [
    ...scoreRefs.map((ref, index) => ({
      ref,
      date: STORED_DATE,
      seq: index + 1,
      trace: matchRatingTrace,
      value: 71,
    })),
    ...titleRefs.map((ref, index) => ({
      ref,
      date: STORED_DATE,
      seq: scoreRefs.length + index + 1,
      trace: titleDecision,
      value: 'changed',
    })),
    ...resultRefs.map((ref, index) => ({
      ref,
      date: STORED_DATE,
      seq: scoreRefs.length + titleRefs.length + index + 1,
      trace: resultDecision,
      value: 'win',
    })),
  ];
}
