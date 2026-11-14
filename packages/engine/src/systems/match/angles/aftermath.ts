/**
 * An angle's aftermath (MTCH5-06): what one talking segment does to the momentum and popularity of
 * the people in its beats.
 *
 * Every person in a beat that ran gets `angleMomentumGain` (good angles build momentum, flat ones
 * cost a little) and `anglePopularityGain` in the show's region (never a loss), both scaled by
 * their share of the beats. The popularity change spreads to the show's neighbours and reached
 * regions through MTCH3's `segmentRegionWeights`, exactly as a match's does, and both changes are
 * written through WRK1's doors, so the taper, the limits and the change events are the same as
 * for every other change. Momentum lives on the contract with the show's promotion: someone with
 * no contract there has none to change.
 *
 * Morale is never read or written here (D-09): an angle has no losers, and WRK8 owns the story
 * shield for a hot angle's loser.
 *
 * Show night calls {@link applyAngleAftermath} from MTCH3's aftermath applier (`showNight.ts`);
 * the Match lab gets {@link computeAngleAftermath} through `match.previewAngle`'s `aftermath`.
 *
 * Design: docs/design/angle-rating.md#angle-aftermath.
 */

import type { GameDate } from '../../../core/date';
import type {
  EmploymentId,
  EventInstanceId,
  PersonId,
  PromotionId,
  RegionId,
  SegmentId,
} from '../../../core/ids';
import { inputOf, type Traced } from '../../../core/trace';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { Employment } from '../../../model/entities/employment';
import { settingOf } from '../../../model/entities/segment';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { showControllerOf } from '../../calendar/control';
import type { EngineTunables } from '../../tunables';
import {
  applyMomentumChange,
  applyPopularityChange,
  initialMomentum,
  previewMomentumChange,
  previewPopularityChange,
  type DoorContext,
  type DoorReason,
  type DoorSource,
} from '../../workers/doors';
import { geographyOf, type Geography } from '../../world/geography';
import {
  NO_REGION_DETAIL,
  popularityDetail,
  type AftermathMomentum,
  type AftermathNoMomentum,
  type AftermathPopularity,
} from '../aftermath/computeSegmentAftermath';
import { segmentRegionWeights, type RegionWeightLine } from '../aftermath/regionWeights';
import type { SlotRole } from '../slots';
import { beatLimitOf } from './beatLimit';
import { angleMomentumGain } from './formulas/angleMomentumGain';
import { anglePopularityGain } from './formulas/anglePopularityGain';
import { angleShareLabel } from './formulas/angleShare';
import { angleDurationClass } from './rateAngle';

/** The reason key an angle's aftermath writes through the doors with. */
export const ANGLE_AFTERMATH_REASON_KEY = 'match.angle';

/** An angle that ran, in the shape the lab and show night share. */
export interface AngleAftermathInput {
  /** Null for the Match lab's angle on no show. */
  readonly segmentId: SegmentId | null;
  readonly eventInstanceId: EventInstanceId | null;
  /** The promotion whose contracts hold the momentum; null when there is none (no momentum). */
  readonly promotionId: PromotionId | null;
  readonly date: GameDate;
  readonly regionId: RegionId;
  readonly televised: boolean;
  readonly importance: EventImportance;
  /** The people of every beat that ran, in beat order. Beats past the slot's limit left out. */
  readonly beats: readonly (readonly PersonId[])[];
  /** The angle's score, 0..100. */
  readonly score: number;
}

/** One person in the angle. */
export interface AngleAftermathWorker {
  readonly personId: PersonId;
  readonly name: string;
  readonly beatsIn: number;
  /** "In 2 of 3 beats". */
  readonly shareText: string;
  readonly popularity: AftermathPopularity;
  readonly momentum: AftermathMomentum | AftermathNoMomentum;
}

