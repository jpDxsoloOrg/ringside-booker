/**
 * `aip.showCards`: a promotion's recent and upcoming shows with their cards, slot by slot, for the
 * promotion profile's Shows tab (AIP4-06).
 *
 * A row's card is shown only when `isRevealedTo` (the decision log's one reveal rule) says the
 * viewer may see it, with `revealOn` = the show's air date: always for the promotion's own
 * controller, a sandbox game and the all-seeing viewer, and for anyone else once the air date has
 * been simulated. So a rival's card and its `card` decision always reveal together. A hidden row
 * keeps only what the calendar already shows (name, dates, status) and says "Card is revealed when
 * the show airs": no slots, no segment count, no plan, no score, no planner's reason.
 *
 * Nothing here is a length or a time. Design: docs/design/rival-booking.md#show-cards.
 */

import { z } from 'zod';
import type { Viewer } from '../../../core/api/controller';
import { defineQuery, type QueryDefinition, type TraceReader } from '../../../core/api/query';
import { compareDates, isBefore, type GameDate } from '../../../core/date';
import type {
  EventInstanceId,
  PersonId,
  PromotionId,
  SegmentId,
  StorylineId,
  TeamId,
  TitleId,
} from '../../../core/ids';
import type { TraceRef } from '../../../core/trace/store';
import { aiDecisionDateKey } from '../../../model/entities/ai-decision';
import { angleTypeOf, matchTypeOf } from '../../../model/catalogs';
import type { EventImportance } from '../../../model/entities/event-definition';
import type {
  CancellationReason,
  EventInstance,
  EventInstanceStatus,
} from '../../../model/entities/event-instance';
import type { Segment, SegmentKind } from '../../../model/entities/segment';
import type { ImageRef } from '../../../model/primitives';
import { zId } from '../../../model/primitives';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { cardSegments } from '../../booking/card';
import { showPeople, type ShowPeople } from '../../booking/view';
import { SLOT_ROLE_LABELS, slotRoleOf, type SlotRole } from '../../match/slots';
import type { EngineTunables } from '../../tunables';
import { promotionOrRefuse } from '../queries/shared';
import { isRevealedTo } from '../reveal';
import {
  CARD_DECISION_KIND,
  CARD_PLAN_TRACE_KIND,
  CARD_SLOT_TRACE_KIND,
  SHOW_CANCELLED_SUMMARY_KEY,
} from './bookShowJob';

export const DEFAULT_PAST_SHOWS = 10;
export const MAX_PAST_SHOWS = 30;
export const DEFAULT_UPCOMING_SHOWS = 4;
export const MAX_UPCOMING_SHOWS = 10;
export const CARD_HIDDEN_TEXT = 'Card is revealed when the show airs';

/** What a show's status reads on the Shows tab. */
export const SHOW_CARD_STATUS_LABELS = [
  'Coming up',
  'Booked',
  'Completed',
  'Not run',
  'Cancelled',
] as const;
export type ShowCardStatusLabel = (typeof SHOW_CARD_STATUS_LABELS)[number];

/** EVT1's cancellation reasons in words, when the planner left no reason of its own. */
export const CANCELLATION_REASON_TEXT: Readonly<Record<CancellationReason, string>> = {
  notRun: 'Its day passed before it was run',
  byPromotion: 'Called off by the promotion',
};

export interface ShowCardsArgs {
  promotionId: PromotionId;
  /** Shows before today, newest first: 1 to 30; left out, 10. */
  past?: number | undefined;
  /** Shows today or later, soonest first: 0 to 10; left out, 4. */
  upcoming?: number | undefined;
}

export interface ShowCardPerson {
  personId: PersonId;
  /** The ring name on the show's promotion's contract, else the default ring name. */
  name: string;
  imageRef: ImageRef;
}

export interface ShowCardSide {
  /** The team's name when the whole side is one team, else ring names joined with " & ". */
  name: string;
  teamId: TeamId | null;
  /** True when the side held one of the match's titles going into the show. */
  isChampions: boolean;
  people: ShowCardPerson[];
}

export interface ShowCardSegment {
  segmentId: SegmentId;
  kind: SegmentKind;
  /** The match or talking segment type's name. */
  typeName: string;
  /** The segment's own label, else its matchup ("Ace vs Rookie"). */
  label: string;
  sides: ShowCardSide[];
  titles: { titleId: TitleId; name: string; imageRef: ImageRef }[];
  storylines: { storylineId: StorylineId; name: string }[];
  /** The planned result before the show, the real one after; null when there is none. */
  outcome: { kind: 'win' | 'draw' | 'noContest'; winningSide: number | null } | null;
  /** The booker's short Why? for the slot, while it is kept. */
  reasonTraceRef: TraceRef | null;
}

export interface ShowCardSlot {
  /** The stored slot + 1. */
  displayNumber: number;
  preShow: boolean;
  role: SlotRole;
  roleLabel: string;
  /** Null for an open main-card slot. */
  segment: ShowCardSegment | null;
}

