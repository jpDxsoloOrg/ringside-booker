/**
 * `aip.decideResults`: a rival booker decides its matches' results (AIP5-04).
 *
 * A booked-card step (order 10), so it runs inside `aip.bookShow` right after the card is written
 * and before it is checked. Only on a show the computer runs (`isComputerBooked`): the player's
 * shows and Auto-fill never get a winner from here. For each match on the card, pre-show first then
 * by slot, that has no result planned yet:
 *
 * 1. each side's value (`rivalSideValue`, one jitter roll per side);
 * 2. the winner:
 *    - no title on the line: `matchWinner`, draws allowed when the match can end in one;
 *    - the lead title (highest prestige) with its champion in the match: `titleChangeChance`,
 *      `challengerPool` and `titleChange`; `retain` puts the champions over, `side:<n>` the new
 *      champions. Never a draw;
 *    - a vacant lead title, or a champion who isn't in the match: `matchWinner` over the sides that
 *      can hold it; with none, the best-valued side wins by a method that can't move a title;
 * 3. the method (`pickRivalMethod`);
 * 4. `setPlannedOutcome` writes the plan. EVT3 runs the match as booked and applies any title
 *    change itself: nothing here touches reigns, titles, morale, momentum or popularity.
 *
 * Each match gets an `aip.winner` trace (and each title on it an `aip.title` trace), both compact:
 * card values are kept as numbers. The show gets one `winner` decision and each lead title one
 * `title` decision, revealed on the show's air date like the card itself.
 *
 * Rolls come from the show's own `aip.winners` and `aip.titles` streams, keyed by the event
 * instance (`detachedStream(seed, name, instanceId)`): changing one rival card never moves another
 * show's results, and title rolls never move match rolls. See
 * docs/design/rival-booking.md#how-a-rival-shows-results-are-decided.
 */

import type { ContentKey } from '../../../core/content-key';
import { parseContentKey } from '../../../core/content-key';
import { InvariantError } from '../../../core/errors';
import type { PersonId, SegmentId, TitleId } from '../../../core/ids';
import { detachedStream, type RngStream } from '../../../core/rng/registry';
import { startDecision, type Traced } from '../../../core/trace';
import type { EventInstance } from '../../../model/entities/event-instance';
import type { MatchOutcome, Segment } from '../../../model/entities/segment';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { cardSegments } from '../../booking/card';
import { setPlannedOutcome } from '../../booking/writer';
import { allowedFinishes } from '../../match/finishes/allowed';
import {
  registerBookedCardStep,
  type BookedCardInput,
  type ShowBookingContext,
} from '../card/bookedCardSteps';
import { writeAiDecision } from '../decisions';
import { challengerPool, type ChallengerPool } from '../formulas/challengerPool';
import {
  DRAW_PLAN,
  matchWinner,
  parseWinnerPlan,
  winnerReasonText,
  winPlanKey,
  type MatchWinnerSide,
  type MatchWinnerStoryline,
} from '../formulas/matchWinner';
import { rivalSideValue } from '../formulas/rivalSideValue';
import {
  RETAIN_PLAN,
  titleChange,
  titleDecisionLabel,
  titleReasonText,
} from '../formulas/titleChange';
import { titleChangeChance } from '../formulas/titleChangeChance';
import { employmentAt } from '../inputs';
import { TITLE_DECISION_KIND, WINNER_DECISION_KIND } from './decisionKinds';
import { isComputerBooked } from './guard';
import { popularityHistoryOf } from './history';
import {
  rivalSegmentInputsOf,
  rivalShowContextOf,
  STORED_TITLE_TASTE_LABEL,
  type RivalSegmentInputs,
  type RivalSide,
  type RivalStorylineContext,
  type RivalTitleContext,
} from './inputs';
import { pickRivalMethod } from './method';
import { TITLES_STREAM, WINNERS_STREAM } from './streams';
import {
  alsoOnTheLineText,
  BEST_VALUE_REASON,
  CHAMPION_ABSENT_NOTE,
  followsText,
  NO_CONTEST_REASON,
  NO_DRAWS_ON_TITLES_NOTE,
  NO_METHOD_NOTE,
  NOBODY_CAN_HOLD_NOTE,
  ONLY_ONE_FIT_NOTE,
  TITLE_CHANGE_SUMMARY_KEY,
  TITLE_CROWN_SUMMARY_KEY,
  TITLE_RETAIN_SUMMARY_KEY,
  TITLE_VACANT_SUMMARY_KEY,
  VACANT_TITLE_NOTE,
  WINNERS_BOOKED_SUMMARY_KEY,
} from './texts';
import {
  compactTrace,
  TITLE_TRACE_DEPTH,
  titleTraceRef,
  WINNER_TRACE_DEPTH,
  winnerTraceRef,
} from './traces';
import { WINNERS_DOC_REF } from './tunables';

