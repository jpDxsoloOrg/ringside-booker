/**
 * The booking screen's card view: one show's card, slot by slot, as the editor reads it.
 *
 * Every slot of the format is listed, filled or open. A slot's role, duration class and weight are
 * derived here from its position (and its match type) with MTCH1's helpers on every read, never
 * stored (D-10); each comes with its trace so the screen can explain it. Nothing in the result is a
 * length or a time.
 *
 * The availability chip text lives here too, so every booking screen words WRK1's statuses the
 * same way.
 *
 * Design notes: docs/design/booking.md#queries.
 */

import type { Viewer } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import { diffDays, type GameDate } from '../../core/date';
import type {
  BrandId,
  EventInstanceId,
  PersonId,
  PromotionId,
  SegmentId,
  StorylineId,
  TeamId,
  TitleId,
} from '../../core/ids';
import type { TraceNode } from '../../core/trace/types';
import { matchTypeOf, methodOf, angleTypeOf, type MatchTypeDef } from '../../model/catalogs';
import type { EventImportance } from '../../model/entities/event-definition';
import { promotionStatusKey, type Employment } from '../../model/entities/employment';
import type { EventInstance, EventInstanceStatus } from '../../model/entities/event-instance';
import type { ParticipantRole } from '../../model/entities/participant';
import { settingOf, type Segment, type SegmentKind } from '../../model/entities/segment';
import { settingDurationShifter } from '../match/angles/settings';
import { talkLineOf, talkRoleWithFallback } from '../match/angles/talkLine';
import type { AngleSetting, TalkRole } from '../../model/entities/angle-setting';
import type { ImageRef } from '../../model/primitives';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { viewerControlsShow } from '../calendar/control';
import { shortDayText } from '../match/availabilityText';
import { randomWinnersActive } from '../match/finishes/randomWinners';
import {
  DURATION_CLASS_LABELS,
  durationClassOf,
  SLOT_ROLE_LABELS,
  slotRoleOf,
  slotWeightOf,
  type DurationClass,
  type SlotRole,
} from '../match/slots';
import type { EngineTunables } from '../tunables';
import {
  availabilityOf,
  type Availability,
  type AvailabilityStatus,
} from '../workers/helpers/availability';
import { cardSegments } from './card';
import { editBlockOf } from './control';
import { draftFromSegment, type SegmentDraft } from './draft';

// ---------------------------------------------------------------------------------------------
// Availability chips

/** The chip text for each of WRK1's statuses, when there is no date to add. */
export const AVAILABILITY_LABELS: Readonly<Record<AvailabilityStatus, string>> = {
  available: 'Available',
  injured: 'Injured',
  rehab: 'Rehab',
  personalLeave: 'Personal leave',
  suspended: 'Suspended',
  timeOff: 'Time off',
  notDebuted: 'Not debuted',
  retired: 'Retired',
};

/** WRK1's availability as a booking screen shows it: a short chip and the longer reason. */
export interface AvailabilityView {
  status: AvailabilityStatus;
  /** The chip: "Available", "Injured until 12 Feb", "Rehab". */
  label: string;
  /** WRK1's reason, for the tooltip: "Injured (leg injury); can still do talking segments". */
  reason: string;
  /** The first day back, or null. */
  until: GameDate | null;
  canWorkAngles: boolean;
}

/**
 * The chip text for an availability. Only an injury names its day back ("Injured until 12 Feb");
 * the other statuses stay one or two words and leave the detail to the reason.
 */
export function availabilityLabel(availability: Availability, today: GameDate): string {
  const label = AVAILABILITY_LABELS[availability.status];
  if (availability.status === 'injured' && availability.until !== null) {
    return `${label} until ${shortDayText(availability.until, today)}`;
  }
  return label;
}

export function availabilityView(availability: Availability, today: GameDate): AvailabilityView {
  return {
    status: availability.status,
    label: availabilityLabel(availability, today),
    reason: availability.reason,
    until: availability.until,
    canWorkAngles: availability.canWorkAngles,
  };
}

