/**
 * The beat rater (MTCH5-03): the `angle` segment rater for every promotion.
 *
 * It replaces MTCH1's simple speaker rater (`registerSegmentRater('angle', beatAngleRater,
 * { replace: true })` in `rating/builtins.ts`). For a stored segment the stored-segment adapter
 * hands it the beats with their groups (from the participants' sides) and the beat keys earlier on
 * the card; a Match lab preview passes the beats it built. With no beats at all (MTCH1's
 * `match.preview`) it rates the angle type's default beat with every speaker.
 *
 * It reads each person's attributes, popularity in the show's region, and their contract with the
 * promotion running the show (ring name, morale, momentum, manager), the show (region, importance,
 * whether it is televised) and the promotion's writing team, then calls `rateAngle`. Rival
 * shortcuts (D-01) reach it only through MTCH1's rating policy and modifiers: there is no branch on
 * who controls the promotion.
 *
 * A save started before beats existed has no beat catalog: its angles are rated by the simple
 * rater, with a note, so a live show on an old save never fails.
 *
 * Design: docs/design/angle-rating.md#the-beat-rater.
 */

import { isBefore } from '../../../core/date';
import { InvalidArgumentError } from '../../../core/errors';
import type { PersonId, PromotionId } from '../../../core/ids';
import { detachedStream } from '../../../core/rng/registry';
import { constantOf, limitTrace, traced, type Traced } from '../../../core/trace';
import { beatOf, hasBeatCatalog, type AngleTypeDef } from '../../../model/catalogs';
import { promotionStatusKey, type Employment } from '../../../model/entities/employment';
import type { DeepReadonly } from '../../../model/world';
import { workerPerformance } from '../formulas/workerPerformance';
import { angleRater as simpleAngleRater } from '../rating/angleRater';
import {
  durationLabelOf,
  gatherSides,
  policySummary,
  regionNameOf,
  slotWeightLine,
  withTopNotes,
} from '../rating/common';
import type { RatingContext } from '../rating/context';
import { runStage } from '../rating/runStage';
import type {
  SegmentAngleBeat,
  SegmentRatingResult,
  SegmentRatingSide,
  WorkerLine,
} from '../rating/types';
import { beatGroupsOf } from './beatGroups';
import { BEAT_STATS, type BeatStat } from './beatStats';
import {
  rateAngle,
  withNotesAtTop,
  type AngleBeatInput,
  type AngleManagerInput,
  type AnglePersonInput,
  type RateAngleInput,
} from './rateAngle';
import { ANGLE_STREAM } from './streams';

export const NO_BEAT_CATALOG_NOTE =
  'This save has no beat catalog: rated as a simple talking segment';
export const NO_RATED_BEATS_NOTE = 'No beat could be rated: rated as a simple talking segment';
export const IN_NO_BEAT_NOTE = 'In no beat that counted';

/** "Beat beat.mystery is not in the beat catalog: not counted". */
export function unknownBeatNote(beatKey: string): string {
  return `Beat ${beatKey} is not in the beat catalog: not counted`;
}

/** The simple rater's answer, with `note` at the top of its score. */
function simpleWithNote(ctx: RatingContext, note: string): SegmentRatingResult {
  const result = simpleAngleRater(ctx);
  return { ...result, score: withNotesAtTop(result.score, [note]) };
}

/** The angle type's default beat with every speaker, split into groups by side. */
export function defaultBeatsOf(
  angleType: Pick<AngleTypeDef, 'defaultBeatKey'>,
  sides: readonly SegmentRatingSide[],
  read: RatingContext['read'],
): SegmentAngleBeat[] {
  const personIds = sides.flatMap((side) => side.personIds);
  const sideByPerson = new Map<PersonId, number>();
  for (const side of sides) {
    for (const personId of side.personIds) {
      if (!sideByPerson.has(personId)) {
        sideByPerson.set(personId, side.side);
      }
    }
  }
  const catalogBeat = beatOf(read, angleType.defaultBeatKey);
  const grouped = beatGroupsOf(
    { beatKey: angleType.defaultBeatKey, personIds },
    catalogBeat ?? { groups: [] },
    (personId) => sideByPerson.get(personId),
  );
  return [grouped];
}

/** Active contracts with `promotionId`, by person. */
function contractsWith(
  ctx: RatingContext,
  promotionId: PromotionId,
): Map<PersonId, DeepReadonly<Employment>> {
  return new Map(
    ctx.read.tables.employments
      .lookup('byPromotionStatus', promotionStatusKey(promotionId, 'active'))
      .map((employment) => [employment.personId, employment]),
  );
}

/** Whose morale and momentum count: null for everyone. */
function viewerScope(ctx: RatingContext): ReadonlySet<PromotionId> | null {
  const given = ctx.input.angle?.viewerPromotionIds;
  if (given === null) {
    return null;
  }
  if (given === undefined) {
    return ctx.mode === 'live' ? null : new Set();
  }
  return new Set(given);
}

