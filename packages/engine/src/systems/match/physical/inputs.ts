/**
 * What the physical toll formulas read about one segment and the workers in it (MTCH4-01).
 *
 * A `PhysicalSegmentSpec` describes a segment the same way for a booked card and for a Match lab
 * draft; `collectPhysicalInputs` turns it into one entry per worker who carries physical load.
 *
 * Constant rules (not tunables, see docs/design/physical-toll.md#who-carries-load):
 * - only participants with the `competitor` role carry load; `ringside`, `interferer`, `speaker` and
 *   `subject` do not;
 * - a talking segment (an angle) carries no load at all: angles cost no stamina, so nobody in one
 *   gains fatigue or wear.
 *
 * Repeat appearances (owner rule): when the spec says where the segment sits on a card, each worker
 * gets the number of matches they work earlier on that card (`matchesEarlierTonight`), which the
 * formulas turn into the `match.fatigue.repeatMatch` factor. Only earlier matches count, so the
 * first match of the night costs the normal amount and each later one costs more.
 */

import type { EventInstanceId, PersonId, PromotionId } from '../../../core/ids';
import type { EventImportance } from '../../../model/entities/event-definition';
import { promotionStatusKey } from '../../../model/entities/employment';
import type { ParticipantRole } from '../../../model/entities/participant';
import type { BodyCondition, RingStyle, TraitKey } from '../../../model/entities/person';
import type { SegmentKind } from '../../../model/entities/segment';
import type { GameWorldView } from '../../../model/tables';
import type { DurationClass } from '../slots';

/** One person in a segment, by role. */
export interface PhysicalParticipant {
  readonly personId: PersonId;
  readonly role: ParticipantRole;
}

/** Where a segment sits on a card: enough to count each worker's earlier matches that night. */
export interface PhysicalCardPosition {
  readonly eventInstanceId: EventInstanceId;
  readonly preShow: boolean;
  /** The stored slot, 0-based within its section. */
  readonly slot: number;
}

/** One segment as the physical toll reads it. */
export interface PhysicalSegmentSpec {
  readonly promotionId: PromotionId;
  readonly importance: EventImportance;
  /** A talking segment (`angle`) carries no physical load. */
  readonly kind: SegmentKind;
  readonly durationClass: DurationClass;
  /** Everyone in the segment, side by side (stored side `n` is `sides[n]`). */
  readonly sides: readonly (readonly PhysicalParticipant[])[];
  readonly crew: { readonly producerId: PersonId | null };
  /** The booker asked the workers to keep it safe. A risk contribution can switch this on too. */
  readonly keepItSafe: boolean;
  /** Match lab only: fatigue going in, per person, in place of the stored fatigue. */
  readonly fatigueOverrides?: Readonly<Partial<Record<PersonId, number>>>;
  /**
   * Where the segment sits on a booked card. Given, each worker's earlier matches on that card are
   * counted; left out (a lab draft), every worker is on their first match of the night.
   */
  readonly card?: PhysicalCardPosition | null;
}

/** An opponent as the wear formula reads them. */
export interface PhysicalOpponent {
  readonly personId: PersonId;
  readonly name: string;
  readonly safety: number;
  readonly style: RingStyle;
}

/** One worker who carries physical load, with everything the formulas read about them. */
export interface PhysicalWorkerInputs {
  readonly personId: PersonId;
  /** The ring name the promotion uses, else the person's default ring name. */
  readonly name: string;
  /** The stored side, 0-based. */
  readonly side: number;
  /** Fatigue going in: the lab override when given, else the stored fatigue. */
  readonly fatigue: number;
  readonly condition: Readonly<BodyCondition>;
  readonly stamina: number;
  readonly safety: number;
  readonly style: RingStyle;
  readonly traits: readonly TraitKey[];
  /** Competitors across every side, this worker included. */
  readonly workersInMatch: number;
  /** Every competitor on another side. */
  readonly opponents: readonly PhysicalOpponent[];
  /** Matches this worker works earlier on the same card; 0 for their first (or a lab draft). */
  readonly matchesEarlierTonight: number;
}

const LOAD_ROLE: ParticipantRole = 'competitor';