// ---------------------------------------------------------------------------------------------
// Shared readers

/** "Slot 3" for stored main-card slot 2, "Pre-show slot 1" for stored pre-show slot 0. */
export function slotLabel(preShow: boolean, slot: number): string {
  return preShow ? `Pre-show slot ${String(slot + 1)}` : `Slot ${String(slot + 1)}`;
}

/** The promotion's active contracts, by person. */
export function activeRosterOf(
  read: GameWorldView,
  promotionId: PromotionId,
): Map<PersonId, DeepReadonly<Employment>> {
  return new Map(
    read.tables.employments
      .lookup('byPromotionStatus', promotionStatusKey(promotionId, 'active'))
      .map((employment) => [employment.personId, employment]),
  );
}

/**
 * True when someone contracted to a brand would appear on another brand's show. A show without a
 * brand is promotion-wide, so nobody is from another brand on it.
 */
export function isOtherBrand(brandId: BrandId | null, showBrandId: BrandId | null): boolean {
  return brandId !== null && showBrandId !== null && brandId !== showBrandId;
}

// ---------------------------------------------------------------------------------------------
// The card view

export interface BookingPersonView {
  personId: PersonId;
  /** The ring name on the show's promotion's contract, else the person's default ring name. */
  ringName: string;
  imageRef: ImageRef;
  role: ParticipantRole;
  /** MTCH5-08: the part a speaker plays (their stored part, else the one they were hired for); null for anyone else. */
  talkRole: TalkRole | null;
  /** Availability on the show's date. */
  availability: AvailabilityView;
  otherBrand: boolean;
}

export interface BookingSideView {
  /** The stored side, 0-based. Screens show "Side n+1". */
  side: number;
  /** The team's name when everyone on the side is listed with the same team, else ring names. */
  name: string;
  teamId: TeamId | null;
  people: BookingPersonView[];
}

export interface BookingTitleView {
  titleId: TitleId;
  name: string;
  holderCount: number;
  imageRef: ImageRef;
  /** The current champions, empty while vacant. */
  holderIds: PersonId[];
}

export interface BookingResultView {
  /** `auto` and `random` (MTCH2-08) are left to the night: no side and no method yet. */
  kind: 'win' | 'draw' | 'noContest' | 'auto' | 'random';
  winningSide: number | null;
  methodKey: string | null;
  methodName: string | null;
}

export interface BookingSegmentView {
  segmentId: SegmentId;
  kind: SegmentKind;
  label: string | null;
  /** The match type or angle type key. */
  typeKey: string;
  typeName: string;
  /** Why the match type moves the slot's class ("Battle Royal runs a step longer"), or null. */
  durationShiftNote: string | null;
  titles: BookingTitleView[];
  sides: BookingSideView[];
  /** The planned result before the show, the real one after; null when nothing is planned. */
  result: BookingResultView | null;
  storylineIds: StorylineId[];
  finishKey: string | null;
  stipulationKeys: string[];
  /** The editor's starting point for this segment. */
  draft: SegmentDraft;
  /** MTCH5-08: where it happens; always `ring` for a match. */
  setting: AngleSetting;
  /**
   * MTCH5-08: who did what and where, "Backstage: Lena Park interviews Kai Moreno (with Victor
   * Crane)"; null for a match and for a ring segment of wrestlers only.
   */
  talkLine: string | null;
}

export interface BookingSlotView {
  /** Stored slot, 0-based within its section. */
  slot: number;
  /** What the player reads: `slot + 1`. */
  displayNumber: number;
  preShow: boolean;
  role: SlotRole;
  roleLabel: string;
  durationClass: DurationClass;
  durationLabel: string;
  weight: number;
  roleTrace: TraceNode;
  durationTrace: TraceNode;
  weightTrace: TraceNode;
  /** Null for an open slot. */
  segment: BookingSegmentView | null;
}

