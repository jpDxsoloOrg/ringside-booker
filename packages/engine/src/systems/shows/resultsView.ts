/**
 * The results views: a finished show as a screen reads it.
 *
 * `showResultsView` builds one show's page (header, score, every segment with its result and the
 * titles it settled); `showSummaryView` builds the compact line the Office panel, the Next Day
 * summary and the "See results" links read. Both are plain JSON. Nothing in them is a length or a
 * time (D-10): a segment carries its duration class word, never minutes.
 *
 * Who may see what is decided here, once:
 *
 * - Results are public: rival cards and winners were on TV.
 * - Money is not: `gate` is only returned for the viewer's own promotions (and to the omniscient
 *   viewer of tools and tests); a rival's is null whatever is stored.
 * - A card is private until it airs: a rival show that has not completed returns no segments.
 *
 * Design notes: docs/design/show-night.md#results-queries.
 */

import { viewerPromotionIds, type Viewer } from '../../core/api/controller';
import { compareDates, type GameDate } from '../../core/date';
import type { Cents } from '../../core/money';
import type {
  BrandId,
  EventInstanceId,
  PersonId,
  PromotionId,
  RegionId,
  SegmentId,
  StorylineId,
  TeamId,
  TitleId,
  VenueId,
} from '../../core/ids';
import { isFullTrace, type TraceRef } from '../../core/trace/store';
import type { TraceNode } from '../../core/trace';
import { angleTypeOf, finishOf, matchTypeOf, methodOf } from '../../model/catalogs';
import type { EventImportance } from '../../model/entities/event-definition';
import type {
  EventInstance,
  EventInstanceStatus,
  ShowHistoryMainEvent,
} from '../../model/entities/event-instance';
import { detailKeptNote } from '../history/note';
import type { Participant, ParticipantRole } from '../../model/entities/participant';
import { settingOf, type Segment, type SegmentKind } from '../../model/entities/segment';
import { settingDurationShifter } from '../match/angles/settings';
import { talkLineOf } from '../match/angles/talkLine';
import type { AngleSetting } from '../../model/entities/angle-setting';
import type { TitleReign } from '../../model/entities/title-reign';
import type { ImageRef } from '../../model/primitives';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { TraceReader } from '../../core/api/query';
import { cardSegments } from '../booking/card';
import { showPeople, type ShowPeople } from '../booking/view';
import { showControllerOf } from '../calendar/control';
import {
  DURATION_CLASS_LABELS,
  durationClassOf,
  SLOT_ROLE_LABELS,
  slotRoleOf,
  type DurationClass,
  type SlotRole,
} from '../match/slots';
import type { EngineTunables } from '../tunables';
import { slotRoleInput } from './context';
import { showStars } from './formulas/showStars';
import {
  segmentReasons,
  showScoreBreakdown,
  type BreakdownSegment,
  type SegmentReasonView,
  type ShowScoreBreakdownView,
} from './report';
import { matchResultTraceRef, titleOutcomeTraceRef, traceRefFromKey } from './traces';

// ---------------------------------------------------------------------------------------------
// View types

/** How a title on the line came out of a segment. */
export type TitleResultOutcome = 'newChampion' | 'retained' | 'stillVacant' | 'none';

export interface SegmentTitleView {
  titleId: TitleId;
  name: string;
  imageRef: ImageRef;
  /**
   * `newChampion` when a reign was won in this segment, `retained` when the title was held going
   * in and stayed put, `stillVacant` when nobody held it and nobody won it, and `none` when the
   * segment has no result yet or ended in a no contest.
   */
  outcome: TitleResultOutcome;
  /** The ring names the new champions won it under; empty unless `outcome` is `newChampion`. */
  newHolderNames: string[];
  /** The title decision's trace, or null when it is not kept. */
  outcomeTraceRef: TraceRef | null;
}

export interface SegmentMemberView {
  personId: PersonId;
  /** The ring name on the show's promotion's contract, else the person's default ring name. */
  name: string;
  imageRef: ImageRef;
  role: ParticipantRole;
}

export interface SegmentSideView {
  /** The stored side, 0-based. */
  side: number;
  /** The team's name when every competitor is listed with the same team, else their names. */
  label: string;
  /** Competitors first, then everyone else on the side, each by id. */
  members: SegmentMemberView[];
}

