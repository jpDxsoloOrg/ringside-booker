/**
 * Planning a card: the one read-only entry point that books a whole show.
 *
 * `planCard(read, { instance, today, mode, taste? }, { tunables, rng })` runs, in order:
 *
 * 1. the card pool (`buildCardPool`); with fewer wrestlers fit to work than `aip.card.minWorkers`
 *    the show is cancelled: `{ kind: 'cancel', reason: "Only 4 wrestlers available, needs 5" }`;
 * 2. the card shape: talking slots (`talkSlotsFor`), the title match cap (`titleMatchCapFor`) and
 *    whether the main event must be a match;
 * 3. the title picture (`decideTitlePicture`);
 * 4. storyline segments, filler matches and talking segments (`fillCard`), the pre-show's matches
 *    included while `aip.card.fillPreShow` is on;
 * 5. a card score per segment (`formulas/cardScore.ts`) and the order (`orderCard`).
 *
 * In keep-filled mode the segments already on the card stay where they are: their people count as
 * booked, their title matches count towards the cap, their talking segments towards the talking
 * share, their storylines get no second segment, and only the open slots are planned.
 *
 * It never writes and draws only from `deps.rng`. The plan is plain JSON.
 *
 * Design: docs/design/rival-booking.md#planning-a-card.
 */

import { diffDays, type GameDate } from '../../../core/date';
import type { PersonId, StorylineId, TitleId } from '../../../core/ids';
import type { RngStream } from '../../../core/rng/registry';
import { inputOf, startCalc, startDecision, type Traced } from '../../../core/trace';
import type { EventInstance } from '../../../model/entities/event-instance';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { cardSegments } from '../../booking/card';
import type { SegmentDraft } from '../../booking/draft';
import { SLOT_ROLE_LABELS, slotRoleOf } from '../../match/slots';
import { slotRoleInput } from '../../shows/context';
import type { EngineTunables } from '../../tunables';
import type { TracedTaste } from '../formulas/defaultTaste';
import { deciderBrandOf } from '../inputs';
import { profileOf } from '../profiles';
import { CardBook } from './fallback';
import { fillCard } from './fill';
import {
  cardScore,
  storylineHeatText,
  cardScoreText,
  featuredText,
  type FeaturedKind,
} from './formulas/cardScore';
import {
  mainEventMustBeMatch,
  talkRoomFor,
  talkSlotsFor,
  titleMatchCapFor,
} from './formulas/cardShape';
import { orderCard, slotKeyOf, type FixedSegment } from './order';
import { buildCardPool } from './pool';
import { lastDefenceOf } from './titleHistory';
import { decideTitlePicture, titleDueText, VACANT_RULE } from './titlePicture';
import { PLAN_CARD_DOC_REF } from './tunables';
import type {
  CardPool,
  PlannedSegment,
  PlannedSegmentSource,
  PlannedTitleMatch,
  TitlePicture,
} from './types';

export const NOTHING_LEFT_REASON = 'Nothing left to book for this slot';

/** "Only 4 wrestlers available, needs 5". */
export function cancelReason(available: number, needed: number): string {
  return `Only ${String(available)} ${available === 1 ? 'wrestler' : 'wrestlers'} available, needs ${String(needed)}`;
}

/** "Card plan: Monday Night Brawl". */
export function cardPlanLabel(showName: string): string {
  return `Card plan: ${showName}`;
}

/** "Slot 3 · Midcard", 1-based. */
export function slotTraceLabel(slot: number, roleLabel: string): string {
  return `Slot ${String(slot + 1)} · ${roleLabel}`;
}

export type PlanCardMode = 'fresh' | 'keepFilled';

export interface PlanCardArgs {
  readonly instance: DeepReadonly<EventInstance>;
  /** The day the plan is made, for how long titles have gone undefended. */
  readonly today: GameDate;
  /** `fresh` plans the whole card; `keepFilled` keeps what is on it and plans the open slots. */
  readonly mode: PlanCardMode;
  /** Whose taste books the show; defaults to `tasteOf` for the show's deciding unit. */
  readonly taste?: TracedTaste;
}