export const DECIDE_RESULTS_STEP_ID = 'aip.decideResults';
/** Runs before any later booked-card step (crew, stipulations). */
export const DECIDE_RESULTS_STEP_ORDER = 10;

/** How the lead title fares in the plan, as the Shows tab and the view name it. */
export type TitlePlanKind = 'retain' | 'change' | 'crown' | 'vacant';

/** "Booked result: Kai Moreno vs Vance Troy". */
export function bookedResultLabel(segmentLabel: string): string {
  return `Booked result: ${segmentLabel}`;
}

/** The show's two keyed streams. */
interface ShowStreams {
  readonly winners: RngStream;
  readonly titles: RngStream;
}

function showStreams(read: GameWorldView, instanceId: string): ShowStreams {
  return {
    winners: detachedStream(read.meta.seed, WINNERS_STREAM, instanceId),
    titles: detachedStream(read.meta.seed, TITLES_STREAM, instanceId),
  };
}

/** What one segment's decision came to. */
interface SegmentPlan {
  readonly outcome: MatchOutcome;
  /** The `aip.winner` trace. */
  readonly trace: Traced<string>;
  /** The lead title's decision (null on a match with no title). */
  readonly title: TitlePlan | null;
}

interface TitlePlan {
  readonly title: RivalTitleContext;
  readonly kind: TitlePlanKind;
  /** Short reason, for the decision log: "Contract ending", "Champion retains" ... */
  readonly reason: string;
  readonly chance: number | null;
  readonly championLabel: string | null;
  readonly winnerLabel: string | null;
  readonly winnerIds: readonly PersonId[];
  readonly trace: Traced<string>;
}

/** Everything one segment's decision reads. */
interface SegmentWork {
  readonly ctx: ShowBookingContext;
  readonly segment: DeepReadonly<Extract<Segment, { kind: 'match' }>>;
  readonly inputs: RivalSegmentInputs;
  readonly label: string;
  readonly values: ReadonlyMap<number, Traced<number>>;
  readonly streams: ShowStreams;
}

function nameOf(read: GameWorldView, inputs: RivalSegmentInputs, personId: PersonId): string {
  return (
    employmentAt(read, personId, inputs.promotionId, inputs.date)?.ringName ??
    read.tables.people.require(personId).defaultRingName
  );
}

function sideOf(inputs: RivalSegmentInputs, side: number): RivalSide | undefined {
  return inputs.sides.find((entry) => entry.side === side);
}

function sideLabel(inputs: RivalSegmentInputs, side: number): string {
  return sideOf(inputs, side)?.label ?? `side ${String(side)}`;
}

/** Can this match end in a draw? Only when one of its allowed finishes is a draw (or no finishes). */
function drawAllowed(
  read: GameWorldView,
  segment: SegmentWork['segment'],
  sideCount: number,
): boolean {
  const { catalogs } = read.meta;
  if (Object.keys(catalogs.finishes ?? {}).length === 0) {
    return true;
  }
  return allowedFinishes(catalogs, {
    matchTypeKey: segment.match.matchTypeKey,
    sideCount,
    stipulationKeys: segment.match.stipulationKeys,
  }).some((finish) => finish.outcomeKind === 'draw');
}

