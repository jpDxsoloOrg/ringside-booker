/**
 * The booking screen's queries.
 *
 * - `booking.shows`: the shows the viewer can book, from today on.
 * - `booking.card`: one show's card, slot by slot, with the derived roles (`view.ts`).
 * - `booking.availableWorkers`: who can go on a show's card, with an availability chip each.
 * - `booking.validate` (EVT2-04): everything wrong with a card, the same answer Lock enforces.
 *
 * Cards are private while they are being booked: only the show's controller (or the omniscient
 * viewer of tools and tests) reads `booking.card` and `booking.availableWorkers`. A rival's card
 * becomes public only after it airs, through the results queries.
 *
 * Design notes: docs/design/booking.md#queries.
 */

import { z } from 'zod';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../core/api/query';
import { refuseQuery } from '../../core/api/result';
import { compareDates, type GameDate } from '../../core/date';
import type {
  BrandId,
  EventInstanceId,
  PersonId,
  RegionId,
  SegmentId,
  TeamId,
} from '../../core/ids';
import { matchTypesOf } from '../../model/catalogs';
import type { EventImportance } from '../../model/entities/event-definition';
import {
  PUSH_LEVELS,
  type Alignment,
  type EmploymentRole,
  type Push,
} from '../../model/entities/employment';
import type { EventInstance, EventInstanceStatus } from '../../model/entities/event-instance';
import type { Gender, PersonRole, RingStyle } from '../../model/entities/person';
import type { TeamKind } from '../../model/entities/team';
import { zId } from '../../model/primitives';
import { compareIds } from '../../model/table';
import type { DeepReadonly } from '../../model/world';
import { viewerControlsShow } from '../calendar/control';
import { cardSegments } from './card';
import { canReadCard } from './control';
import type { BookingValidation } from './validate/types';
import { validateCard } from './validate/validateCard';
import {
  availabilityView,
  buildCardView,
  showPeople,
  slotLabel,
  isOtherBrand,
  type AvailabilityView,
  type BookingCard,
} from './view';

/** The kinds of segment a worker can be picked for. */
export const WORKER_PICK_KINDS = ['match', 'angle'] as const;
export type WorkerPickKind = (typeof WORKER_PICK_KINDS)[number];

/** The most shows `booking.shows` lists at once, and how many it lists when not told. */
export const MAX_BOOKING_SHOWS = 60;
export const DEFAULT_BOOKING_SHOWS = 20;
/** The longest search text `booking.availableWorkers` takes. */
export const MAX_WORKER_SEARCH = 60;

/** What the screen says when the save cannot book shows at all. */
export const BOOKING_UNAVAILABLE_REASON =
  'This save was made before shows could be booked. Start a new game to book shows.';

/** One show on the booking screen's list. */
export interface BookingShowRow {
  eventInstanceId: EventInstanceId;
  name: string;
  date: GameDate;
  importance: EventImportance;
  brandName: string | null;
  status: EventInstanceStatus;
  /** Segments booked on the main card. */
  filledMain: number;
  slots: number;
  /** Segments booked on the pre-show. */
  filledPreShow: number;
  preShowSlots: number;
  /** True on the show's day while it has not run: Next Day stops for it ("Tonight"). */
  needsBooking: boolean;
}

/** `booking.shows`. */
export interface BookingShowsView {
  rows: BookingShowRow[];
  /** The first show still waiting for a locked card, or null. */
  nextToBookId: EventInstanceId | null;
  /** False on a save that cannot book shows (no shows or no match types at all). */
  available: boolean;
  /** Why `available` is false, for the player; null when it is true. */
  unavailableReason: string | null;
}

/** One person `booking.availableWorkers` lists. */
export interface AvailableWorkerRow {
  personId: PersonId;
  ringName: string;
  imageRef: string | null;
  gender: Gender;
  roles: PersonRole[];
  /** The role they were hired in. */
  employmentRole: EmploymentRole;
  push: Push;
  alignment: Alignment;
  brandId: BrandId | null;
  brandName: string | null;
  /** True when their contract is with another brand than the show's. */
  otherBrand: boolean;
  /** Availability on the show's date. */
  availability: AvailabilityView;
  /** For a match: available. For an angle: able to work talking segments. */
  bookable: boolean;
  /** Where they already are on this card. */
  onCard: { segmentId: SegmentId; slotLabel: string }[];
  appearancesThisYear: number;
  /** Null when the contract has no cap. */
  appearanceCap: number | null;
  /** Their ring style ("High flyer" through `STYLE_LABELS`); `nonWrestler` for most non-wrestlers. */
  style: RingStyle;
  /**
   * Popularity in the show's region: the stored `regionalPop[show.regionId]`, 0 when absent. Not
   * rounded; screens round for display.
   */
  popularity: number;
  /** The in-ring `stamina` attribute (0-100), not rounded. Fatigue (WRK6) is not on the row yet. */
  stamina: number;
}