export interface SegmentOutcomeView {
  kind: 'win' | 'draw' | 'noContest';
  /** The winning side (0-based); only on a win. */
  winningSide?: number;
  /** "Pinfall"; only on a win. */
  methodName?: string;
  /** The finish the match went with, when it had one. */
  finishName?: string;
  /** How the match ended and why (the winner Why?), or null when it is not kept. */
  resultTraceRef: TraceRef | null;
}

export interface SegmentRatingView {
  score: number;
  /** 0 to 5 in quarter steps. */
  stars: number;
  /** Null for a talking segment. */
  workRate: number | null;
  crowd: number | null;
  expectation: number | null;
  /** The segment score's trace, or null when it is not kept. */
  traceRef: TraceRef | null;
  /**
   * The top two things that moved the score, from its trace ("Strong work rate", +8). Empty once
   * the full trace is no longer kept.
   */
  reasons: SegmentReasonView[];
}

export interface SegmentResultView {
  segmentId: SegmentId;
  /** Stored slot, 0-based within its section. */
  slot: number;
  preShow: boolean;
  /** What the player reads: `slot + 1`. */
  slotNumber: number;
  roleKey: SlotRole;
  roleLabel: string;
  durationClass: DurationClass;
  durationLabel: string;
  kind: SegmentKind;
  /** The match type or angle type key. */
  typeKey: string;
  typeName: string;
  /** The billing line, such as "Number one contender's match", or null. */
  label: string | null;
  titles: SegmentTitleView[];
  sides: SegmentSideView[];
  /** A match's result; null for a talking segment and before the show has run. */
  outcome: SegmentOutcomeView | null;
  /** Null before the show has run, or when the segment could not be rated. */
  rating: SegmentRatingView | null;
  storylines: { id: StorylineId; name: string }[];
  /** MTCH5-08: where it happened; always `ring` for a match. */
  setting: AngleSetting;
  /** MTCH5-08: who did what and where (see `talkLine`); null for a match or a ring talk of wrestlers. */
  talkLine: string | null;
}

export interface ShowResultView {
  score: number;
  /** The score before any `cap`-stage modifier; equal to `score` when none applied. */
  rawScore: number;
  /** 0 to 5 in quarter steps. */
  stars: number;
  scoreTraceRef: TraceRef | null;
  /**
   * How each slot made up the score, read from the show score trace: null for a show scored
   * off-screen and once the full trace is no longer kept.
   */
  breakdown: ShowScoreBreakdownView | null;
  attendance: number | null;
  /** Only for the viewer's own shows; null for a rival's, whatever is stored. */
  gate: Cents | null;
  viewers: number | null;
}

/** `shows.results`: one show's results page. */
export interface ShowResultsView {
  eventInstanceId: EventInstanceId;
  name: string;
  date: GameDate;
  airDate: GameDate;
  status: EventInstanceStatus;
  promotion: { id: PromotionId; name: string; color: string; logoRef: ImageRef };
  brand: { id: BrandId; name: string } | null;
  importance: EventImportance;
  format: { slots: number; preShowSlots: number };
  region: { id: RegionId; name: string };
  venue: { id: VenueId; name: string } | null;
  /** True for the viewer's own shows. */
  mine: boolean;
  /** True for a computer show scored without a card ("card not booked in detail"). */
  offscreen: boolean;
  /** Null until the show is completed. */
  result: ShowResultView | null;
  /**
   * The card in running order: pre-show first, then the main card. Empty for an off-screen show,
   * for a rival's show that has not aired and for a show whose detail was rolled up.
   */
  segments: SegmentResultView[];
  /**
   * Set when the show is older than the detail window and its card was rolled up (POL4-08): what
   * is still known about it, and a plain note saying why the card is gone. Null otherwise.
   */
  history: ShowHistoryView | null;
}

/** What a rolled-up show still shows: its size, main event and title changes. */
export interface ShowHistoryView {
  /** How many segments the card had. */
  segments: number;
  mainEvent: ShowSummaryView['mainEvent'];
  titleChanges: ShowSummaryView['titleChanges'];
  /** "Details are kept for the last 4 weeks." */
  note: string;
}