/** A storyline as `matchWinner` reads it: the finale flag first, else the storyline's age. */
function storylineInput(
  storyline: RivalStorylineContext,
  minAgeDays: number,
): MatchWinnerStoryline {
  const single = (sides: readonly number[]): number | null =>
    sides.length === 1 ? (sides[0] ?? null) : null;
  let isFinale: boolean;
  let finaleReason: string;
  if (storyline.finaleFlag === true) {
    isFinale = true;
    finaleReason = 'Booked as the finale';
  } else if (storyline.finaleFlag === false) {
    isFinale = false;
    finaleReason = 'not at its finale: another match is';
  } else {
    isFinale = storyline.ageDays >= minAgeDays;
    finaleReason = isFinale
      ? `Running ${String(storyline.ageDays)} days`
      : `${String(storyline.ageDays)} days old; finales start at ${String(minAgeDays)}`;
  }
  return {
    name: storyline.name,
    storylineId: storyline.storylineId,
    isFinale,
    finaleReason,
    faceSide: single(storyline.faceSides),
    heelSide: single(storyline.heelSides),
  };
}

function valueOf(work: SegmentWork, side: number): Traced<number> {
  const value = work.values.get(side);
  if (value === undefined) {
    throw new InvariantError(`aip.decideResults: no value for side ${String(side)}`);
  }
  return value;
}

/** The side's lowest person id (the gatherer sorts them), for an exact tie. */
function lowestPersonOf(side: RivalSide): PersonId {
  const [first] = side.personIds;
  if (first === undefined) {
    throw new InvariantError(`aip.decideResults: side ${String(side.side)} has nobody on it`);
  }
  return first;
}

function winnerSides(work: SegmentWork, only?: ReadonlySet<number>): MatchWinnerSide[] {
  return work.inputs.sides
    .filter((side) => only === undefined || only.has(side.side))
    .map((side) => ({
      side: side.side,
      label: side.label,
      values: valueOf(work, side.side),
      pushIndex: side.pushIndex,
      featured: side.featured,
      featuredName: side.featured === null ? null : side.label,
      lowestPersonId: lowestPersonOf(side),
    }));
}

function storylinesOf(work: SegmentWork): MatchWinnerStoryline[] {
  const minAgeDays = work.ctx.tunables.get('aip.winner.finale.minAgeDays');
  return work.inputs.storylines.map((storyline) => storylineInput(storyline, minAgeDays));
}

/** The best-valued side; a tie goes to the side with the lowest person id. */
function bestValuedSide(work: SegmentWork): number {
  const ranked = winnerSides(work).sort(
    (left, right) =>
      right.values.value - left.values.value ||
      compareIds(left.lowestPersonId, right.lowestPersonId),
  );
  return ranked[0]?.side ?? 0;
}

/** The pool for a title, every non-champion side labelled. */
function poolFor(work: SegmentWork, title: RivalTitleContext): ChallengerPool {
  return challengerPool(
    {
      titleName: title.name,
      prestige: title.prestige,
      sides: title.challengerSides.map((side) => ({
        ...side,
        label: sideLabel(work.inputs, side.side),
      })),
    },
    { tunables: work.ctx.tunables },
  );
}

function holderLabel(work: SegmentWork, title: RivalTitleContext): string | null {
  if (title.openReign === null) {
    return null;
  }
  return title.openReign.holderIds
    .map((personId) => nameOf(work.ctx.read, work.inputs, personId))
    .join(' & ');
}