/** One team `booking.availableWorkers` lists. */
export interface AvailableTeamRow {
  teamId: TeamId;
  name: string;
  kind: TeamKind;
  memberIds: PersonId[];
  /** True when every member is bookable for the kind of segment. */
  bookable: boolean;
}

/** `booking.availableWorkers`. */
export interface AvailableWorkersView {
  /** The show's region, which every row's `popularity` is measured in. */
  region: { regionId: RegionId; name: string };
  people: AvailableWorkerRow[];
  teams: AvailableTeamRow[];
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'booking.shows': { args: { limit?: number | undefined }; result: BookingShowsView };
    'booking.card': { args: { eventInstanceId: EventInstanceId }; result: BookingCard };
    'booking.availableWorkers': {
      args: {
        eventInstanceId: EventInstanceId;
        kind: WorkerPickKind;
        search?: string | undefined;
      };
      result: AvailableWorkersView;
    };
    'booking.validate': { args: { eventInstanceId: EventInstanceId }; result: BookingValidation };
  }
}

/** The statuses of a show that can still be booked or is waiting to run. */
const OPEN_STATUSES = ['scheduled', 'booked'] as const;

/** The employment roles each kind of segment picks from. */
const PICK_ROLES: Readonly<Record<WorkerPickKind, readonly EmploymentRole[]>> = {
  match: ['wrestler'],
  angle: ['wrestler', 'manager', 'presenter'],
};

/**
 * The show `eventInstanceId`, refused with `showNotFound` when there is none and `notYourShow`
 * when the viewer may not read its card.
 */
function readableShow(
  ctx: QueryContext,
  eventInstanceId: EventInstanceId,
): DeepReadonly<EventInstance> {
  const instance = ctx.read.tables.eventInstances.get(eventInstanceId);
  if (instance === undefined) {
    return refuseQuery({ code: 'showNotFound', message: "That show doesn't exist" });
  }
  if (!canReadCard(ctx.read, ctx.viewer, instance)) {
    return refuseQuery({
      code: 'notYourShow',
      message: `${instance.name} isn't one of your shows`,
      subject: { kind: 'eventInstance', id: instance.id },
    });
  }
  return instance;
}

export const cardQuery: QueryDefinition<'booking.card'> = defineQuery('booking.card', {
  args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
  run: (ctx, args) => {
    const instance = readableShow(ctx, args.eventInstanceId);
    return buildCardView(ctx.read, instance, ctx.date, {
      viewer: ctx.viewer,
      tunables: ctx.tunables,
    });
  },
});

function showRowOf(ctx: QueryContext, instance: DeepReadonly<EventInstance>): BookingShowRow {
  const segments = cardSegments(ctx.read, instance.id);
  const filledPreShow = segments.filter((segment) => segment.preShow).length;
  const brand =
    instance.brandId === null ? undefined : ctx.read.tables.brands.get(instance.brandId);
  return {
    eventInstanceId: instance.id,
    name: instance.name,
    date: instance.date,
    importance: instance.importance,
    brandName: brand?.name ?? null,
    status: instance.status,
    filledMain: segments.length - filledPreShow,
    slots: instance.format.slots,
    filledPreShow,
    preShowSlots: instance.format.preShowSlots,
    needsBooking: instance.date === ctx.date,
  };
}

export const showsQuery: QueryDefinition<'booking.shows'> = defineQuery('booking.shows', {
  args: z.strictObject({
    limit: z.number().int().min(1).max(MAX_BOOKING_SHOWS).optional(),
  }),
  run: (ctx, args) => {
    const available = ctx.read.tables.eventInstances.size > 0 && matchTypesOf(ctx.read).length > 0;
    // The open shows are at most the calendar's horizon, so reading them by status is cheap. Each
    // is kept when the viewer runs it, which honours a brand with a controller of its own.
    const shows: DeepReadonly<EventInstance>[] = [];
    for (const status of OPEN_STATUSES) {
      for (const instance of ctx.read.tables.eventInstances.lookup('byStatus', status)) {
        if (
          compareDates(instance.date, ctx.date) >= 0 &&
          viewerControlsShow(ctx.read, instance, ctx.viewer)
        ) {
          shows.push(instance);
        }
      }
    }
    shows.sort(
      (left, right) => compareDates(left.date, right.date) || compareIds(left.id, right.id),
    );
    const nextToBook = shows.find((instance) => instance.status === 'scheduled');
    return {
      rows: shows
        .slice(0, args.limit ?? DEFAULT_BOOKING_SHOWS)
        .map((instance) => showRowOf(ctx, instance)),
      nextToBookId: nextToBook?.id ?? null,
      available,
      unavailableReason: available ? null : BOOKING_UNAVAILABLE_REASON,
    };
  },
});