export interface BookingSectionView {
  preShow: boolean;
  slots: BookingSlotView[];
}

export interface BookingTitleOption {
  titleId: TitleId;
  name: string;
  holderCount: number;
  brandId: BrandId | null;
  /** True when the title belongs to another brand than the show's. */
  otherBrand: boolean;
  imageRef: ImageRef;
  holderIds: PersonId[];
  holderNames: string[];
  vacant: boolean;
}

export interface BookingShowView {
  eventInstanceId: EventInstanceId;
  name: string;
  date: GameDate;
  airDate: GameDate;
  importance: EventImportance;
  promotionId: PromotionId;
  brandId: BrandId | null;
  brandName: string | null;
  status: EventInstanceStatus;
  isToday: boolean;
  /** 0 on the show's day; negative once it has passed. */
  daysUntil: number;
  format: { slots: number; preShowSlots: number };
}

/** `booking.card`: one show's card as the booking screen reads it. */
export interface BookingCard {
  show: BookingShowView;
  /** True when the viewer runs the show and the card can still change. */
  canEdit: boolean;
  /** Why the card cannot change (whoever asks), or null. */
  editBlock: Reason | null;
  /**
   * True on the show's day while it has not run and the viewer runs it: the show screen offers
   * Run the show (`shows.runTonight`). There is no lock (EVT2-09).
   */
  runsTonight: boolean;
  /**
   * True when Random winners decides this show's results (MTCH2's `randomWinnersActive`): nothing
   * is planned, and the editor says "Decided on the night (Random winners)".
   */
  randomWinners: boolean;
  /** The pre-show first when the show has one, then the main card. */
  sections: BookingSectionView[];
  /** The promotion's active titles, by prestige, for the editor's titles field. */
  titleOptions: BookingTitleOption[];
}

export interface CardViewDeps {
  readonly viewer: DeepReadonly<Viewer>;
  readonly tunables: EngineTunables;
}

/** Reads ring names, availability and brands for one show. Built once per query. */
export interface ShowPeople {
  readonly roster: ReadonlyMap<PersonId, DeepReadonly<Employment>>;
  ringName(personId: PersonId): string;
  availability(personId: PersonId): Availability;
}

export function showPeople(read: GameWorldView, instance: DeepReadonly<EventInstance>): ShowPeople {
  const roster = activeRosterOf(read, instance.promotionId);
  return {
    roster,
    ringName(personId) {
      return (
        roster.get(personId)?.ringName ??
        read.tables.people.get(personId)?.defaultRingName ??
        personId
      );
    },
    availability(personId) {
      const person = read.tables.people.get(personId);
      if (person === undefined) {
        return {
          status: 'retired',
          reason: 'No longer in the game',
          until: null,
          canWorkAngles: false,
        };
      }
      return availabilityOf(person, roster.get(personId) ?? null, instance.date);
    },
  };
}

function holderIdsOf(read: GameWorldView, titleId: TitleId): PersonId[] {
  const reign = read.tables.titleReigns.lookupOne('openByTitle', titleId);
  return reign === undefined ? [] : [...reign.holderIds];
}

function durationShiftNoteOf(matchType: DeepReadonly<MatchTypeDef> | null): string | null {
  if (matchType === null || matchType.durationShift === 0) {
    return null;
  }
  return matchType.durationShift > 0
    ? `${matchType.name} runs a step longer than its slot`
    : `${matchType.name} runs a step shorter than its slot`;
}

function resultOf(read: GameWorldView, segment: DeepReadonly<Segment>): BookingResultView | null {
  if (segment.kind !== 'match') {
    return null;
  }
  const { outcome } = segment;
  if (outcome === null) {
    const plan = segment.match.resultPlan;
    return plan === undefined
      ? null
      : { kind: plan, winningSide: null, methodKey: null, methodName: null };
  }
  if (outcome.kind !== 'win') {
    return { kind: outcome.kind, winningSide: null, methodKey: null, methodName: null };
  }
  return {
    kind: 'win',
    winningSide: outcome.winningSide,
    methodKey: outcome.methodKey,
    methodName: methodOf(read, outcome.methodKey)?.name ?? outcome.methodKey,
  };
}