/** The lead title with its champion in the match: the title formulas decide. */
function championInMatch(
  work: SegmentWork,
  title: RivalTitleContext & {
    championSide: number;
    openReign: NonNullable<RivalTitleContext['openReign']>;
  },
): { side: number; title: TitlePlan } {
  const { ctx, inputs } = work;
  const weeks = ctx.tunables.get('aip.titles.hotShot.weeks');
  const chance = titleChangeChance(
    {
      titleName: title.name,
      reignDays: title.openReign.reignDays,
      prestige: title.prestige,
      titleTaste: inputs.titleTaste,
      titleTasteSource:
        inputs.titleTaste.trace.label === STORED_TITLE_TASTE_LABEL ? 'booker' : 'styleDefault',
      importance: inputs.importance,
      popularityHistory: popularityHistoryOf(ctx.read, inputs.promotionId, inputs.date, weeks),
    },
    { tunables: ctx.tunables },
  );
  const pool = poolFor(work, title);
  const championLabel = sideLabel(inputs, title.championSide);
  const decided = titleChange(
    {
      titleName: title.name,
      importance: inputs.importance,
      reignDays: title.openReign.reignDays,
      championSide: title.championSide,
      championLabel,
      championContractDaysLeft: title.championContractDaysLeft,
      chance,
      pool,
      sideValues: work.values,
    },
    { tunables: ctx.tunables, rng: work.streams.titles },
  );
  const plan = decided.plan.value;
  const changes = plan !== RETAIN_PLAN;
  const side = changes ? parseSide(plan) : title.championSide;
  return {
    side,
    title: {
      title,
      kind: changes ? 'change' : 'retain',
      reason: titleReasonText(decided.reasonKey),
      chance: chance.value,
      championLabel,
      winnerLabel: sideLabel(inputs, side),
      winnerIds: sideOf(inputs, side)?.personIds ?? [],
      trace: compactTrace(decided.plan, TITLE_TRACE_DEPTH),
    },
  };
}

function parseSide(plan: string): number {
  const parsed = parseWinnerPlan(plan);
  return parsed.kind === 'win' ? parsed.side : 0;
}

/**
 * The show already planned today that puts the same title on the line, if any. Its card was
 * decided first (shows go in ID order), and nobody knows which match runs first, so this match
 * must not be able to move the title at all.
 */
function titleBookedElsewhere(work: SegmentWork, titleId: TitleId): string | null {
  const { read } = work.ctx;
  const here = work.segment.eventInstanceId;
  for (const show of read.tables.eventInstances.lookup('byDate', work.inputs.date)) {
    if (show.id === here || show.promotionId !== work.inputs.promotionId) {
      continue;
    }
    if (show.status === 'cancelled' || show.status === 'completed') {
      continue;
    }
    const onTheLine = cardSegments(read, show.id).some(
      (segment) =>
        segment.kind === 'match' &&
        segment.outcome !== null &&
        segment.match.titleIds.includes(titleId),
    );
    if (onTheLine) {
      return show.name;
    }
  }
  return null;
}

/** The title is also on the line on another show tonight: the best side wins, the title can't move. */
function titleElsewhere(
  work: SegmentWork,
  title: RivalTitleContext,
  showName: string,
): { side: number; winnerTrace: Traced<string>; title: TitlePlan } {
  const { inputs } = work;
  const reason = alsoOnTheLineText(showName);
  const result = matchWinner(
    {
      segmentLabel: work.label,
      sides: winnerSides(work),
      storylines: storylinesOf(work),
      allowDraw: false,
    },
    { tunables: work.ctx.tunables, rng: work.streams.winners },
  );
  const side = parseSide(result.plan.value);
  const decision = startDecision<string>(titleDecisionLabel(title.name), {
    docRef: WINNERS_DOC_REF,
  });
  decision.note(reason);
  return {
    side,
    winnerTrace: result.plan,
    title: {
      title,
      kind: title.openReign === null ? 'vacant' : 'retain',
      reason,
      chance: null,
      championLabel: holderLabel(work, title),
      winnerLabel: sideLabel(inputs, side),
      winnerIds: sideOf(inputs, side)?.personIds ?? [],
      trace: compactTrace(decision.choose(RETAIN_PLAN, reason), TITLE_TRACE_DEPTH),
    },
  };
}