export interface PlanCardDeps {
  readonly tunables: EngineTunables;
  /** The `aip.card` stream for a rival show, `aip.autofill` for the player's Auto-fill. */
  readonly rng: RngStream;
}

/** One planned segment in its slot. Plain JSON. */
export interface PlannedPlacement {
  /** 0-based, as stored. */
  readonly slot: number;
  readonly preShow: boolean;
  /** The planned segment's key (`title:<id>`, `filler:<n>`, ...). */
  readonly key: string;
  readonly draft: SegmentDraft;
  readonly source: PlannedSegmentSource;
  /** "Slot <n> · <role>": the role, the segment's own decision, its card score and the rule. */
  readonly slotTrace: Traced<string>;
  readonly cardScore: number;
  /**
   * Two or three short reasons for lists ("Tessen Heavyweight Championship: due, 34 days since
   * the last defence").
   */
  readonly headline: readonly string[];
  /**
   * The booker's notes beyond the headline, for the short Why? a written segment keeps: the
   * challenger's rank and card value, the established teams used ("Established team: <name>").
   */
  readonly notes: readonly string[];
}

/** A slot the plan leaves empty, and why. */
export interface PlanOpenSlot {
  readonly preShow: boolean;
  readonly slot: number;
  readonly reason: string;
}

export interface PlanCounts {
  readonly matches: number;
  readonly talking: number;
  readonly titles: number;
  readonly storyline: number;
}

export type CardPlan =
  | {
      readonly kind: 'card';
      /** In running order: the pre-show first, then the main card. */
      readonly placements: readonly PlannedPlacement[];
      readonly open: readonly PlanOpenSlot[];
      /** "Card plan: <show>": the shape, the title picture, the fill, exclusions and the order. */
      readonly planTrace: Traced<string>;
      readonly counts: PlanCounts;
      /** The plan as a booker's notes, for the short Why? a booked show keeps. */
      readonly notes: readonly string[];
    }
  | {
      readonly kind: 'cancel';
      readonly reason: string;
      readonly planTrace: Traced<string>;
      readonly notes: readonly string[];
    };

/** What is already on the card, in keep-filled mode. */
interface OnCard {
  readonly fixed: Map<string, FixedSegment>;
  readonly book: CardBook;
  readonly titles: Set<TitleId>;
  readonly storylines: Set<StorylineId>;
  readonly mainCount: number;
  readonly mainTalks: number;
  readonly preCount: number;
}

function onCardOf(read: GameWorldView, pool: CardPool, mode: PlanCardMode): OnCard {
  const onCard: OnCard = {
    fixed: new Map(),
    book: new CardBook(),
    titles: new Set(),
    storylines: new Set(),
    mainCount: 0,
    mainTalks: 0,
    preCount: 0,
  };
  if (mode === 'fresh') {
    return onCard;
  }
  const names = new Map(
    pool.candidates.map((candidate) => [candidate.personId, candidate.ringName]),
  );
  let mainCount = 0;
  let mainTalks = 0;
  let preCount = 0;
  for (const segment of cardSegments(read, pool.instanceId)) {
    const participants = read.tables.participants.lookup('bySegment', segment.id);
    const people = [...new Set(participants.map((participant) => participant.personId))];
    const label =
      segment.label ??
      (people.length === 0
        ? `${segment.kind === 'match' ? 'Match' : 'Talking segment'} already booked`
        : people.map((personId) => names.get(personId) ?? personId).join(', '));
    onCard.fixed.set(slotKeyOf(segment.preShow, segment.slot), { kind: segment.kind, label });
    onCard.book.add(people, segment.kind === 'match');
    for (const storylineId of segment.storylineIds) {
      onCard.storylines.add(storylineId);
    }
    if (segment.kind === 'match') {
      for (const titleId of segment.match.titleIds) {
        onCard.titles.add(titleId);
      }
    }
    if (segment.preShow) {
      preCount += 1;
    } else {
      mainCount += 1;
      mainTalks += segment.kind === 'angle' ? 1 : 0;
    }
  }
  return { ...onCard, mainCount, mainTalks, preCount };
}