export interface ShowCardRow {
  eventInstanceId: EventInstanceId;
  name: string;
  date: GameDate;
  airDate: GameDate;
  importance: EventImportance;
  brandName: string | null;
  status: EventInstanceStatus;
  statusLabel: ShowCardStatusLabel;
  /** True when the viewer may see the card. */
  revealed: boolean;
  /** "Card is revealed when the show airs" on a hidden row, else null. */
  hiddenText: string | null;
  /** Why a cancelled show did not happen: the planner's reason once revealed, else EVT1's. */
  cancelledReason: string | null;
  /** The rival plan's Why? (`aip.cardPlan`), when revealed and kept. */
  planTraceRef: TraceRef | null;
  /** EVT3's show score once the show has run (and is revealed). */
  score: number | null;
  /** Running order: filled pre-show slots, then every main-card slot. Empty when hidden. */
  slots: ShowCardSlot[];
}

export interface ShowCards {
  promotion: { id: PromotionId; name: string; shortName: string };
  rows: ShowCardRow[];
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'aip.showCards': { args: ShowCardsArgs; result: ShowCards };
  }
}

type Show = DeepReadonly<EventInstance>;

function statusLabelOf(show: Show, today: GameDate): ShowCardStatusLabel {
  switch (show.status) {
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return show.cancellation?.reason === 'notRun' ? 'Not run' : 'Cancelled';
    case 'booked':
    case 'scheduled':
      // A show whose day has passed without running (before the day's close shuts it).
      if (isBefore(show.date, today)) {
        return 'Not run';
      }
      return show.status === 'booked' ? 'Booked' : 'Coming up';
  }
}

/** The planner's reason, from the show's `card` decision, while the log still holds it. */
function plannerReasonOf(read: GameWorldView, show: Show): string | null {
  if (show.cancellation === null) {
    return null;
  }
  const decision = read.tables.aiDecisions
    .lookup('byPromotionDate', aiDecisionDateKey(show.promotionId, show.cancellation.on))
    .find(
      (row) =>
        row.kind === CARD_DECISION_KIND &&
        row.refs.eventInstanceId === show.id &&
        row.summary.key === SHOW_CANCELLED_SUMMARY_KEY,
    );
  const reason = decision?.summary.params['reason'];
  return reason === undefined ? null : String(reason);
}

function cancelledReasonOf(read: GameWorldView, show: Show, revealed: boolean): string | null {
  if (show.cancellation === null) {
    return null;
  }
  const planner = revealed ? plannerReasonOf(read, show) : null;
  return planner ?? CANCELLATION_REASON_TEXT[show.cancellation.reason];
}

function kept(traces: TraceReader, ref: TraceRef): TraceRef | null {
  return traces.has(ref) ? ref : null;
}

/** Everyone who held one of `titleIds` going into `date`. */
function championsOn(
  read: GameWorldView,
  titleIds: readonly TitleId[],
  date: GameDate,
): Set<PersonId> {
  const champions = new Set<PersonId>();
  for (const titleId of titleIds) {
    for (const reign of read.tables.titleReigns.lookup('byTitle', titleId)) {
      const wonBefore = isBefore(reign.wonOn, date);
      const heldThrough = reign.lostOn === null || compareDates(reign.lostOn, date) >= 0;
      if (wonBefore && heldThrough) {
        reign.holderIds.forEach((personId) => champions.add(personId));
      }
    }
  }
  return champions;
}

function sidesOf(
  read: GameWorldView,
  people: ShowPeople,
  segment: DeepReadonly<Segment>,
  champions: ReadonlySet<PersonId>,
): ShowCardSide[] {
  const participants = [...read.tables.participants.lookup('bySegment', segment.id)].sort(
    (left, right) => left.side - right.side || compareIds(left.personId, right.personId),
  );
  const bySide = new Map<number, (typeof participants)[number][]>();
  for (const participant of participants) {
    const list = bySide.get(participant.side) ?? [];
    list.push(participant);
    bySide.set(participant.side, list);
  }
  return [...bySide.values()].map((members) => {
    const [first, ...rest] = members.map((member) => member.teamId);
    const sharedTeam =
      first !== undefined && first !== null && rest.every((teamId) => teamId === first)
        ? first
        : null;
    const team = sharedTeam === null ? undefined : read.tables.teams.get(sharedTeam);
    const sidePeople: ShowCardPerson[] = members.map((member) => ({
      personId: member.personId,
      name: people.ringName(member.personId),
      imageRef: read.tables.people.get(member.personId)?.imageRef ?? null,
    }));
    return {
      name: team?.name ?? sidePeople.map((person) => person.name).join(' & '),
      teamId: team === undefined ? null : team.id,
      isChampions: champions.size > 0 && members.some((member) => champions.has(member.personId)),
      people: sidePeople,
    };
  });
}

