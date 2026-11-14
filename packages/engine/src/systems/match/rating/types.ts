/**
 * The shapes the rating pipeline reads and returns (MTCH1-05).
 *
 * `SegmentRatingInput` is plain data: the Match lab builds one from what the player picked, EVT3
 * builds one from a stored segment (`ratingInputFromSegment`). It is an object so later features can
 * add optional fields (MTCH2's resolution, MTCH8's titles, storylines and crew) without breaking
 * callers. `SegmentRatingResult` is plain JSON: every number that needs a story carries its trace.
 *
 * Design: docs/design/match-rating.md#pipeline-and-seams.
 */

import type { AngleSetting } from '../../../model/entities/angle-setting';
import type { ContentKey } from '../../../core/content-key';
import type { GameDate } from '../../../core/date';
import type { PersonId, PromotionId, RegionId } from '../../../core/ids';
import type { Traced } from '../../../core/trace';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { SegmentKind } from '../../../model/entities/segment';
import type { MatchResolution } from '../finishes/resolution';
import type { PerformanceAxis } from '../formulas/workerPerformance';
import type { AngleRatingDetail } from '../angles/rateAngle';
import type { DurationClass, SlotPosition, SlotRole } from '../slots';

export type { SegmentKind } from '../../../model/entities/segment';

/** One side of a segment: the stored 0-based side number and who is on it, in order. */
export interface SegmentRatingSide {
  /** The stored side, `0..MAX_SIDE`. Screens read side `n` as "Side n + 1". */
  readonly side: number;
  readonly personIds: readonly PersonId[];
}

/** Where the segment sits: a role given outright (the lab) or a slot position on a card. */
export type SegmentRatingSlot = { readonly role: SlotRole } | SlotPosition;

/** The show the segment is on. */
export interface SegmentRatingEvent {
  readonly importance: EventImportance;
  readonly regionId: RegionId;
  readonly televised: boolean;
  readonly date: GameDate;
}

/** Everything a rating needs to know about a segment. */
export interface SegmentRatingInput {
  readonly kind: SegmentKind;
  /** The match type (`match.*`) or angle type (`angle.*`). */
  readonly typeKey: ContentKey;
  readonly sides: readonly SegmentRatingSide[];
  readonly slot: SegmentRatingSlot;
  readonly event: SegmentRatingEvent;
  /** The promotion running the show: momentum is read from contracts with it. */
  readonly promotionId: PromotionId;
  /**
   * How the match ended, when it has been resolved (Simulate, a show night): the finish effects
   * (MTCH2-02) read it. Left out or null for an unresolved match (the lab's Run), which then gets
   * no finish effect.
   */
  readonly resolution?: MatchResolution | null;
  /**
   * A talking segment's beats and what the beat rater (MTCH5-03) reads with them. Left out, the
   * angle type's default beat with every speaker, split into groups by side.
   */
  readonly angle?: SegmentAngleInput;
}

/** One beat of a talking segment, its people already split into the catalog beat's groups. */
export interface SegmentAngleBeat {
  readonly beatKey: ContentKey;
  readonly groupOne: readonly PersonId[];
  readonly groupTwo: readonly PersonId[];
}

/** The beat rater's extra inputs (MTCH5-03). */
export interface SegmentAngleInput {
  /** The beats in order, 1..8. */
  readonly beats: readonly SegmentAngleBeat[];
  /** The beat keys of the talking segments earlier on the card, in card order. */
  readonly earlierBeatKeysOnCard?: readonly ContentKey[];
  /** A manager who talks for a person instead of their contract's manager; null for none. */
  readonly managerOverrides?: Readonly<Record<PersonId, PersonId | null>>;
  /**
   * Whose morale and momentum count: people under contract with one of these promotions. Null
   * means everyone (a show being run). Left out: everyone in a live rating, nobody in a preview.
   */
  readonly viewerPromotionIds?: readonly PromotionId[] | null;
  /** MTCH5-08: where the angle happens. Left out: in the ring. */
  readonly setting?: AngleSetting;
}