function pushRank(push: Push): number {
  return PUSH_LEVELS.indexOf(push);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export const availableWorkersQuery: QueryDefinition<'booking.availableWorkers'> = defineQuery(
  'booking.availableWorkers',
  {
    args: z.strictObject({
      eventInstanceId: zId('eventInstance'),
      kind: z.enum(WORKER_PICK_KINDS),
      search: z.string().max(MAX_WORKER_SEARCH).optional(),
    }),
    run: (ctx, args) => {
      const { read } = ctx;
      const instance = readableShow(ctx, args.eventInstanceId);
      const people = showPeople(read, instance);
      const roles = PICK_ROLES[args.kind];
      const needle = (args.search ?? '').trim().toLowerCase();

      // Where each person already is on this card.
      const onCard = new Map<PersonId, AvailableWorkerRow['onCard']>();
      for (const segment of cardSegments(read, instance.id)) {
        for (const participant of read.tables.participants.lookup('bySegment', segment.id)) {
          const list = onCard.get(participant.personId) ?? [];
          list.push({ segmentId: segment.id, slotLabel: slotLabel(segment.preShow, segment.slot) });
          onCard.set(participant.personId, list);
        }
      }

      const bookableOf = (personId: PersonId): boolean => {
        const availability = people.availability(personId);
        return args.kind === 'match'
          ? availability.status === 'available'
          : availability.canWorkAngles;
      };
      const matchesSearch = (personId: PersonId): boolean => {
        if (needle === '') {
          return true;
        }
        const person = read.tables.people.get(personId);
        const names = [
          people.ringName(personId),
          person?.givenName ?? '',
          person?.familyName ?? '',
        ];
        return names.some((name) => name.toLowerCase().includes(needle));
      };

      const rows: AvailableWorkerRow[] = [];
      for (const employment of people.roster.values()) {
        const person = read.tables.people.get(employment.personId);
        if (person === undefined || !roles.includes(employment.role) || !matchesSearch(person.id)) {
          continue;
        }
        const brand =
          employment.brandId === null ? undefined : read.tables.brands.get(employment.brandId);
        const availability = people.availability(person.id);
        rows.push({
          personId: person.id,
          ringName: employment.ringName,
          imageRef: person.imageRef,
          gender: person.gender,
          roles: [...person.roles],
          employmentRole: employment.role,
          push: employment.push,
          alignment: employment.alignment,
          brandId: employment.brandId,
          brandName: brand?.name ?? null,
          otherBrand: isOtherBrand(employment.brandId, instance.brandId),
          availability: availabilityView(availability, instance.date),
          bookable: bookableOf(person.id),
          onCard: onCard.get(person.id) ?? [],
          appearancesThisYear: employment.appearancesThisYear,
          appearanceCap: employment.terms.appearanceCap,
          style: person.style,
          popularity: person.regionalPop[instance.regionId] ?? 0,
          stamina: person.attributes.stamina,
        });
      }
      rows.sort(
        (left, right) =>
          Number(right.bookable) - Number(left.bookable) ||
          pushRank(left.push) - pushRank(right.push) ||
          compareText(left.ringName, right.ringName) ||
          compareIds(left.personId, right.personId),
      );

      // Teams whose members all work here, found through the members' index.
      const teams = new Map<TeamId, AvailableTeamRow>();
      for (const employment of people.roster.values()) {
        for (const team of read.tables.teams.lookup('byMember', employment.personId)) {
          if (
            teams.has(team.id) ||
            team.status !== 'active' ||
            !team.memberIds.every((memberId) => people.roster.has(memberId))
          ) {
            continue;
          }
          const searched =
            needle === '' ||
            team.name.toLowerCase().includes(needle) ||
            team.memberIds.some(matchesSearch);
          if (!searched) {
            continue;
          }
          teams.set(team.id, {
            teamId: team.id,
            name: team.name,
            kind: team.kind,
            memberIds: [...team.memberIds],
            bookable: team.memberIds.every(bookableOf),
          });
        }
      }
      const teamRows = [...teams.values()].sort(
        (left, right) =>
          Number(right.bookable) - Number(left.bookable) ||
          compareText(left.name, right.name) ||
          compareIds(left.teamId, right.teamId),
      );
      const region = read.tables.regions.get(instance.regionId);
      return {
        region: { regionId: instance.regionId, name: region?.name ?? instance.regionId },
        people: rows,
        teams: teamRows,
      };
    },
  },
);

/** Everything wrong with a card: the same answer `booking.lockCard` enforces. */
export const validateQuery: QueryDefinition<'booking.validate'> = defineQuery('booking.validate', {
  args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
  run: (ctx, args) => {
    const instance = readableShow(ctx, args.eventInstanceId);
    return validateCard(ctx.read, instance.id, { tunables: ctx.tunables, today: ctx.date });
  },
});

export const bookingQueries: readonly QueryDefinition[] = [
  showsQuery,
  cardQuery,
  availableWorkersQuery,
  validateQuery,
];