/** The promotion's ace and prospects, by contract, or null before AIP3 names any. */
function featuredOf(
  read: GameWorldView,
  pool: CardPool,
  instance: DeepReadonly<EventInstance>,
): Map<string, FeaturedKind> | null {
  const featured = profileOf(read, pool.promotionId, deciderBrandOf(read, instance))?.featured;
  if (featured === null || featured === undefined) {
    return null;
  }
  const byEmployment = new Map<string, FeaturedKind>();
  for (const prospect of featured.prospects) {
    byEmployment.set(prospect.employmentId, 'prospect');
  }
  if (featured.ace !== null) {
    byEmployment.set(featured.ace.employmentId, 'ace');
  }
  return byEmployment;
}

function peopleOf(draft: SegmentDraft): PersonId[] {
  return [...new Set(draft.participants.map((participant) => participant.personId))];
}

function titleIdsOf(draft: SegmentDraft): readonly TitleId[] {
  return draft.kind === 'match' ? draft.match.titleIds : [];
}

interface Scored {
  readonly score: Traced<number>;
  readonly featured: readonly { readonly name: string; readonly kind: FeaturedKind }[];
  readonly storyline: { readonly name: string; readonly heat: number } | null;
}

function scoreSegment(
  read: GameWorldView,
  pool: CardPool,
  segment: PlannedSegment,
  featured: Map<string, FeaturedKind> | null,
  tunables: EngineTunables,
): Scored {
  const byPerson = new Map(pool.candidates.map((candidate) => [candidate.personId, candidate]));
  const people = peopleOf(segment.draft).flatMap((personId) => {
    const candidate = byPerson.get(personId);
    return candidate === undefined ? [] : [candidate];
  });
  const titles = titleIdsOf(segment.draft).flatMap((titleId) => {
    const title = pool.titles.find((entry) => entry.titleId === titleId);
    return title === undefined ? [] : [{ name: title.name, prestige: title.prestige }];
  });
  const storylines = segment.draft.storylineIds.flatMap((storylineId) => {
    const storyline = read.tables.storylines.get(storylineId);
    return storyline === undefined ? [] : [{ name: storyline.name, heat: storyline.heat }];
  });
  const stars = people.flatMap((candidate) => {
    const kind = featured?.get(candidate.employmentId);
    return kind === undefined ? [] : [{ name: candidate.ringName, kind }];
  });
  const score = cardScore(
    {
      label: segment.trace.trace.label,
      kind: segment.kind,
      participantCardValues: people.map((candidate) => ({
        name: candidate.ringName,
        value: candidate.cardValue.value,
      })),
      titles,
      storylines,
      featured: stars,
      featuredNamed: featured !== null,
    },
    { tunables },
  );
  const [hottest] = [...storylines].sort((left, right) => right.heat - left.heat);
  return { score, featured: stars, storyline: hottest ?? null };
}

/** Two or three short reasons for a list: the rule, the source, a featured worker. */
function headlineOf(
  read: GameWorldView,
  pool: CardPool,
  segment: PlannedSegment,
  scored: Scored,
  rule: string,
  today: GameDate,
): string[] {
  const lines = [rule];
  const [titleId] = titleIdsOf(segment.draft);
  const title = pool.titles.find((entry) => entry.titleId === titleId);
  if (segment.source === 'title' && title !== undefined) {
    if (title.reignId === null) {
      lines.push(`${VACANT_RULE} (${title.name})`);
    } else {
      const last = lastDefenceOf(read, title, today);
      const days = last.date === null ? 0 : Math.max(0, diffDays(last.date, today));
      lines.push(titleDueText(title.name, days));
    }
  } else if (scored.storyline !== null) {
    lines.push(storylineHeatText(scored.storyline.name, scored.storyline.heat));
  } else {
    lines.push(cardScoreText(scored.score.value));
  }
  const [star] = [...scored.featured].sort((left, right) =>
    left.kind === right.kind ? 0 : left.kind === 'ace' ? -1 : 1,
  );
  if (star !== undefined) {
    lines.push(featuredText(star.kind, star.name));
  }
  return lines;
}

