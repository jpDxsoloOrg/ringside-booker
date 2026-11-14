/**
 * `rateAngle`: an angle's beats to one rating, from plain inputs (MTCH5-03).
 *
 * The beat rater (`angleRater.ts`) gathers the inputs from the world for a show and for a Match lab
 * preview alike, so both take this one path. It cuts the beats to the slot's limit, rates every
 * beat (`beatWorkerValue` per person, then `beatScore`), then the angle score, expectation, crowd
 * and stars.
 *
 * Draw order on the beat stream is fixed: beat by beat, group by group, person by person, then the
 * beat's own roll; the crowd's roll comes last, on its own stream when the caller passes one.
 *
 * Design: docs/design/angle-rating.md#the-beat-rater.
 */

import type { ContentKey } from '../../../core/content-key';
import type { PersonId } from '../../../core/ids';
import type { RngStream } from '../../../core/rng/registry';
import {
  constantOf,
  findTraceNodes,
  limitTrace,
  traced,
  type Traced,
  type TraceNode,
} from '../../../core/trace';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { EngineTunables } from '../../tunables';
import { crowdExpectation } from '../formulas/crowdExpectation';
import { sideAggregate } from '../formulas/sideAggregate';
import { softCompression } from '../formulas/softCompression';
import { starPower } from '../formulas/starPower';
import { starRating } from '../formulas/starRating';
import type { RatingStage } from '../rating/types';
import {
  DURATION_CLASS_LABELS,
  SLOT_ROLE_LABELS,
  durationClassOf,
  type DurationClass,
  type SlotRole,
} from '../slots';
import type { AngleSetting } from '../../../model/entities/angle-setting';
import { beatLimitOf, beatLimitMessage, overLimitNote } from './beatLimit';
import { settingDurationShifter, settingNote } from './settings';
import { BEAT_STAT_LABELS, isBeatStat, type BeatStat } from './beatStats';
import { angleScoreParts, type AngleScoreBeat } from './formulas/angleScore';
import { beatScore } from './formulas/beatScore';
import {
  BEST_STAT_LABEL,
  beatWorkerValue,
  type BeatManagerInputs,
} from './formulas/beatWorkerValue';

export const ENTERTAINMENT_LABEL = 'Entertainment';

/** A manager who may talk for a person in the angle. */
export interface AngleManagerInput extends BeatManagerInputs {
  readonly personId: PersonId;
}

/** One person in the angle, with what the beat formulas read. */
export interface AnglePersonInput {
  readonly personId: PersonId;
  readonly name: string;
  /** 0..100 per stat; `popularity` is popularity in the show's region. */
  readonly values: Partial<Record<BeatStat, number>>;
  /** -100..100; 0 when not under contract with the promotion running the show. */
  readonly morale: number;
  /** -100..100, null before a first appearance. */
  readonly momentum: number | null;
  readonly manager: AngleManagerInput | null;
  /** False: morale and momentum are treated as neutral (a rival's worker in a preview). */
  readonly isViewersWorker: boolean;
  /** The entertainment axis, after the `performance` stage. */
  readonly entertainment: Traced<number>;
}

/** One group of a beat, with the catalog group's rules and who is in it. */
export interface AngleBeatGroupInput {
  readonly label: string;
  readonly weight: number;
  readonly optional: boolean;
  readonly stats: readonly BeatStat[];
  readonly managerCanStandIn: boolean;
  readonly personIds: readonly PersonId[];
}

/** One beat of the angle, resolved against the beat catalog. */
export interface AngleBeatInput {
  readonly beatKey: ContentKey;
  readonly name: string;
  readonly weight: number;
  readonly repetitionGroup: string;
  readonly physical: boolean;
  /** One or two groups, in the catalog's order. */
  readonly groups: readonly AngleBeatGroupInput[];
}