function segmentOf(
  read: GameWorldView,
  traces: TraceReader,
  show: Show,
  people: ShowPeople,
  segment: DeepReadonly<Segment>,
): ShowCardSegment {
  const isMatch = segment.kind === 'match';
  const typeKey = isMatch ? segment.match.matchTypeKey : segment.angle.angleTypeKey;
  const typeName = isMatch
    ? (matchTypeOf(read, typeKey)?.name ?? typeKey)
    : (angleTypeOf(read, typeKey)?.name ?? typeKey);
  const titleIds = isMatch ? segment.match.titleIds : [];
  const sides = sidesOf(read, people, segment, championsOn(read, titleIds, show.date));
  const matchup = sides.map((side) => side.name).join(isMatch ? ' vs ' : ' & ');
  return {
    segmentId: segment.id,
    kind: segment.kind,
    typeName,
    label: segment.label ?? (matchup === '' ? typeName : matchup),
    sides,
    titles: titleIds.flatMap((titleId) => {
      const title = read.tables.titles.get(titleId);
      return title === undefined ? [] : [{ titleId, name: title.name, imageRef: title.imageRef }];
    }),
    storylines: segment.storylineIds.flatMap((storylineId) => {
      const storyline = read.tables.storylines.get(storylineId);
      return storyline === undefined ? [] : [{ storylineId, name: storyline.name }];
    }),
    outcome:
      isMatch && segment.outcome !== null
        ? {
            kind: segment.outcome.kind,
            winningSide: segment.outcome.kind === 'win' ? segment.outcome.winningSide : null,
          }
        : null,
    reasonTraceRef: kept(traces, { kind: CARD_SLOT_TRACE_KIND, id: segment.id }),
  };
}

function slotsOf(
  read: GameWorldView,
  traces: TraceReader,
  tunables: EngineTunables,
  show: Show,
): ShowCardSlot[] {
  const people = showPeople(read, show);
  const segments = cardSegments(read, show.id);
  const slot = (preShow: boolean, index: number, segment: DeepReadonly<Segment> | undefined) => {
    const role = slotRoleOf(
      { slot: index + 1, slots: show.format.slots, preShow },
      { tunables },
    ).value;
    return {
      displayNumber: index + 1,
      preShow,
      role,
      roleLabel: SLOT_ROLE_LABELS[role],
      segment: segment === undefined ? null : segmentOf(read, traces, show, people, segment),
    };
  };
  const preShow = segments
    .filter((segment) => segment.preShow)
    .sort((left, right) => left.slot - right.slot)
    .map((segment) => slot(true, segment.slot, segment));
  const main = new Map(
    segments.filter((segment) => !segment.preShow).map((segment) => [segment.slot, segment]),
  );
  const mainSlots = Array.from({ length: show.format.slots }, (_unused, index) =>
    slot(false, index, main.get(index)),
  );
  return [...preShow, ...mainSlots];
}

function rowOf(
  read: GameWorldView,
  viewer: Viewer,
  traces: TraceReader,
  tunables: EngineTunables,
  show: Show,
): ShowCardRow {
  const revealed = isRevealedTo(read, viewer, show.promotionId, show.airDate);
  const brand = show.brandId === null ? undefined : read.tables.brands.get(show.brandId);
  return {
    eventInstanceId: show.id,
    name: show.name,
    date: show.date,
    airDate: show.airDate,
    importance: show.importance,
    brandName: brand?.name ?? null,
    status: show.status,
    statusLabel: statusLabelOf(show, read.meta.currentDate),
    revealed,
    hiddenText: revealed ? null : CARD_HIDDEN_TEXT,
    cancelledReason: cancelledReasonOf(read, show, revealed),
    planTraceRef: revealed ? kept(traces, { kind: CARD_PLAN_TRACE_KIND, id: show.id }) : null,
    score: revealed ? (show.result?.score ?? null) : null,
    slots: revealed && show.status !== 'cancelled' ? slotsOf(read, traces, tunables, show) : [],
  };
}

export const aipShowCardsQuery: QueryDefinition<'aip.showCards'> = defineQuery('aip.showCards', {
  args: z.strictObject({
    promotionId: zId('promotion'),
    past: z.number().int().min(1).max(MAX_PAST_SHOWS).optional(),
    upcoming: z.number().int().min(0).max(MAX_UPCOMING_SHOWS).optional(),
  }),
  run: (ctx, args) => {
    const { read } = ctx;
    const promotion = promotionOrRefuse(read, args.promotionId);
    const today = read.meta.currentDate;
    const shows = read.tables.eventInstances.lookup('byPromotion', promotion.id);
    const past = shows
      .filter((show) => isBefore(show.date, today))
      .sort((left, right) => compareDates(right.date, left.date) || compareIds(left.id, right.id))
      .slice(0, args.past ?? DEFAULT_PAST_SHOWS);
    const upcoming = shows
      .filter((show) => !isBefore(show.date, today))
      .sort((left, right) => compareDates(left.date, right.date) || compareIds(left.id, right.id))
      .slice(0, args.upcoming ?? DEFAULT_UPCOMING_SHOWS);
    return {
      promotion: { id: promotion.id, name: promotion.name, shortName: promotion.shortName },
      rows: [...past, ...upcoming].map((show) =>
        rowOf(read, ctx.viewer, ctx.traces, ctx.tunables, show),
      ),
    };
  },
});