/** The aftermath of one angle, as plain JSON. */
export interface AngleAftermath {
  readonly segmentId: SegmentId | null;
  readonly showRegionId: RegionId;
  readonly showRegionName: string;
  readonly score: number;
  readonly totalBeats: number;
  readonly weights: readonly RegionWeightLine[];
  readonly notes: readonly string[];
  /** Everyone in a beat that ran, by first appearance. */
  readonly workers: readonly AngleAftermathWorker[];
}

export interface AngleAftermathOptions {
  /** Per-region preview and roll-ups (the lab). Show night turns it off; see MTCH3's option. */
  readonly regionDetail?: boolean;
}

/** Everyone in the beats, by first appearance, with how many beats they were in. */
export function beatsInByPerson(
  beats: readonly (readonly PersonId[])[],
): ReadonlyMap<PersonId, number> {
  const counts = new Map<PersonId, number>();
  for (const beat of beats) {
    for (const personId of new Set(beat)) {
      counts.set(personId, (counts.get(personId) ?? 0) + 1);
    }
  }
  return counts;
}

function activeEmploymentWith(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId | null,
): DeepReadonly<Employment> | undefined {
  if (promotionId === null) {
    return undefined;
  }
  return read.tables.employments
    .lookup('byPerson', personId)
    .find((employment) => employment.status === 'active' && employment.promotionId === promotionId);
}

function momentumOf(
  read: GameWorldView,
  tunables: EngineTunables,
  employment: DeepReadonly<Employment>,
  name: string,
): Traced<number> {
  if (employment.momentum === null) {
    return initialMomentum(read, employment, tunables);
  }
  return inputOf(`${name}'s momentum`, employment.momentum, {
    kind: 'employment',
    id: employment.id,
  });
}

/**
 * The aftermath of one angle for everyone in its beats, from the world as it stands. Reads only;
 * uses no RNG. Everyone is worked out from the values before this angle.
 */
export function computeAngleAftermath(
  read: GameWorldView,
  input: AngleAftermathInput,
  tunables: EngineTunables,
  geography: Geography,
  options: AngleAftermathOptions = {},
): AngleAftermath {
  const regionDetail = options.regionDetail !== false;
  const showRegion = read.tables.regions.require(input.regionId);
  const spread =
    input.promotionId === null
      ? { weights: new Map([[showRegion.id, 1]]), lines: [], notes: [] }
      : segmentRegionWeights(
          read,
          {
            promotionId: input.promotionId,
            eventInstanceId: input.eventInstanceId,
            regionId: input.regionId,
            televised: input.televised,
            importance: input.importance,
            date: input.date,
          },
          tunables,
        );
  const regionWeights = Object.fromEntries(spread.weights) as Record<RegionId, number>;
  const totalBeats = input.beats.length;

  const workers = [...beatsInByPerson(input.beats)].map(
    ([personId, beatsIn]): AngleAftermathWorker => {
      const person = read.tables.people.require(personId);
      const employment = activeEmploymentWith(read, personId, input.promotionId);
      const name = employment?.ringName ?? person.defaultRingName;
      const shareText = angleShareLabel(beatsIn, totalBeats);
      const gainInputs = { personName: name, beatsIn, totalBeats, score: input.score };
      const delta = anglePopularityGain(gainInputs, { tunables });
      const detail = regionDetail
        ? popularityDetail(
            geography,
            spread.lines,
            previewPopularityChange(
              read,
              tunables,
              { kind: 'person', id: personId },
              { regionWeights, delta, label: shareText },
            ),
          )
        : NO_REGION_DETAIL;

      let momentum: AftermathMomentum | AftermathNoMomentum = { none: 'noContract' };
      if (employment !== undefined) {
        const before = momentumOf(read, tunables, employment, name);
        const momentumDelta = angleMomentumGain(gainInputs, { tunables });
        const door = previewMomentumChange(
          read,
          tunables,
          employment.id,
          momentumDelta,
          shareText,
        );
        momentum = {
          employmentId: employment.id,
          before: before.value,
          started: door.before === null,
          after: door.after,
          change: door.after - before.value,
          delta: momentumDelta,
          trace: door.trace.trace,
        };
      }
      return {
        personId,
        name,
        beatsIn,
        shareText,
        popularity: { delta, ...detail },
        momentum,
      };
    },
  );

  return {
    segmentId: input.segmentId,
    showRegionId: showRegion.id,
    showRegionName: showRegion.name,
    score: input.score,
    totalBeats,
    weights: spread.lines,
    notes: spread.notes,
    workers,
  };
}