/** How many left-out workers the plan's notes name before "and N more". */
const LEFT_OUT_NOTE_LIMIT = 6;

/** "Challenger: #1 Haruto Ise, card value 71" (or "Top contenders: …" for a vacant title). */
export function challengerNoteText(challenger: string, vacant: boolean): string {
  return `${vacant ? 'Top contenders' : 'Challenger'}: ${challenger}`;
}

/** "Established team: Lowland Machine". */
export function establishedTeamText(teamName: string): string {
  return `Established team: ${teamName}`;
}

/** The booker's notes for one placed segment beyond its headline. */
function segmentNotesOf(
  read: GameWorldView,
  pool: CardPool,
  segment: PlannedSegment,
  planned: readonly PlannedTitleMatch[],
): string[] {
  const lines: string[] = [];
  const [titleId] = titleIdsOf(segment.draft);
  const titleMatch = planned.find((entry) => entry.titleId === titleId);
  if (segment.source === 'title' && titleMatch?.challenger != null) {
    const title = pool.titles.find((entry) => entry.titleId === titleId);
    lines.push(challengerNoteText(titleMatch.challenger, title?.reignId === null));
  }
  const teamIds = [
    ...new Set(
      segment.draft.participants.flatMap((participant) =>
        participant.teamId === null ? [] : [participant.teamId],
      ),
    ),
  ];
  for (const teamId of teamIds) {
    const name =
      pool.teams.find((team) => team.teamId === teamId)?.name ??
      read.tables.teams.get(teamId)?.name;
    if (name !== undefined) {
      lines.push(establishedTeamText(name));
    }
  }
  return lines;
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** The plan's opening notes: who is fit to work and who was left out. */
function rosterNotesOf(pool: CardPool, minWorkers: number): string[] {
  const lines = [
    `${plural(pool.availableWrestlers, 'wrestler', 'wrestlers')} fit to work, ${String(minWorkers)} needed`,
  ];
  for (const exclusion of pool.excluded.slice(0, LEFT_OUT_NOTE_LIMIT)) {
    lines.push(`Left out: ${exclusion.ringName}, ${lowerFirst(exclusion.reason)}`);
  }
  const more = pool.excluded.length - LEFT_OUT_NOTE_LIMIT;
  if (more > 0) {
    lines.push(`${plural(more, 'more worker', 'more workers')} left out`);
  }
  return lines;
}

/** One line per title the booker looked at: on the line and why, or why not. */
function titleNotesOf(
  read: GameWorldView,
  pool: CardPool,
  picture: TitlePicture,
  today: GameDate,
): string[] {
  return pool.titles.flatMap((title) => {
    if (picture.planned.some((entry) => entry.titleId === title.titleId)) {
      if (title.reignId === null) {
        return [`${title.name}: ${lowerFirst(VACANT_RULE)}`];
      }
      const last = lastDefenceOf(read, title, today);
      const days = last.date === null ? 0 : Math.max(0, diffDays(last.date, today));
      return [titleDueText(title.name, days)];
    }
    const skipped = picture.skipped.find((entry) => entry.titleId === title.titleId);
    return skipped === undefined ? [] : [`${title.name}: ${lowerFirst(skipped.reason)}`];
  });
}

/** The whole plan for one show. See the module comment for the steps. */
export function planCard(read: GameWorldView, args: PlanCardArgs, deps: PlanCardDeps): CardPlan {
  const { tunables, rng } = deps;
  const { instance, today, mode } = args;
  const built = buildCardPool(read, { instance, date: instance.date, tunables });
  const pool: CardPool = args.taste === undefined ? built : { ...built, taste: args.taste };
  const plan = startDecision<string>(cardPlanLabel(pool.showName), { docRef: PLAN_CARD_DOC_REF });
  plan.note(mode === 'fresh' ? 'Planning the whole card' : 'Keeping what is on the card');

  // 1. Cancel on a thin roster.
  const minWorkers = plan.tunable(tunables, 'aip.card.minWorkers');
  const enough = pool.availableWrestlers >= minWorkers;
  plan.rule(
    `${String(pool.availableWrestlers)} wrestlers fit to work, ${String(minWorkers)} needed`,
    enough,
  );
  for (const exclusion of pool.excluded) {
    plan.note(`${exclusion.ringName}: ${exclusion.reason}`);
  }
  const notes = rosterNotesOf(pool, minWorkers);
  if (!enough) {
    const reason = cancelReason(pool.availableWrestlers, minWorkers);
    return {
      kind: 'cancel',
      reason,
      planTrace: plan.choose('cancel', reason),
      notes: [...notes, `Show cancelled: ${lowerFirst(reason)}`],
    };
  }

  // 2. The shape.
  const onCard = onCardOf(read, pool, mode);
  const { slots, preShowSlots } = instance.format;
  const talkTotal = talkSlotsFor(
    {
      showName: pool.showName,
      slots,
      importance: pool.importance,
      talkShare: { value: pool.taste.values.talkShare, trace: pool.taste.traces.talkShare },
    },
    { tunables },
  );
  const endsOnMatch = mainEventMustBeMatch(pool.importance);
  const openMain = Math.max(0, slots - onCard.mainCount);
  const talkSlots = Math.min(openMain, Math.max(0, talkTotal.value - onCard.mainTalks));
  const mainMatchSlots = openMain - talkSlots;
  const fillPreShow = tunables.get('aip.card.fillPreShow');
  const preMatchSlots = fillPreShow ? Math.max(0, preShowSlots - onCard.preCount) : 0;
  const capCalc = startCalc(
    'Title matches left tonight',
    titleMatchCapFor(
      { importance: pool.importance, matchSlots: slots - talkTotal.value },
      { tunables },
    ),
    { unit: 'count' },
  );
  capCalc
    .subtract(
      'Already on the card',
      inputOf('Title matches already on the card', onCard.titles.size, undefined, 'count'),
    )
    .min('Open match slots', inputOf('Open match slots', mainMatchSlots, undefined, 'count'))
    .max('Never below 0', 0);
  const cap = capCalc.done();
  plan.include('Talking segments', talkTotal);
  plan.include('Main event must be a match', endsOnMatch);
  plan.include('Title matches left tonight', cap);
  plan.note(
    `${String(openMain)} open main-card slots: ${String(mainMatchSlots)} matches and ${String(talkSlots)} talking; ${String(preMatchSlots)} pre-show matches`,
  );

  // 3. Titles.
  const titlePool: CardPool = {
    ...pool,
    titles: pool.titles.filter((title) => !onCard.titles.has(title.titleId)),
  };
  const fillDeps = { read, tunables, rng };
  const picture = decideTitlePicture(
    titlePool,
    {
      today,
      taste: pool.taste,
      cap,
      alreadyBooked: new Set(onCard.book.appearances.keys()),
    },
    fillDeps,
  );
  plan.include('Title picture', picture.trace);
  notes.push(
    `${plural(talkTotal.value, 'talking segment', 'talking segments')} in ${plural(slots, 'slot', 'slots')}: the booker's talking share for a ${pool.importance} show`,
  );
  if (endsOnMatch.value) {
    notes.push('The main event must be a match');
  }
  notes.push(...titleNotesOf(read, titlePool, picture, today));

  // 4. Storylines, filler matches and talking segments.
  const fill = fillCard(
    pool,
    {
      titles: picture.planned,
      matchSlots: mainMatchSlots + preMatchSlots,
      talkSlots,
      talkRoom: Math.max(0, talkRoomFor(slots, pool.importance) - onCard.mainTalks),
      alreadyBooked: onCard.book,
      storylinesOnCard: onCard.storylines,
    },
    fillDeps,
  );
  plan.include('Filling the card', fill.trace);

  // 5. Scores and order.
  const featured = featuredOf(read, pool, instance);
  const scored = new Map(
    fill.segments.map((segment) => [
      segment.key,
      scoreSegment(read, pool, segment, featured, tunables),
    ]),
  );
  const order = orderCard(
    fill.segments,
    new Map([...scored].map(([key, entry]) => [key, entry.score])),
    {
      slots,
      preShowSlots,
      mainEventMustBeMatch: endsOnMatch.value,
      fixed: onCard.fixed,
      label: `Running order for ${pool.showName}`,
    },
    { tunables },
  );
  plan.include('Running order', order.trace);

  const bySegment = new Map(fill.segments.map((segment) => [segment.key, segment]));
  const placements: PlannedPlacement[] = order.placements.flatMap((placement) => {
    const segment = bySegment.get(placement.segmentKey);
    const entry = scored.get(placement.segmentKey);
    if (segment === undefined || entry === undefined) {
      return [];
    }
    const role = slotRoleOf(slotRoleInput(placement, instance.format), { tunables });
    const label = segment.trace.trace.label;
    const slotTrace = startDecision<string>(
      slotTraceLabel(placement.slot, SLOT_ROLE_LABELS[role.value]),
      { docRef: PLAN_CARD_DOC_REF },
    )
      .include('Slot role', role)
      .include('Why this segment', segment.trace)
      .include('Card score', entry.score)
      .rule(placement.rule, true)
      .choose(label, placement.rule);
    return [
      {
        slot: placement.slot,
        preShow: placement.preShow,
        key: segment.key,
        draft: segment.draft,
        source: segment.source,
        slotTrace,
        cardScore: entry.score.value,
        headline: headlineOf(read, pool, segment, entry, placement.rule, today),
        notes: segmentNotesOf(read, pool, segment, picture.planned),
      },
    ];
  });

  // Slots left empty.
  const taken = new Set([
    ...onCard.fixed.keys(),
    ...placements.map((placement) => slotKeyOf(placement.preShow, placement.slot)),
  ]);
  const reasons = fill.open.map((slot) => slot.reason);
  const open: PlanOpenSlot[] = [];
  const sections: [boolean, number][] = [
    [true, fillPreShow ? preShowSlots : 0],
    [false, slots],
  ];
  for (const [preShow, count] of sections) {
    for (let slot = 0; slot < count; slot++) {
      if (!taken.has(slotKeyOf(preShow, slot))) {
        open.push({ preShow, slot, reason: reasons.shift() ?? NOTHING_LEFT_REASON });
      }
    }
  }
  for (const slot of open) {
    const line = `${slot.preShow ? 'Pre-show slot' : 'Slot'} ${String(slot.slot + 1)} left open: ${slot.reason}`;
    plan.rule(line, false);
    notes.push(line);
  }

  const drafts = placements.map((placement) => placement.draft);
  const counts: PlanCounts = {
    matches: drafts.filter((draft) => draft.kind === 'match').length,
    talking: drafts.filter((draft) => draft.kind === 'angle').length,
    titles: drafts.filter((draft) => titleIdsOf(draft).length > 0).length,
    storyline: placements.filter((placement) => placement.source === 'storyline').length,
  };
  const planTrace = plan.choose(
    'card',
    `${String(placements.length)} segments planned, ${String(open.length)} slots left open`,
  );
  return { kind: 'card', placements, open, planTrace, counts, notes };
}