function sidesOf(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  people: ShowPeople,
  segmentId: SegmentId,
): BookingSideView[] {
  const participants = [...read.tables.participants.lookup('bySegment', segmentId)].sort(
    (left, right) => left.side - right.side || compareIds(left.personId, right.personId),
  );
  const sides: BookingSideView[] = [];
  const teams: (TeamId | null)[][] = [];
  for (const participant of participants) {
    let current = sides.at(-1);
    if (current?.side !== participant.side) {
      current = { side: participant.side, name: '', teamId: null, people: [] };
      sides.push(current);
      teams.push([]);
    }
    teams.at(-1)?.push(participant.teamId);
    const person = read.tables.people.get(participant.personId);
    current.people.push({
      personId: participant.personId,
      ringName: people.ringName(participant.personId),
      imageRef: person?.imageRef ?? null,
      role: participant.role,
      talkRole:
        participant.role === 'speaker'
          ? talkRoleWithFallback(participant, people.roster.get(participant.personId))
          : null,
      availability: availabilityView(people.availability(participant.personId), instance.date),
      otherBrand: isOtherBrand(
        people.roster.get(participant.personId)?.brandId ?? null,
        instance.brandId,
      ),
    });
  }
  sides.forEach((side, index) => {
    const [first, ...rest] = teams[index] ?? [];
    const sharedTeam =
      first !== undefined && first !== null && rest.every((teamId) => teamId === first)
        ? first
        : null;
    const team = sharedTeam === null ? undefined : read.tables.teams.get(sharedTeam);
    side.teamId = team === undefined ? null : team.id;
    side.name = team?.name ?? side.people.map((person) => person.ringName).join(' & ');
  });
  return sides;
}

function segmentViewOf(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  people: ShowPeople,
  segment: DeepReadonly<Segment>,
  matchType: DeepReadonly<MatchTypeDef> | null,
): BookingSegmentView {
  const isMatch = segment.kind === 'match';
  const typeKey = isMatch ? segment.match.matchTypeKey : segment.angle.angleTypeKey;
  const typeName = isMatch
    ? (matchType?.name ?? typeKey)
    : (angleTypeOf(read, typeKey)?.name ?? typeKey);
  const titles: BookingTitleView[] = isMatch
    ? segment.match.titleIds.flatMap((titleId) => {
        const title = read.tables.titles.get(titleId);
        return title === undefined
          ? []
          : [
              {
                titleId,
                name: title.name,
                holderCount: title.holderCount,
                imageRef: title.imageRef,
                holderIds: holderIdsOf(read, titleId),
              },
            ];
      })
    : [];
  return {
    segmentId: segment.id,
    kind: segment.kind,
    label: segment.label,
    typeKey,
    typeName,
    durationShiftNote: durationShiftNoteOf(matchType),
    titles,
    sides: sidesOf(read, instance, people, segment.id),
    result: resultOf(read, segment),
    storylineIds: [...segment.storylineIds],
    finishKey: isMatch ? segment.match.finishKey : null,
    stipulationKeys: isMatch ? [...segment.match.stipulationKeys] : [],
    draft: draftFromSegment(read, segment.id),
    setting: settingOf(segment),
    talkLine: talkLineOf(read, segment, people),
  };
}