/** A booking problem, for the lab and EVT2's booking validation. `message` is player text. */
export interface SegmentWarning {
  readonly code: SegmentWarningCode;
  readonly severity: 'warning' | 'error';
  readonly message: string;
  readonly personId?: PersonId;
  /** The stored side the warning is about, when it is about one. */
  readonly side?: number;
  /** The 0-based beat the warning is about, for a talking segment's beat warnings. */
  readonly beatIndex?: number;
}

/** Every code `segmentWarnings` can return. */
export const SEGMENT_WARNING_CODES = [
  'sideCount',
  'sideSize',
  'unequalSides',
  'duplicatePerson',
  'injured',
  'inactive',
  'unavailable',
  'nonWrestler',
  'speakerCount',
  // MTCH5-03: talking segments built from beats.
  'angle.tooManyBeats',
  'angle.beatNotAllowed',
  'angle.unknownBeat',
  'angle.emptyGroup',
  'angle.groupTooBig',
  'angle.sidesConflict',
  'angle.injuredInPhysicalBeat',
  'angle.cannotWorkAngles',
  'angle.unavailable',
] as const;
export type SegmentWarningCode = (typeof SEGMENT_WARNING_CODES)[number];

/** A worker's stamina against what the slot asks for (matches only). */
export interface WorkerStaminaLine {
  readonly need: number;
  readonly have: number;
  readonly penalty: Traced<number>;
}

/** One worker's own numbers, each from that worker's own inputs. */
export interface WorkerLine {
  readonly personId: PersonId;
  readonly name: string;
  /** The stored side. */
  readonly side: number;
  /** In-ring performance after the `performance` stage; null for a talking segment. */
  readonly inRing: Traced<number> | null;
  /** Entertainment performance after the `performance` stage. */
  readonly entertainment: Traced<number>;
  /** Talk performance after the `performance` stage; null for a match. */
  readonly talk: Traced<number> | null;
  readonly stamina: WorkerStaminaLine | null;
  /** Popularity in the show's region (0 when they have none there). */
  readonly popularity: Traced<number>;
  /** Momentum with the promotion running the show (0 when not under contract there). */
  readonly momentum: Traced<number>;
}

/** The slot's role, duration class and weight, each with the rule that decided it. */
export interface SlotDerivation {
  readonly role: SlotRole;
  readonly durationClass: DurationClass;
  readonly weight: number;
  readonly roleTrace: Traced<SlotRole>;
  readonly durationTrace: Traced<DurationClass>;
  readonly weightTrace: Traced<number>;
}

/** The rating policy as the result reports it. */
export interface RatingPolicySummary {
  readonly label: string;
  readonly simpleInputs: boolean;
  readonly skipInMatchInjuries: boolean;
}

/** A rated segment. Plain JSON. */
export interface SegmentRatingResult {
  readonly kind: SegmentKind;
  /** 0–100, whole. */
  readonly score: Traced<number>;
  /** 0–5 in quarter steps. */
  readonly stars: Traced<number>;
  /** Null for a talking segment. */
  readonly workRate: Traced<number> | null;
  /** Null for a match. */
  readonly talk: Traced<number> | null;
  readonly crowd: Traced<number>;
  readonly expectation: Traced<number>;
  readonly starPower: Traced<number>;
  readonly slot: SlotDerivation;
  readonly workers: readonly WorkerLine[];
  readonly warnings: readonly SegmentWarning[];
  readonly policy: RatingPolicySummary;
  /** A talking segment rated by beats (MTCH5-03): each beat and the angle's numbers. */
  readonly angle?: AngleRatingDetail;
}

/** The stages a rating modifier can join, in the order a match runs them. */
export const RATING_STAGES = [
  'performance',
  'side',
  'workRate',
  'talk',
  'expectation',
  'crowd',
  'score',
  'stars',
] as const;
export type RatingStage = (typeof RATING_STAGES)[number];

/** The worker a `performance` stage is about, and which axis it is judging. */
export interface WorkerSubject {
  readonly kind: 'worker';
  readonly personId: PersonId;
  readonly side: number;
  readonly axis: PerformanceAxis;
}

/** The side a `side` stage is about. */
export interface SideSubject {
  readonly kind: 'side';
  readonly side: number;
  readonly personIds: readonly PersonId[];
}

/** What a `performance` or `side` stage is about; the other stages have no subject. */
export type RatingSubject = WorkerSubject | SideSubject;