function isUnderContractWith(
  ctx: RatingContext,
  personId: PersonId,
  promotions: ReadonlySet<PromotionId>,
): boolean {
  if (promotions.size === 0) {
    return false;
  }
  return ctx.read.tables.employments
    .lookup('byPerson', personId)
    .some((employment) => employment.status === 'active' && promotions.has(employment.promotionId));
}

/** The resolved beats and the notes for beats the catalog does not have. */
function resolveBeats(
  ctx: RatingContext,
  beats: readonly SegmentAngleBeat[],
): { beats: AngleBeatInput[]; notes: string[] } {
  const resolved: AngleBeatInput[] = [];
  const notes: string[] = [];
  for (const beat of beats) {
    const catalogBeat = beatOf(ctx.read, beat.beatKey);
    if (catalogBeat === undefined) {
      notes.push(unknownBeatNote(beat.beatKey));
      continue;
    }
    const twoGroups = catalogBeat.groups.length > 1;
    resolved.push({
      beatKey: beat.beatKey,
      name: catalogBeat.name,
      weight: catalogBeat.weight,
      repetitionGroup: catalogBeat.repetitionGroup,
      physical: catalogBeat.physical,
      groups: catalogBeat.groups.map((group, index) => {
        let personIds: readonly PersonId[];
        if (index === 0) {
          personIds = twoGroups ? beat.groupOne : [...beat.groupOne, ...beat.groupTwo];
        } else {
          personIds = beat.groupTwo;
        }
        return {
          label: group.label,
          weight: group.weight,
          optional: group.optional,
          stats: [...group.stats],
          managerCanStandIn: group.managerCanStandIn,
          personIds: [...personIds],
        };
      }),
    });
  }
  return { beats: resolved, notes };
}

/**
 * The plain inputs for `rateAngle`, read from the world: everyone in the beats, the show and the
 * promotion running it. Exported for the Match lab's preview and the tests.
 */
export function angleInputFromContext(
  ctx: RatingContext,
  angleType: AngleTypeDef,
  beats: readonly SegmentAngleBeat[],
): RateAngleInput {
  const { read, input, tunables } = ctx;
  const { regionId } = input.event;
  const contracts = contractsWith(ctx, input.promotionId);
  const scope = viewerScope(ctx);
  const overrides = input.angle?.managerOverrides ?? {};
  const resolved = resolveBeats(ctx, beats);

  const sideOf = new Map<PersonId, number>();
  for (const side of input.sides) {
    for (const personId of side.personIds) {
      if (!sideOf.has(personId)) {
        sideOf.set(personId, side.side);
      }
    }
  }

  const nameOf = (personId: PersonId, fallback: string): string =>
    contracts.get(personId)?.ringName ?? fallback;

  const managerOf = (personId: PersonId): AngleManagerInput | null => {
    const managerId = Object.hasOwn(overrides, personId)
      ? (overrides[personId] ?? null)
      : (contracts.get(personId)?.managerPersonId ?? null);
    if (managerId === null) {
      return null;
    }
    const manager = read.tables.people.get(managerId);
    if (manager === undefined) {
      return null;
    }
    return {
      personId: managerId,
      name: nameOf(managerId, manager.defaultRingName),
      values: { mic: manager.attributes.mic, charisma: manager.attributes.charisma },
      morale: contracts.get(managerId)?.morale ?? 0,
    };
  };

  const people = new Map<PersonId, AnglePersonInput>();
  for (const beat of resolved.beats) {
    for (const group of beat.groups) {
      for (const personId of group.personIds) {
        if (people.has(personId)) {
          continue;
        }
        const person = read.tables.people.get(personId);
        if (person === undefined) {
          continue;
        }
        const contract = contracts.get(personId);
        const name = nameOf(personId, person.defaultRingName);
        const values: Partial<Record<BeatStat, number>> = {};
        for (const stat of BEAT_STATS) {
          values[stat] =
            stat === 'popularity' ? (person.regionalPop[regionId] ?? 0) : person.attributes[stat];
        }
        const injury = person.injury;
        const entertainment = runStage(
          'performance',
          workerPerformance(
            {
              personId,
              name,
              axis: 'entertainment',
              attributes: person.attributes,
              style: person.style,
              fatigue: person.fatigue,
              injured: injury !== null && isBefore(ctx.date, injury.expectedReturn),
              styleAffinity: [],
              talkWeights: angleType.speakerWeights,
              angleTypeName: angleType.name,
            },
            { tunables },
          ),
          ctx,
          { kind: 'worker', personId, side: sideOf.get(personId) ?? 0, axis: 'entertainment' },
        );
        people.set(personId, {
          personId,
          name,
          values,
          morale: contract?.morale ?? 0,
          momentum: contract === undefined ? null : contract.momentum,
          manager: managerOf(personId),
          isViewersWorker: scope === null || isUnderContractWith(ctx, personId, scope),
          entertainment,
        });
      }
    }
  }

  const promotion = read.tables.promotions.get(input.promotionId);
  if (promotion === undefined) {
    throw new InvalidArgumentError(
      'angleInputFromContext',
      'promotionId',
      input.promotionId,
      'a promotion in the world',
    );
  }
  const earlierGroupsOnCard = (input.angle?.earlierBeatKeysOnCard ?? []).flatMap((beatKey) => {
    const beat = beatOf(read, beatKey);
    return beat === undefined ? [] : [beat.repetitionGroup];
  });
  return {
    typeName: angleType.name,
    beats: resolved.beats,
    people,
    regionName: regionNameOf(ctx),
    writingLevel: promotion.production.writing,
    role: ctx.role,
    importance: input.event.importance,
    televised: input.event.televised,
    earlierGroupsOnCard,
    policyBonus: ctx.policy.scoreBonus,
    policyLabel: ctx.policy.lines[0] ?? ctx.policy.label,
    notes: resolved.notes,
    ...(input.angle?.setting === undefined ? {} : { setting: input.angle.setting }),
  };
}