function slotViewOf(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  people: ShowPeople,
  deps: CardViewDeps,
  preShow: boolean,
  slot: number,
  segment: DeepReadonly<Segment> | undefined,
): BookingSlotView {
  const slotDeps = { tunables: deps.tunables };
  // Storage is 0-based and MTCH1's slots are 1-based. This is the one place the two meet.
  const role = slotRoleOf({ slot: slot + 1, slots: instance.format.slots, preShow }, slotDeps);
  const matchType =
    segment?.kind === 'match' ? (matchTypeOf(read, segment.match.matchTypeKey) ?? null) : null;
  // MTCH5-08: a backstage or pre-taped talking segment moves the class by its setting.
  const shifter =
    segment?.kind === 'angle'
      ? settingDurationShifter(settingOf(segment), deps.tunables)
      : matchType;
  const duration = durationClassOf({ role: role.value, matchType: shifter }, slotDeps);
  const weight = slotWeightOf({ role: role.value }, slotDeps);
  return {
    slot,
    displayNumber: slot + 1,
    preShow,
    role: role.value,
    roleLabel: SLOT_ROLE_LABELS[role.value],
    durationClass: duration.value,
    durationLabel: DURATION_CLASS_LABELS[duration.value],
    weight: weight.value,
    roleTrace: role.trace,
    durationTrace: duration.trace,
    weightTrace: weight.trace,
    segment:
      segment === undefined ? null : segmentViewOf(read, instance, people, segment, matchType),
  };
}

function titleOptionsOf(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  people: ShowPeople,
): BookingTitleOption[] {
  return read.tables.titles
    .lookup('byPromotion', instance.promotionId)
    .filter((title) => title.status === 'active')
    .sort((left, right) => right.prestige - left.prestige || compareIds(left.id, right.id))
    .map((title) => {
      const holderIds = holderIdsOf(read, title.id);
      return {
        titleId: title.id,
        name: title.name,
        holderCount: title.holderCount,
        brandId: title.brandId,
        otherBrand: isOtherBrand(title.brandId, instance.brandId),
        imageRef: title.imageRef,
        holderIds,
        holderNames: holderIds.map((personId) => people.ringName(personId)),
        vacant: holderIds.length === 0,
      };
    });
}

/**
 * The card view of `instance` on `today` for `deps.viewer`. Who may read it is the caller's
 * question (`canReadCard`); this only builds it.
 */
export function buildCardView(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  today: GameDate,
  deps: CardViewDeps,
): BookingCard {
  const people = showPeople(read, instance);
  const bySection = new Map<string, DeepReadonly<Segment>>();
  for (const segment of cardSegments(read, instance.id)) {
    bySection.set(`${String(segment.preShow)}|${String(segment.slot)}`, segment);
  }
  const sectionOf = (preShow: boolean, count: number): BookingSectionView => ({
    preShow,
    slots: Array.from({ length: count }, (_unused, slot) =>
      slotViewOf(
        read,
        instance,
        people,
        deps,
        preShow,
        slot,
        bySection.get(`${String(preShow)}|${String(slot)}`),
      ),
    ),
  });
  const sections: BookingSectionView[] = [];
  if (instance.format.preShowSlots > 0) {
    sections.push(sectionOf(true, instance.format.preShowSlots));
  }
  sections.push(sectionOf(false, instance.format.slots));

  const editBlock = editBlockOf(read, instance, today);
  const canEdit = editBlock === null && viewerControlsShow(read, instance, deps.viewer);
  const brand = instance.brandId === null ? undefined : read.tables.brands.get(instance.brandId);
  return {
    show: {
      eventInstanceId: instance.id,
      name: instance.name,
      date: instance.date,
      airDate: instance.airDate,
      importance: instance.importance,
      promotionId: instance.promotionId,
      brandId: instance.brandId,
      brandName: brand?.name ?? null,
      status: instance.status,
      isToday: instance.date === today,
      daysUntil: diffDays(today, instance.date),
      format: { slots: instance.format.slots, preShowSlots: instance.format.preShowSlots },
    },
    canEdit,
    editBlock,
    runsTonight: canEdit && instance.date === today,
    randomWinners: randomWinnersActive(read, {
      promotionId: instance.promotionId,
      brandId: instance.brandId,
    }),
    sections,
    titleOptions: titleOptionsOf(read, instance, people),
  };
}