/**
 * A stored angle that ran, as {@link AngleAftermathInput}: only the beats inside the slot's limit
 * (the role and the setting decide it, as for the rating). Null for a match or an angle not rated.
 */
export function storedAngleAftermathInput(
  read: GameWorldView,
  segmentId: SegmentId,
  roleKey: SlotRole,
  tunables: EngineTunables,
): AngleAftermathInput | null {
  const segment = read.tables.segments.require(segmentId);
  if (segment.kind !== 'angle' || segment.rating === null) {
    return null;
  }
  const instance = read.tables.eventInstances.require(segment.eventInstanceId);
  const definition =
    instance.eventDefinitionId === null
      ? undefined
      : read.tables.eventDefinitions.get(instance.eventDefinitionId);
  const durationClass = angleDurationClass(roleKey, settingOf(segment), tunables);
  const max = beatLimitOf(durationClass, tunables).value;
  return {
    segmentId: segment.id,
    eventInstanceId: instance.id,
    promotionId: instance.promotionId,
    date: instance.date,
    regionId: instance.regionId,
    televised: definition?.televised ?? false,
    importance: instance.importance,
    beats: segment.angle.beats.slice(0, max).map((beat) => [...beat.personIds]),
    score: segment.rating.score,
  };
}

export interface AppliedAngleAftermath {
  /** The people whose momentum or popularity was written to, in order. */
  readonly personIds: readonly PersonId[];
}

/**
 * Applies one run angle's aftermath through WRK1's doors (MTCH5-06). Call it after the segment's
 * rating is written. Writes nothing for a match or an unrated angle, and never touches morale.
 */
export function applyAngleAftermath(
  step: DoorContext,
  segmentId: SegmentId,
  roleKey: SlotRole,
): AppliedAngleAftermath {
  const { read } = step;
  const input = storedAngleAftermathInput(read, segmentId, roleKey, step.tunables);
  if (input === null || input.beats.length === 0) {
    return { personIds: [] };
  }
  const instance = read.tables.eventInstances.require(
    read.tables.segments.require(segmentId).eventInstanceId,
  );
  const source: DoorSource = showControllerOf(read, instance).kind === 'human' ? 'player' : 'ai';
  const aftermath = computeAngleAftermath(read, input, step.tunables, geographyOf(read), {
    regionDetail: false,
  });
  const regionWeights = Object.fromEntries(
    aftermath.weights.map((line) => [line.regionId, line.weight]),
  ) as Record<RegionId, number>;
  const reason: DoorReason = {
    key: ANGLE_AFTERMATH_REASON_KEY,
    label: `${instance.name}: angle score ${String(Math.round(input.score))}`,
  };

  const written: PersonId[] = [];
  for (const worker of aftermath.workers) {
    let wrote = false;
    if (worker.popularity.delta.value !== 0) {
      applyPopularityChange(step, {
        subject: { kind: 'person', id: worker.personId },
        regionWeights,
        delta: worker.popularity.delta,
        source,
        reason,
      });
      wrote = true;
    }
    if ('employmentId' in worker.momentum && worker.momentum.delta.value !== 0) {
      const employmentId: EmploymentId = worker.momentum.employmentId;
      applyMomentumChange(step, {
        employmentId,
        delta: worker.momentum.delta,
        source,
        reason,
      });
      wrote = true;
    }
    if (wrote) {
      written.push(worker.personId);
    }
  }
  return { personIds: written };
}