function hasAnyone(input: RateAngleInput): boolean {
  return input.beats.some((beat) =>
    beat.groups.some((group) => group.personIds.some((personId) => input.people.has(personId))),
  );
}

function limited(value: Traced<number>): Traced<number> {
  return traced(value.value, limitTrace(value.trace));
}

/** Rates a talking segment by its beats. See the file comment. */
export function beatAngleRater(ctx: RatingContext): SegmentRatingResult {
  if (!hasBeatCatalog(ctx.read)) {
    return simpleWithNote(ctx, NO_BEAT_CATALOG_NOTE);
  }
  const { angleType, tunables } = ctx;
  if (angleType === undefined) {
    throw new InvalidArgumentError('beatAngleRater', 'ctx.angleType', undefined, 'an angle type');
  }
  const beats = ctx.input.angle?.beats ?? defaultBeatsOf(angleType, ctx.input.sides, ctx.read);
  const input = angleInputFromContext(ctx, angleType, beats);
  if (input.beats.length === 0 || !hasAnyone(input)) {
    return simpleWithNote(ctx, NO_RATED_BEATS_NOTE);
  }

  const rating = rateAngle(input, {
    tunables,
    // Without a stream (a rating that asked for no rolls) the beat rolls still need one; a
    // detached stream keeps the world's RNG untouched.
    rng: ctx.rng ?? detachedStream(ctx.read.meta.seed, ANGLE_STREAM, ctx.seed),
    ...(ctx.rng === null ? {} : { crowdRng: ctx.rng }),
    stage: (stage, value) =>
      stage === 'talk'
        ? runStage(stage, value, ctx, undefined, { compress: false })
        : runStage(stage, value, ctx),
  });

  const slotNotes = [durationLabelOf(ctx.slot), slotWeightLine(ctx.slot.weight)];
  const valuesByPerson = new Map<PersonId, number[]>();
  for (const beat of rating.beats) {
    if (!beat.counted) {
      continue;
    }
    for (const group of beat.groups) {
      for (const person of group.people) {
        valuesByPerson.set(person.personId, [
          ...(valuesByPerson.get(person.personId) ?? []),
          person.value.value,
        ]);
      }
    }
  }
  const workers: WorkerLine[] = gatherSides(ctx).flatMap((side) =>
    side.workers.map((worker) => {
      const values = valuesByPerson.get(worker.personId) ?? [];
      const talkLabel = `${worker.name} in the beats`;
      const talk =
        values.length === 0
          ? constantOf(talkLabel, 0, IN_NO_BEAT_NOTE)
          : constantOf(
              talkLabel,
              values.reduce((sum, value) => sum + value, 0) / values.length,
              'Mean of their values in the beats that counted',
            );
      return {
        personId: worker.personId,
        name: worker.name,
        side: worker.side,
        inRing: null,
        entertainment:
          input.people.get(worker.personId)?.entertainment ??
          constantOf(`${worker.name}'s entertainment`, 0, IN_NO_BEAT_NOTE),
        talk,
        stamina: null,
        popularity: worker.popularity,
        momentum: worker.momentum,
      };
    }),
  );

  return {
    kind: 'angle',
    score: limited(withTopNotes(rating.score, slotNotes)),
    stars: limited(withTopNotes(rating.stars, slotNotes)),
    workRate: null,
    talk: rating.delivered,
    crowd: rating.crowd,
    expectation: rating.expected,
    starPower: rating.starPower,
    slot: ctx.slot,
    workers,
    warnings: [],
    policy: policySummary(ctx),
    angle: {
      delivered: rating.delivered,
      beats: rating.beats,
      beatLimit: rating.beatLimit,
      writingLevel: input.writingLevel,
    },
  };
}