/** Everything `rateAngle` needs. */
export interface RateAngleInput {
  /** The angle type's name, such as "Promo". */
  readonly typeName: string;
  /** Every beat in order; those past the slot's limit are not rated. At least one. */
  readonly beats: readonly AngleBeatInput[];
  /** Everyone in any beat, by id. */
  readonly people: ReadonlyMap<PersonId, AnglePersonInput>;
  /** The show region's name, for star power. */
  readonly regionName: string;
  /** The promotion's writing team level, 0..10. */
  readonly writingLevel: number;
  readonly role: SlotRole;
  readonly importance: EventImportance;
  readonly televised: boolean;
  /** The repetition group of every beat earlier on the card. */
  readonly earlierGroupsOnCard: readonly string[];
  /** The rating policy's bonus and its line (D-01). */
  readonly policyBonus: Traced<number>;
  readonly policyLabel: string;
  /** Lines for the top of the score's trace, such as a skipped unknown beat. */
  readonly notes?: readonly string[];
  /**
   * MTCH5-08: where the angle happens. Left out: in the ring. Backstage and pre-taped angles lean
   * on the beats more than the crowd, have no crowd roll and may shift the duration class.
   */
  readonly setting?: AngleSetting;
}

/**
 * The rating pipeline's stages, for MTCH1's rating modifiers. Left out, every stage keeps its
 * value except the crowd, which is soft-compressed as MTCH1's crowd stage does.
 */
export type AngleStageRunner = (stage: RatingStage, value: Traced<number>) => Traced<number>;

export interface RateAngleDeps {
  readonly tunables: EngineTunables;
  /** The beat rolls (`match.angle`). */
  readonly rng: RngStream;
  /** The crowd's roll; left out, no crowd roll. */
  readonly crowdRng?: RngStream;
  readonly stage?: AngleStageRunner;
}

/** One person in a rated beat. */
export interface BeatPersonResult {
  readonly personId: PersonId;
  readonly name: string;
  /** The stat their value came from. */
  readonly stat: BeatStat;
  /** "Mic", "Mic via manager Jo". */
  readonly statLabel: string;
  /** True when their manager's talking won the stat. */
  readonly viaManager: boolean;
  /** 0..100, their `beatWorkerValue` with its trace. */
  readonly value: Traced<number>;
}

export interface BeatGroupResult {
  readonly label: string;
  readonly people: readonly BeatPersonResult[];
}

/** One beat of a rated angle. */
export interface BeatResult {
  /** 0-based position in the angle. */
  readonly index: number;
  readonly beatKey: ContentKey;
  readonly name: string;
  readonly physical: boolean;
  /** False for a beat past the slot's limit: it has no score and no people's values. */
  readonly counted: boolean;
  /** The beat's score, or null when it did not count. */
  readonly score: Traced<number> | null;
  readonly groups: readonly BeatGroupResult[];
}

/** The slot's beat limit. */
export interface BeatLimit {
  readonly max: number;
  readonly message: string;
  readonly trace: Traced<number>;
}

/** A rated angle. Plain JSON. */
export interface AngleRating {
  /** 0..100, whole. */
  readonly score: Traced<number>;
  /** 0..5 in quarter stars. */
  readonly stars: Traced<number>;
  /** The beats' weighted mean. */
  readonly delivered: Traced<number>;
  readonly expected: Traced<number>;
  readonly crowd: Traced<number>;
  readonly starPower: Traced<number>;
  readonly beats: readonly BeatResult[];
  readonly durationClass: DurationClass;
  readonly beatLimit: BeatLimit;
}

/** What a rated segment carries about its beats. */
export interface AngleRatingDetail {
  readonly delivered: Traced<number>;
  readonly beats: readonly BeatResult[];
  readonly beatLimit: BeatLimit;
  readonly writingLevel: number;
}

function defaultStage(tunables: EngineTunables): AngleStageRunner {
  return (stage, value) =>
    stage === 'crowd' ? softCompression({ value, label: 'Crowd' }, { tunables }) : value;
}