/** One finished show in a line: the Office panel, the Next Day summary, the results links. */
export interface ShowSummaryView {
  eventInstanceId: EventInstanceId;
  name: string;
  date: GameDate;
  promotionName: string;
  mine: boolean;
  score: number;
  stars: number;
  scoreTraceRef: TraceRef | null;
  /** The main event slot's segment, or null when it was empty or the show was off-screen. */
  mainEvent: { typeName: string; sides: string[]; winnerSide: string | null } | null;
  /** Every title that changed hands on the show, in card order. */
  titleChanges: { titleName: string; newHolderNames: string[] }[];
}

// ---------------------------------------------------------------------------------------------
// Builders

/** What the builders read besides the world. */
export interface ResultsViewDeps {
  readonly viewer: DeepReadonly<Viewer>;
  readonly tunables: EngineTunables;
  readonly traces: Pick<TraceReader, 'has' | 'get'>;
}

/** True when the viewer runs the show's promotion. */
export function isViewerShow(
  read: GameWorldView,
  instance: DeepReadonly<Pick<EventInstance, 'promotionId'>>,
  viewer: DeepReadonly<Viewer>,
): boolean {
  return viewerPromotionIds(read, viewer).includes(instance.promotionId);
}

/** The ref when its trace is kept (full or summarised), else null. */
function keptRef(traces: ResultsViewDeps['traces'], ref: TraceRef | null): TraceRef | null {
  return ref !== null && traces.has(ref) ? ref : null;
}

/** The full trace behind a ref, or null when it is not kept or only its summary is. */
function fullTrace(traces: ResultsViewDeps['traces'], ref: TraceRef | null): TraceNode | null {
  if (ref === null) return null;
  const entry = traces.get(ref);
  return entry !== undefined && isFullTrace(entry) ? entry.trace : null;
}

function keptRefFromKey(traces: ResultsViewDeps['traces'], key: string | null): TraceRef | null {
  return keptRef(traces, key === null ? null : traceRefFromKey(key));
}

/** The show's stars from its score. */
function starsOf(score: number, tunables: EngineTunables): number {
  return showStars({ score }, { tunables }).value;
}

/** True for a completed computer show that was scored without a card. */
function isOffscreen(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  card: readonly DeepReadonly<Segment>[],
): boolean {
  return (
    instance.status === 'completed' &&
    card.length === 0 &&
    showControllerOf(read, instance).kind === 'computer'
  );
}

/** Role rank inside a side: competitors first. */
function roleRank(role: ParticipantRole): number {
  return role === 'competitor' ? 0 : 1;
}

function sidesOf(
  read: GameWorldView,
  people: ShowPeople,
  segment: DeepReadonly<Segment>,
): SegmentSideView[] {
  const participants = [...read.tables.participants.lookup('bySegment', segment.id)].sort(
    (left, right) =>
      left.side - right.side ||
      roleRank(left.role) - roleRank(right.role) ||
      compareIds(left.personId, right.personId),
  );
  const bySide = new Map<number, DeepReadonly<Participant>[]>();
  for (const participant of participants) {
    const onSide = bySide.get(participant.side) ?? [];
    onSide.push(participant);
    bySide.set(participant.side, onSide);
  }
  return [...bySide.entries()].map(([side, onSide]) => {
    const members = onSide.map((participant) => ({
      personId: participant.personId,
      name: people.ringName(participant.personId),
      imageRef: read.tables.people.get(participant.personId)?.imageRef ?? null,
      role: participant.role,
    }));
    // In a match the competitors name the side; in an angle everyone does.
    const naming =
      segment.kind === 'match' ? onSide.filter((entry) => entry.role === 'competitor') : onSide;
    const named = naming.length > 0 ? naming : onSide;
    const teams: (TeamId | null)[] = named.map((participant) => participant.teamId);
    const [first, ...rest] = teams;
    const sharedTeam =
      first !== undefined && first !== null && rest.every((teamId) => teamId === first)
        ? read.tables.teams.get(first)
        : undefined;
    const label =
      sharedTeam?.name ??
      named.map((participant) => people.ringName(participant.personId)).join(' & ');
    return { side, label, members };
  });
}