/** A vacant lead title, or a champion who isn't here: the sides that can hold it fight it out. */
function noChampionHere(
  work: SegmentWork,
  title: RivalTitleContext,
): { side: number; forceNoChange: boolean; winnerTrace: Traced<string>; title: TitlePlan } {
  const { inputs } = work;
  const vacant = title.openReign === null;
  const pool = poolFor(work, title);
  const decision = startDecision<string>(titleDecisionLabel(title.name), {
    docRef: WINNERS_DOC_REF,
  });
  decision.include('Challengers', pool.pool);
  decision.note(vacant ? VACANT_TITLE_NOTE : CHAMPION_ABSENT_NOTE);
  const eligible = pool.eligible;
  const championLabel = holderLabel(work, title);
  let side: number;
  let winnerTrace: Traced<string>;
  let kind: TitlePlanKind;
  let reason: string;
  if (eligible.length === 0) {
    decision.note(NOBODY_CAN_HOLD_NOTE);
    side = bestValuedSide(work);
    winnerTrace = startDecision<string>(`Who wins: ${work.label}`, { docRef: WINNERS_DOC_REF })
      .note(NOBODY_CAN_HOLD_NOTE)
      .choose(winPlanKey(side), BEST_VALUE_REASON);
    kind = vacant ? 'vacant' : 'retain';
    reason = NOBODY_CAN_HOLD_NOTE;
  } else if (eligible.length === 1) {
    side = eligible[0] ?? 0;
    winnerTrace = startDecision<string>(`Who wins: ${work.label}`, { docRef: WINNERS_DOC_REF })
      .note(ONLY_ONE_FIT_NOTE)
      .choose(winPlanKey(side), ONLY_ONE_FIT_NOTE);
    kind = vacant ? 'crown' : 'change';
    reason = vacant ? VACANT_TITLE_NOTE : CHAMPION_ABSENT_NOTE;
  } else {
    const result = matchWinner(
      {
        segmentLabel: work.label,
        sides: winnerSides(work, new Set(eligible)),
        storylines: storylinesOf(work),
        allowDraw: false,
      },
      { tunables: work.ctx.tunables, rng: work.streams.winners },
    );
    side = parseSide(result.plan.value);
    winnerTrace = result.plan;
    kind = vacant ? 'crown' : 'change';
    reason = vacant ? VACANT_TITLE_NOTE : CHAMPION_ABSENT_NOTE;
  }
  decision.include('Who wins', winnerTrace);
  const forceNoChange = eligible.length === 0;
  const option = forceNoChange ? RETAIN_PLAN : winPlanKey(side);
  return {
    side,
    forceNoChange,
    winnerTrace,
    title: {
      title,
      kind,
      reason,
      chance: null,
      championLabel,
      winnerLabel: sideLabel(inputs, side),
      winnerIds: sideOf(inputs, side)?.personIds ?? [],
      trace: compactTrace(decision.choose(option, reason), TITLE_TRACE_DEPTH),
    },
  };
}

/**
 * The title decision as one line in the winner's Why?: what was decided and why. The full decision
 * is the title's own `aip.title` trace, so it is not stored twice.
 */
function titleHeadline(plan: TitlePlan): Traced<string> {
  return startDecision<string>(titleDecisionLabel(plan.title.name), {
    docRef: WINNERS_DOC_REF,
  }).choose(plan.trace.value, plan.reason);
}