function meanOf(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The stat and whether the manager won it, read off the worker value's "Best stat" decision. */
function chosenStat(
  value: Traced<number>,
  fallback: BeatStat,
): { stat: BeatStat; viaManager: boolean } {
  const decision = findTraceNodes(value.trace, 'decision').find(
    (node) => node.label === BEST_STAT_LABEL,
  );
  const chosen = typeof decision?.chosen === 'string' ? decision.chosen : fallback;
  const [stat, manager] = chosen.split(':');
  return {
    stat: isBeatStat(stat) ? stat : fallback,
    viaManager: manager === 'manager',
  };
}

function limited(value: Traced<number>): Traced<number> {
  return traced(value.value, limitTrace(value.trace));
}

/** `value` with notes placed right after its starting value, at the top of the Why? panel. */
export function withNotesAtTop(value: Traced<number>, notes: readonly string[]): Traced<number> {
  const node = value.trace;
  if (notes.length === 0 || node.kind !== 'formula' || node.children.length === 0) {
    return value;
  }
  const [start, ...rest] = node.children;
  const noteNodes: TraceNode[] = notes.map((text) => ({ kind: 'note', label: text, value: null }));
  return traced(value.value, {
    ...node,
    children: [...(start === undefined ? [] : [start]), ...noteNodes, ...rest],
  });
}

/** Rates one beat: each person's value, in group and person order, then the beat's score. */
function rateBeat(
  beat: AngleBeatInput,
  index: number,
  people: ReadonlyMap<PersonId, AnglePersonInput>,
  deps: RateAngleDeps,
): BeatResult {
  const groups: BeatGroupResult[] = [];
  const scoreGroups = beat.groups.map((group) => {
    const results: BeatPersonResult[] = [];
    const fallback = group.stats[0] ?? 'mic';
    for (const personId of group.personIds) {
      const person = people.get(personId);
      if (person === undefined) {
        continue;
      }
      const value = beatWorkerValue(
        {
          personName: person.name,
          stats: group.stats,
          values: person.values,
          morale: person.morale,
          momentum: person.momentum,
          manager: person.manager,
          managerCanStandIn: group.managerCanStandIn,
          isViewersWorker: person.isViewersWorker,
        },
        { tunables: deps.tunables, rng: deps.rng },
      );
      const { stat, viaManager } = chosenStat(value, fallback);
      results.push({
        personId,
        name: person.name,
        stat,
        statLabel: viaManager
          ? `${BEAT_STAT_LABELS[stat]} via manager ${person.manager?.name ?? ''}`.trim()
          : BEAT_STAT_LABELS[stat],
        viaManager,
        value,
      });
    }
    groups.push({ label: group.label, people: results });
    return {
      label: group.label,
      weight: group.weight,
      optional: group.optional,
      workerValues: results.map((result) => result.value),
    };
  });
  const score = beatScore(
    { beatName: beat.name, groups: scoreGroups },
    { tunables: deps.tunables, rng: deps.rng },
  );
  return {
    index,
    beatKey: beat.beatKey,
    name: beat.name,
    physical: beat.physical,
    counted: true,
    score,
    groups,
  };
}

/** A beat past the slot's limit: listed with its people, not rated. */
function uncountedBeat(
  beat: AngleBeatInput,
  index: number,
  people: ReadonlyMap<PersonId, AnglePersonInput>,
): BeatResult {
  return {
    index,
    beatKey: beat.beatKey,
    name: beat.name,
    physical: beat.physical,
    counted: false,
    score: null,
    groups: beat.groups.map((group) => ({
      label: group.label,
      people: group.personIds.flatMap((personId) => {
        const person = people.get(personId);
        const stat = group.stats[0];
        if (person === undefined || stat === undefined) {
          return [];
        }
        return [
          {
            personId,
            name: person.name,
            stat,
            statLabel: BEAT_STAT_LABELS[stat],
            viaManager: false,
            value: constantOf(person.name, 0, 'This beat did not count'),
          },
        ];
      }),
    })),
  };
}

/** How many beats of each repetition group came before each beat, in the angle and on the card. */
function repetitionCounts(
  beats: readonly AngleBeatInput[],
  earlierOnCard: readonly string[],
): { earlierInAngle: number; earlierOnCard: number }[] {
  const seen = new Map<string, number>();
  return beats.map((beat) => {
    const inAngle = seen.get(beat.repetitionGroup) ?? 0;
    seen.set(beat.repetitionGroup, inAngle + 1);
    return {
      earlierInAngle: inAngle,
      earlierOnCard: earlierOnCard.filter((group) => group === beat.repetitionGroup).length,
    };
  });
}

/**
 * A talking segment's duration class: its slot role's, moved by its setting (MTCH5-08: backstage is
 * usually one step shorter, `match.angle.setting.<setting>.durationShift`).
 */
export function angleDurationClass(
  role: SlotRole,
  setting: AngleSetting,
  tunables: EngineTunables,
): DurationClass {
  return durationClassOf(
    { role, matchType: settingDurationShifter(setting, tunables) },
    { tunables },
  ).value;
}

/**
 * Rates an angle: the beats that fit the slot, then the angle score, the expectation, the crowd
 * and the stars. Never throws for an angle past its limit: the extra beats are listed but not
 * rated, with the note "Only the first 2 beats count in a short slot".
 *
 * @throws InvalidArgumentError when there are no beats or nobody in them (the beat formulas'
 *   own checks).
 */
export function rateAngle(input: RateAngleInput, deps: RateAngleDeps): AngleRating {
  const { tunables } = deps;
  const stage = deps.stage ?? defaultStage(tunables);
  const setting = input.setting ?? 'ring';
  const durationClass = angleDurationClass(input.role, setting, tunables);
  const limit = beatLimitOf(durationClass, tunables);
  const max = limit.value;
  const notes = [...(input.notes ?? [])];
  const whereNote = settingNote(setting);
  if (whereNote !== null) {
    notes.unshift(whereNote);
  }
  if (input.beats.length > max) {
    notes.push(overLimitNote(durationClass, max));
  }

  const beats = input.beats.map((beat, index) =>
    index < max
      ? rateBeat(beat, index, input.people, deps)
      : uncountedBeat(beat, index, input.people),
  );
  const counted = input.beats.slice(0, max);
  const repetition = repetitionCounts(counted, input.earlierGroupsOnCard);
  const scoreBeats: AngleScoreBeat[] = counted.map((beat, index) => ({
    name: beat.name,
    score: beats[index]?.score ?? constantOf(beat.name, 0, 'Not rated'),
    weight: beat.weight,
    repetitionGroup: beat.repetitionGroup,
    earlierInAngle: repetition[index]?.earlierInAngle ?? 0,
    earlierOnCard: repetition[index]?.earlierOnCard ?? 0,
  }));

  // Everyone in a beat that counted, in order of first appearance.
  const everyone: AnglePersonInput[] = [];
  for (const beat of counted) {
    for (const group of beat.groups) {
      for (const personId of group.personIds) {
        const person = input.people.get(personId);
        if (person !== undefined && !everyone.includes(person)) {
          everyone.push(person);
        }
      }
    }
  }

  const entertainment = sideAggregate(
    {
      label: ENTERTAINMENT_LABEL,
      members: everyone.map((person) => ({
        id: person.personId,
        name: person.name,
        value: person.entertainment,
      })),
      decayKey: 'match.side.depthDecay',
    },
    { tunables },
  );
  const power = starPower(
    {
      regionName: input.regionName,
      members: everyone.map((person) => ({
        id: person.personId,
        name: person.name,
        popularity: person.values.popularity ?? 0,
      })),
    },
    { tunables },
  );
  const expected = stage(
    'expectation',
    crowdExpectation(
      {
        starPower: power,
        momentum: meanOf(
          everyone.map((person) => (person.isViewersWorker ? (person.momentum ?? 0) : 0)),
        ),
        role: input.role,
        roleLabel: SLOT_ROLE_LABELS[input.role],
        importance: input.importance,
        televised: input.televised,
      },
      { tunables },
    ),
  );

  const parts = angleScoreParts(
    {
      beats: scoreBeats,
      expected,
      writingLevel: input.writingLevel,
      entertainment,
      starPower: power,
      typeName: input.typeName,
      policyBonus: input.policyBonus,
      policyLabel: input.policyLabel,
      setting,
    },
    {
      tunables,
      // Away from the live crowd there is no crowd roll: nothing swings it on the night.
      ...(deps.crowdRng === undefined || setting !== 'ring' ? {} : { rng: deps.crowdRng }),
      stage: (name, value) => stage(name, value),
    },
  );
  const durationLabel = `${SLOT_ROLE_LABELS[input.role]} (${DURATION_CLASS_LABELS[durationClass].toLowerCase()})`;
  const score = stage('score', withNotesAtTop(parts.score, notes));
  const stars = stage(
    'stars',
    starRating(
      {
        kind: 'angle',
        performance: parts.delivered,
        crowd: parts.crowd,
        durationClass,
        durationLabel,
      },
      { tunables },
    ),
  );

  return {
    score: limited(score),
    stars: limited(stars),
    delivered: limited(parts.delivered),
    expected,
    crowd: parts.crowd,
    starPower: power,
    beats,
    durationClass,
    beatLimit: { max, message: beatLimitMessage(durationClass, max), trace: limit },
  };
}