/** The competitors of each side, sorted by id within the side. Empty sides for an angle. */
export function loadCarriersBySide(spec: PhysicalSegmentSpec): PersonId[][] {
  if (spec.kind !== 'match') {
    return spec.sides.map(() => []);
  }
  return spec.sides.map((side) =>
    [
      ...new Set(
        side
          .filter((participant) => participant.role === LOAD_ROLE)
          .map((participant) => participant.personId),
      ),
    ].sort(),
  );
}

/** Running order on one card: the pre-show first, then by slot. */
function isEarlier(
  segment: { readonly preShow: boolean; readonly slot: number },
  position: PhysicalCardPosition,
): boolean {
  if (segment.preShow !== position.preShow) {
    return segment.preShow;
  }
  return segment.slot < position.slot;
}

/**
 * How many matches each of `personIds` works as a competitor before `position` on its card. A
 * person missing from the map works no earlier match.
 */
export function earlierMatchesOnCard(
  read: GameWorldView,
  position: PhysicalCardPosition,
  personIds: readonly PersonId[],
): Map<PersonId, number> {
  const wanted = new Set(personIds);
  const counts = new Map<PersonId, number>();
  for (const segment of read.tables.segments.lookup('byEventInstance', position.eventInstanceId)) {
    if (segment.kind !== 'match' || !isEarlier(segment, position)) {
      continue;
    }
    const competitors = new Set(
      read.tables.participants
        .lookup('bySegment', segment.id)
        .filter((participant) => participant.role === LOAD_ROLE)
        .map((participant) => participant.personId),
    );
    for (const personId of competitors) {
      if (wanted.has(personId)) {
        counts.set(personId, (counts.get(personId) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * One entry per worker who carries physical load, side by side and by id within a side, so the
 * order is deterministic. An angle gives no entries. Lab fatigue overrides change only the
 * returned inputs, never the world.
 *
 * @throws NotFoundError (from `people.require`) for a person the world does not have.
 */
export function collectPhysicalInputs(
  read: GameWorldView,
  spec: PhysicalSegmentSpec,
): PhysicalWorkerInputs[] {
  const bySide = loadCarriersBySide(spec);
  const everyone = bySide.flat();
  if (everyone.length === 0) {
    return [];
  }
  const contracts = new Map(
    read.tables.employments
      .lookup('byPromotionStatus', promotionStatusKey(spec.promotionId, 'active'))
      .map((employment) => [employment.personId, employment]),
  );
  const people = new Map(
    everyone.map((personId) => {
      const person = read.tables.people.require(personId);
      const name = contracts.get(personId)?.ringName ?? person.defaultRingName;
      return [personId, { person, name }] as const;
    }),
  );
  const earlier =
    spec.card === undefined || spec.card === null
      ? new Map<PersonId, number>()
      : earlierMatchesOnCard(read, spec.card, everyone);

  const workers: PhysicalWorkerInputs[] = [];
  bySide.forEach((personIds, side) => {
    const opponents: PhysicalOpponent[] = bySide.flatMap((otherIds, otherSide) =>
      otherSide === side
        ? []
        : otherIds.map((personId) => {
            const entry = people.get(personId);
            if (entry === undefined) {
              throw new RangeError(`collectPhysicalInputs: ${personId} was not read`);
            }
            return {
              personId,
              name: entry.name,
              safety: entry.person.attributes.safety,
              style: entry.person.style,
            };
          }),
    );
    for (const personId of personIds) {
      const entry = people.get(personId);
      if (entry === undefined) {
        throw new RangeError(`collectPhysicalInputs: ${personId} was not read`);
      }
      const { person, name } = entry;
      workers.push({
        personId,
        name,
        side,
        fatigue: spec.fatigueOverrides?.[personId] ?? person.fatigue,
        condition: { ...person.condition },
        stamina: person.attributes.stamina,
        safety: person.attributes.safety,
        style: person.style,
        traits: [...person.traits],
        workersInMatch: everyone.length,
        opponents,
        matchesEarlierTonight: earlier.get(personId) ?? 0,
      });
    }
  });
  return workers;
}