function outcomeOf(
  read: GameWorldView,
  deps: ResultsViewDeps,
  segment: DeepReadonly<Segment>,
  run: boolean,
): SegmentOutcomeView | null {
  if (!run || segment.kind !== 'match' || segment.outcome === null) {
    return null;
  }
  const { outcome } = segment;
  const finishName =
    segment.match.finishKey === null ? undefined : finishOf(read, segment.match.finishKey)?.name;
  const withFinish = finishName === undefined ? {} : { finishName };
  // A segment is on a human or a computer show, so at most one of the two is kept.
  const resultTraceRef =
    keptRef(deps.traces, matchResultTraceRef(segment.id, true)) ??
    keptRef(deps.traces, matchResultTraceRef(segment.id, false));
  if (outcome.kind !== 'win') {
    return { kind: outcome.kind, ...withFinish, resultTraceRef };
  }
  return {
    kind: 'win',
    winningSide: outcome.winningSide,
    methodName: methodOf(read, outcome.methodKey)?.name ?? outcome.methodKey,
    ...withFinish,
    resultTraceRef,
  };
}

/** Where each segment of the card sits in running order. */
type CardOrder = ReadonlyMap<SegmentId, number>;

/**
 * True when `reign` was the title's reign going into the segment at `position` of the show on
 * `date`: won before the show (or earlier on its card) and not lost before the show (or earlier on
 * its card).
 */
function heldGoingIn(
  reign: DeepReadonly<TitleReign>,
  date: GameDate,
  order: CardOrder,
  position: number,
): boolean {
  if (
    compareDates(reign.wonOn, date) > 0 ||
    (reign.lostOn !== null && compareDates(reign.lostOn, date) < 0)
  ) {
    return false;
  }
  if (reign.wonOn === date && reign.wonInSegmentId !== null) {
    const wonAt = order.get(reign.wonInSegmentId);
    if (wonAt !== undefined && wonAt >= position) {
      return false;
    }
  }
  if (reign.lostOn === date && reign.endedInSegmentId !== null) {
    const endedAt = order.get(reign.endedInSegmentId);
    if (endedAt !== undefined && endedAt < position) {
      return false;
    }
  }
  return true;
}

function titlesOf(
  read: GameWorldView,
  deps: ResultsViewDeps,
  instance: DeepReadonly<EventInstance>,
  segment: DeepReadonly<Segment>,
  run: boolean,
  order: CardOrder,
): SegmentTitleView[] {
  if (segment.kind !== 'match') {
    return [];
  }
  const position = order.get(segment.id) ?? 0;
  const noResult = !run || segment.outcome === null || segment.outcome.kind === 'noContest';
  return segment.match.titleIds.flatMap((titleId): SegmentTitleView[] => {
    const title = read.tables.titles.get(titleId);
    if (title === undefined) {
      return [];
    }
    const reigns = read.tables.titleReigns.lookup('byTitle', titleId);
    const won = noResult ? undefined : reigns.find((reign) => reign.wonInSegmentId === segment.id);
    let outcome: TitleResultOutcome;
    if (noResult) {
      outcome = 'none';
    } else if (won !== undefined) {
      outcome = 'newChampion';
    } else {
      const held = reigns.some((reign) => heldGoingIn(reign, instance.date, order, position));
      outcome = held ? 'retained' : 'stillVacant';
    }
    return [
      {
        titleId,
        name: title.name,
        imageRef: title.imageRef,
        outcome,
        newHolderNames: won === undefined ? [] : [...won.holderNamesAtTime],
        outcomeTraceRef: run
          ? keptRef(deps.traces, titleOutcomeTraceRef(segment.id, titleId))
          : null,
      },
    ];
  });
}

function ratingOf(deps: ResultsViewDeps, segment: DeepReadonly<Segment>): SegmentRatingView | null {
  const { rating } = segment;
  if (rating === null) {
    return null;
  }
  const traceRef = keptRefFromKey(deps.traces, rating.traceId);
  const trace = fullTrace(deps.traces, traceRef);
  return {
    score: rating.score,
    stars: rating.stars,
    workRate: rating.workRate,
    crowd: rating.crowd,
    expectation: rating.expectation,
    traceRef,
    reasons: trace === null ? [] : segmentReasons(trace),
  };
}