/** Decides one match: winner, title and method, as one combined trace. */
function decideSegment(work: SegmentWork): SegmentPlan {
  const { ctx, inputs } = work;
  const combined = startDecision<string>(bookedResultLabel(work.label), {
    docRef: WINNERS_DOC_REF,
  });
  const sideCount = inputs.sides.length;
  const matchArgs = {
    matchTypeKey: work.segment.match.matchTypeKey,
    sideCount,
    stipulationKeys: work.segment.match.stipulationKeys,
  };
  const [lead] = inputs.titles;

  let winningSide: number | null;
  let because: string;
  let titlePlan: TitlePlan | null = null;
  let titleChanges = false;
  let forceNoChange = false;

  const elsewhere = lead === undefined ? null : titleBookedElsewhere(work, lead.titleId);
  if (lead !== undefined && elsewhere !== null) {
    const decided = titleElsewhere(work, lead, elsewhere);
    combined.note(NO_DRAWS_ON_TITLES_NOTE);
    combined.include(titleDecisionLabel(lead.name), titleHeadline(decided.title));
    combined.include('Who wins', decided.winnerTrace);
    winningSide = decided.side;
    titlePlan = decided.title;
    forceNoChange = true;
    because = decided.title.reason;
  } else if (lead === undefined) {
    const result = matchWinner(
      {
        segmentLabel: work.label,
        sides: winnerSides(work),
        storylines: storylinesOf(work),
        allowDraw: drawAllowed(ctx.read, work.segment, sideCount),
      },
      { tunables: ctx.tunables, rng: work.streams.winners },
    );
    combined.include('Who wins', result.plan);
    const plan = parseWinnerPlan(result.plan.value);
    winningSide = plan.kind === 'win' ? plan.side : null;
    because = winnerReasonText(result.reasonKey, { protectedRole: result.protectedRole });
  } else if (lead.openReign !== null && lead.championSide !== null) {
    const decided = championInMatch(work, {
      ...lead,
      championSide: lead.championSide,
      openReign: lead.openReign,
    });
    combined.note(NO_DRAWS_ON_TITLES_NOTE);
    combined.include(titleDecisionLabel(lead.name), titleHeadline(decided.title));
    winningSide = decided.side;
    titlePlan = decided.title;
    titleChanges = decided.title.kind === 'change';
    because = decided.title.reason;
  } else {
    const decided = noChampionHere(work, lead);
    combined.include(titleDecisionLabel(lead.name), titleHeadline(decided.title));
    combined.include('Who wins', decided.winnerTrace);
    winningSide = decided.side;
    titlePlan = decided.title;
    titleChanges = decided.title.kind === 'change' || decided.title.kind === 'crown';
    forceNoChange = decided.forceNoChange;
    because = decided.title.reason;
  }

  let outcome: MatchOutcome;
  let option: string;
  if (winningSide === null) {
    outcome = { kind: 'draw' };
    option = DRAW_PLAN;
  } else {
    const method = pickRivalMethod(
      ctx.read,
      { titleChange: titleChanges, forceNoChange, match: matchArgs },
      { tunables: ctx.tunables, rng: work.streams.winners },
    );
    if (method === null) {
      ctx.log(`${work.label} (${work.segment.id}): ${NO_METHOD_NOTE}`);
      combined.note(NO_METHOD_NOTE);
      return {
        outcome: { kind: 'noContest' },
        trace: compactTrace(combined.choose('noContest', NO_CONTEST_REASON), WINNER_TRACE_DEPTH),
        title: titlePlan,
      };
    }
    combined.include('How the match is won', method);
    outcome = { kind: 'win', winningSide, methodKey: method.value };
    option = winPlanKey(winningSide);
  }
  return {
    outcome,
    trace: compactTrace(combined.choose(option, because), WINNER_TRACE_DEPTH),
    title: titlePlan,
  };
}

/** "Kai Moreno vs Vance Troy". */
function matchupOf(inputs: RivalSegmentInputs): string {
  return inputs.sides.map((side) => side.label).join(' vs ');
}

/** The follow trace for a second title on the same match. */
function followTrace(titleName: string, leadName: string, outcome: MatchOutcome): Traced<string> {
  const option = outcome.kind === 'win' ? winPlanKey(outcome.winningSide) : outcome.kind;
  return startDecision<string>(titleDecisionLabel(titleName), { docRef: WINNERS_DOC_REF })
    .note(followsText(leadName))
    .choose(option, followsText(leadName));
}

/** The decision log summary of one lead title. */
function titleSummary(
  plan: TitlePlan,
  segmentId: SegmentId,
  showName: string,
): { key: ContentKey; params: Record<string, string | number> } {
  const params: Record<string, string | number> = {
    title: plan.title.name,
    reason: plan.reason,
    show: showName,
    segment: segmentId,
    plan: plan.kind,
  };
  if (plan.chance !== null) {
    params['chance'] = Math.round(plan.chance * 10) / 10;
  }
  if (plan.title.openReign !== null) {
    params['reignDays'] = plan.title.openReign.reignDays;
  }
  if (plan.championLabel !== null) {
    params['champion'] = plan.championLabel;
  }
  if (plan.winnerLabel !== null && (plan.kind === 'change' || plan.kind === 'crown')) {
    params['challenger'] = plan.winnerLabel;
  }
  const key =
    plan.kind === 'change'
      ? TITLE_CHANGE_SUMMARY_KEY
      : plan.kind === 'crown'
        ? TITLE_CROWN_SUMMARY_KEY
        : plan.kind === 'vacant'
          ? TITLE_VACANT_SUMMARY_KEY
          : TITLE_RETAIN_SUMMARY_KEY;
  return { key: parseContentKey(key), params };
}