function segmentViewOf(
  read: GameWorldView,
  deps: ResultsViewDeps,
  instance: DeepReadonly<EventInstance>,
  people: ShowPeople,
  segment: DeepReadonly<Segment>,
  order: CardOrder,
): SegmentResultView {
  const slotDeps = { tunables: deps.tunables };
  const role = slotRoleOf(slotRoleInput(segment, instance.format), slotDeps).value;
  const isMatch = segment.kind === 'match';
  const typeKey = isMatch ? segment.match.matchTypeKey : segment.angle.angleTypeKey;
  const matchType = isMatch ? (matchTypeOf(read, typeKey) ?? null) : null;
  const typeName = isMatch
    ? (matchType?.name ?? typeKey)
    : (angleTypeOf(read, typeKey)?.name ?? typeKey);
  const durationClass = durationClassOf(
    {
      role,
      matchType: isMatch ? matchType : settingDurationShifter(settingOf(segment), deps.tunables),
    },
    slotDeps,
  ).value;
  // A live show's segments count as run one at a time, as the player runs them (EVT10-01).
  const run =
    instance.status === 'completed' ||
    (instance.liveRun?.ranSegmentIds.includes(segment.id) ?? false);
  return {
    segmentId: segment.id,
    slot: segment.slot,
    preShow: segment.preShow,
    slotNumber: segment.slot + 1,
    roleKey: role,
    roleLabel: SLOT_ROLE_LABELS[role],
    durationClass,
    durationLabel: DURATION_CLASS_LABELS[durationClass],
    kind: segment.kind,
    typeKey,
    typeName,
    label: segment.label,
    titles: titlesOf(read, deps, instance, segment, run, order),
    sides: sidesOf(read, people, segment),
    outcome: outcomeOf(read, deps, segment, run),
    rating: run ? ratingOf(deps, segment) : null,
    storylines: segment.storylineIds.flatMap((id) => {
      const storyline = read.tables.storylines.get(id);
      return storyline === undefined ? [] : [{ id, name: storyline.name }];
    }),
    setting: settingOf(segment),
    talkLine: talkLineOf(read, segment, people),
  };
}

function cardOrderOf(card: readonly DeepReadonly<Segment>[]): CardOrder {
  return new Map(card.map((segment, index) => [segment.id, index]));
}

function resultOf(
  instance: DeepReadonly<EventInstance>,
  deps: ResultsViewDeps,
  seesMoney: boolean,
  segments: readonly SegmentResultView[],
  offscreen: boolean,
): ShowResultView | null {
  const { result } = instance;
  if (result === null) {
    return null;
  }
  const scoreTraceRef = keptRefFromKey(deps.traces, result.traceId);
  const trace = offscreen ? null : fullTrace(deps.traces, scoreTraceRef);
  // The slots that counted: the segments that were rated, in card order.
  const rated: BreakdownSegment[] = segments
    .filter((segment) => segment.rating !== null)
    .map((segment) => ({
      segmentId: segment.segmentId,
      roleLabel: segment.roleLabel,
      preShow: segment.preShow,
    }));
  return {
    score: result.score,
    rawScore: result.rawScore,
    stars: starsOf(result.score, deps.tunables),
    scoreTraceRef,
    breakdown: trace === null ? null : showScoreBreakdown(trace, rated),
    attendance: result.attendance,
    gate: seesMoney ? result.gate : null,
    viewers: result.viewers,
  };
}