function titleDecisionPeople(plan: TitlePlan): PersonId[] {
  const people = new Set<PersonId>([...(plan.title.openReign?.holderIds ?? []), ...plan.winnerIds]);
  return [...people].sort(compareIds).slice(0, 12);
}

/** The step: plans every unplanned match on a computer-run card. */
export function decideResults(ctx: ShowBookingContext, input: BookedCardInput): void {
  const instance: DeepReadonly<EventInstance> = input.instance;
  if (!isComputerBooked(ctx.read, instance)) {
    return;
  }
  const streams = showStreams(ctx.read, instance.id);
  const showContext = rivalShowContextOf(ctx.read, ctx.tunables, instance, input.plan.cardValues);
  let decided = 0;
  for (const segment of cardSegments(ctx.read, instance.id)) {
    if (segment.kind !== 'match') {
      continue;
    }
    if (segment.outcome !== null) {
      ctx.log(
        `${instance.name} (${instance.id}): kept the result already planned for ${segment.id}`,
      );
      continue;
    }
    const inputs = rivalSegmentInputsOf(ctx.read, ctx.tunables, segment.id, ctx.date, showContext);
    if (inputs === null) {
      ctx.log(
        `${instance.name} (${instance.id}): ${segment.id} has fewer than two sides; no result planned`,
      );
      continue;
    }
    const label = segment.label ?? matchupOf(inputs);
    const values = new Map<number, Traced<number>>();
    for (const side of inputs.sides) {
      values.set(
        side.side,
        rivalSideValue(
          {
            label: side.label,
            cardValues: side.cardValues,
            names: side.personIds.map((personId) => nameOf(ctx.read, inputs, personId)),
          },
          { tunables: ctx.tunables, rng: streams.winners },
        ),
      );
    }
    const plan = decideSegment({ ctx, segment, inputs, label, values, streams });
    setPlannedOutcome(ctx.tx, segment.id, plan.outcome);
    ctx.recordTrace(winnerTraceRef(segment.id), ctx.date, plan.trace);
    decided += 1;

    const lead = plan.title;
    if (lead !== null) {
      const ref = titleTraceRef(segment.id, lead.title.titleId);
      ctx.recordTrace(ref, ctx.date, lead.trace);
      for (const other of inputs.titles.slice(1)) {
        ctx.recordTrace(
          titleTraceRef(segment.id, other.titleId),
          ctx.date,
          followTrace(other.name, lead.title.name, plan.outcome),
        );
      }
      writeAiDecision(ctx.tx, ctx, ctx.unit, {
        kind: TITLE_DECISION_KIND,
        summary: titleSummary(lead, segment.id, instance.name),
        refs: {
          eventInstanceId: instance.id,
          promotionIds: [instance.promotionId],
          titleIds: [lead.title.titleId],
          personIds: titleDecisionPeople(lead),
        },
        traceRef: ref,
        revealOn: instance.airDate,
        importance: lead.kind === 'change' || lead.kind === 'crown' ? 2 : 1,
      });
    }
  }
  if (decided > 0) {
    writeAiDecision(ctx.tx, ctx, ctx.unit, {
      kind: WINNER_DECISION_KIND,
      summary: {
        key: parseContentKey(WINNERS_BOOKED_SUMMARY_KEY),
        params: { show: instance.name, matches: decided },
      },
      refs: { eventInstanceId: instance.id, promotionIds: [instance.promotionId] },
      revealOn: instance.airDate,
      importance: 0,
    });
  }
}

registerBookedCardStep({
  id: DECIDE_RESULTS_STEP_ID,
  order: DECIDE_RESULTS_STEP_ORDER,
  run: decideResults,
});