/** One show's results page, as `deps.viewer` may see it. */
export function showResultsView(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  deps: ResultsViewDeps,
): ShowResultsView {
  const mine = isViewerShow(read, instance, deps.viewer);
  const promotion = read.tables.promotions.get(instance.promotionId);
  const brand = instance.brandId === null ? undefined : read.tables.brands.get(instance.brandId);
  const region = read.tables.regions.get(instance.regionId);
  const venue = instance.venueId === null ? undefined : read.tables.venues.get(instance.venueId);
  const card = cardSegments(read, instance.id);
  const kept = instance.result?.history;
  const offscreen = kept === undefined && isOffscreen(read, instance, card);
  // A card is the booker's secret until it airs: only its own promotion (and tools) see it early.
  // A rolled-up card is gone bar a few kept matches, so none of it is listed.
  const cardVisible =
    kept === undefined &&
    (instance.status === 'completed' || mine || deps.viewer.kind === 'omniscient');
  const people = showPeople(read, instance);
  const order = cardOrderOf(card);
  const segments = cardVisible
    ? card.map((segment) => segmentViewOf(read, deps, instance, people, segment, order))
    : [];
  return {
    eventInstanceId: instance.id,
    name: instance.name,
    date: instance.date,
    airDate: instance.airDate,
    status: instance.status,
    promotion: {
      id: instance.promotionId,
      name: promotion?.name ?? instance.promotionId,
      color: promotion?.color ?? '#000000',
      logoRef: promotion?.logoRef ?? null,
    },
    brand: brand === undefined ? null : { id: brand.id, name: brand.name },
    importance: instance.importance,
    format: { slots: instance.format.slots, preShowSlots: instance.format.preShowSlots },
    region: { id: instance.regionId, name: region?.name ?? instance.regionId },
    venue: venue === undefined ? null : { id: venue.id, name: venue.name },
    mine,
    offscreen,
    result: resultOf(
      instance,
      deps,
      mine || deps.viewer.kind === 'omniscient',
      segments,
      offscreen,
    ),
    segments,
    history:
      kept === undefined
        ? null
        : {
            segments: kept.segments,
            mainEvent:
              kept.mainEvent === null
                ? null
                : { ...kept.mainEvent, sides: [...kept.mainEvent.sides] },
            titleChanges: titleChangesOf(read, card),
            note: detailKeptNote(deps.tunables),
          },
  };
}

/**
 * The card's main event in summary words, or null when the main event slot is empty. The history
 * roll-up (POL4-08) stores this on the show before the card goes.
 */
export function mainEventSummaryOf(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
): ShowHistoryMainEvent | null {
  const card = cardSegments(read, instance.id);
  const people = showPeople(read, instance);
  const mainEventSlot = instance.format.slots - 1;
  const main = card.find((segment) => !segment.preShow && segment.slot === mainEventSlot);
  if (main === undefined) {
    return null;
  }
  const sides = sidesOf(read, people, main);
  const outcome = main.kind === 'match' ? main.outcome : null;
  const winner =
    instance.status === 'completed' && outcome?.kind === 'win'
      ? sides.find((side) => side.side === outcome.winningSide)
      : undefined;
  return {
    typeName:
      main.kind === 'match'
        ? (matchTypeOf(read, main.match.matchTypeKey)?.name ?? main.match.matchTypeKey)
        : (angleTypeOf(read, main.angle.angleTypeKey)?.name ?? main.angle.angleTypeKey),
    sides: sides.map((side) => side.label),
    winnerSide: winner?.label ?? null,
  };
}

/** Every title that changed hands on the card, in card order. */
function titleChangesOf(
  read: GameWorldView,
  card: readonly DeepReadonly<Segment>[],
): ShowSummaryView['titleChanges'] {
  const titleChanges: ShowSummaryView['titleChanges'] = [];
  for (const segment of card) {
    if (segment.kind !== 'match') {
      continue;
    }
    for (const titleId of segment.match.titleIds) {
      const won = read.tables.titleReigns
        .lookup('byTitle', titleId)
        .find((reign) => reign.wonInSegmentId === segment.id);
      if (won !== undefined) {
        titleChanges.push({
          titleName: read.tables.titles.get(titleId)?.name ?? titleId,
          newHolderNames: [...won.holderNamesAtTime],
        });
      }
    }
  }
  return titleChanges;
}

/** The compact line for one completed show. */
export function showSummaryView(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  deps: ResultsViewDeps,
): ShowSummaryView {
  const card = cardSegments(read, instance.id);
  const kept = instance.result?.history?.mainEvent;
  const mainEvent: ShowSummaryView['mainEvent'] =
    kept === undefined
      ? mainEventSummaryOf(read, instance)
      : kept === null
        ? null
        : { ...kept, sides: [...kept.sides] };
  const titleChanges = titleChangesOf(read, card);
  const score = instance.result?.score ?? 0;
  return {
    eventInstanceId: instance.id,
    name: instance.name,
    date: instance.date,
    promotionName: read.tables.promotions.get(instance.promotionId)?.name ?? instance.promotionId,
    mine: isViewerShow(read, instance, deps.viewer),
    score,
    stars: starsOf(score, deps.tunables),
    scoreTraceRef: keptRefFromKey(deps.traces, instance.result?.traceId ?? null),
    mainEvent,
    titleChanges,
  };
}
