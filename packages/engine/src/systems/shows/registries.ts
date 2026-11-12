/**
 * Show night's seams: how later features react to each segment's result and how a match's result
 * is decided, without editing the shows phase (docs/design/show-night.md#seams).
 *
 * - Segment result appliers run, in order, after a segment is rated and its result written. EVT3-04
 *   settles titles through one; MTCH3 (popularity) and MTCH4 (fatigue) add theirs later.
 * - The match outcome resolver decides how a match ends before it is rated. At most one may be
 *   registered; the match bundle registers MTCH2's `match.resolveOutcome` here at module load
 *   (EVT3-07, `systems/match/finishes/showNight.ts`). Without it the built-in `plannedOrNoContest`
 *   uses the booked result, and a match nobody planned ends as a no contest.
 *
 * Both registries are module-level, like the rater and show score modifier registries: a system
 * registers at module load and tests unregister what they added.
 */

import type { ContentKey } from '../../core/content-key';
import type { GameDate } from '../../core/date';
import { RegistryError } from '../../core/errors';
import type {
  BrandId,
  EventInstanceId,
  PersonId,
  PromotionId,
  RegionId,
  SegmentId,
  StorylineId,
  TeamId,
  TitleId,
} from '../../core/ids';
import { PHASE_ID_PATTERN } from '../../core/pipeline/phase';
import type { PhaseContext } from '../../core/pipeline/context';
import type { RngStream } from '../../core/rng/registry';
import type { StreamName } from '../../core/rng/streams';
import { startDecision, type TraceNode, type Traced } from '../../core/trace';
import type { EventImportance } from '../../model/entities/event-definition';
import type { MatchOutcome, SegmentKind } from '../../model/entities/segment';
import type { GameWorldView } from '../../model/tables';
import type { DurationClass, SlotRole } from '../match/slots';
import type { EngineTunables } from '../tunables';

// ---------------------------------------------------------------------------------------------
// Segment result appliers

/** One side of a segment as an applier reads it. */
export interface SegmentResultSide {
  /** The stored side, 0-based. */
  readonly side: number;
  /** Everyone on the side (competitors, speakers and whoever rides along), by id. */
  readonly personIds: readonly PersonId[];
  /** The teams listed on the side, by id. */
  readonly teamIds: readonly TeamId[];
}

/** What one run segment produced. Plain data: appliers read the world through `ctx.read`. */
export interface SegmentResult {
  readonly segmentId: SegmentId;
  readonly eventInstanceId: EventInstanceId;
  readonly promotionId: PromotionId;
  readonly brandId: BrandId | null;
  readonly date: GameDate;
  readonly importance: EventImportance;
  readonly regionId: RegionId;
  /** True when a human player runs the show. */
  readonly humanShow: boolean;
  readonly kind: SegmentKind;
  /** The stored slot, 0-based within its section. */
  readonly slot: number;
  readonly preShow: boolean;
  readonly roleKey: SlotRole;
  readonly durationClass: DurationClass;
  readonly sides: readonly SegmentResultSide[];
  /** How the match ended; null for an angle. */
  readonly outcome: MatchOutcome | null;
  /** Competitors only, by id. All three are empty for a no contest and an angle. */
  readonly winnerIds: readonly PersonId[];
  readonly loserIds: readonly PersonId[];
  readonly drawIds: readonly PersonId[];
  readonly storylineIds: readonly StorylineId[];
  readonly titleIds: readonly TitleId[];
  readonly finishKey: ContentKey | null;
  readonly methodKey: ContentKey | null;
  /** Whether the result can change a title, when the resolver decided it; null otherwise. */
  readonly titleCanChange: Traced<boolean> | null;
  /** The segment's score, 0 to 100. */
  readonly score: number;
  /** The segment's stars, 0 to 5 in quarter steps. */
  readonly stars: number;
}

/** What a system writes to react to every segment's result inside the shows phase. */
export interface SegmentResultApplier {
  /** `system.camelName`, like a phase id, for example `shows.titleOutcome`. */
  readonly id: string;
  /** Lower runs first; equal orders run by id. */
  readonly order: number;
  /**
   * Writes what the result means for the applier's own data. A throw rolls back the whole day's
   * shows, so bad data should be logged with `ctx.log` and skipped, never thrown.
   */
  readonly apply: (ctx: PhaseContext, result: SegmentResult) => void;
}

const appliers = new Map<string, SegmentResultApplier>();

function compareByOrderThenId(
  left: { readonly order: number; readonly id: string },
  right: { readonly order: number; readonly id: string },
): number {
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

function checkSeamId(what: string, id: string): void {
  if (!PHASE_ID_PATTERN.test(id)) {
    throw new RegistryError(
      `${what} "${id}": the id must look like "system.camelName", for example "shows.titleOutcome"`,
      { id },
    );
  }
}

/**
 * Adds a segment result applier.
 *
 * @throws RegistryError for a malformed id, an order that is not a finite number or an id that is
 *   already registered.
 */
export function registerSegmentResultApplier(def: SegmentResultApplier): void {
  checkSeamId('Segment result applier', def.id);
  if (!Number.isFinite(def.order)) {
    throw new RegistryError(
      `Segment result applier "${def.id}": the order must be a finite number`,
      {
        id: def.id,
      },
    );
  }
  if (appliers.has(def.id)) {
    throw new RegistryError(
      `Segment result applier "${def.id}": an applier with this id is already registered`,
      { id: def.id },
    );
  }
  appliers.set(def.id, { ...def });
}

/** Every registered applier, in the order they run: by `order`, then id. */
export function listSegmentResultAppliers(): SegmentResultApplier[] {
  return [...appliers.values()].sort(compareByOrderThenId);
}

/** Removes an applier. For tests. Returns false when no applier had that id. */
export function unregisterSegmentResultApplier(id: string): boolean {
  return appliers.delete(id);
}

// ---------------------------------------------------------------------------------------------
// Match outcome resolver

/** One side of a match as the resolver reads it: its competitors. */
export interface MatchOutcomeSide {
  readonly side: number;
  readonly personIds: readonly PersonId[];
}

/** What the resolver is asked about one match. */
export interface MatchOutcomeInput {
  readonly segmentId: SegmentId;
  readonly eventInstanceId: EventInstanceId;
  readonly promotionId: PromotionId;
  readonly regionId: RegionId;
  /** The booker's planned result, or null when the match is decided on the night. */
  readonly plan: MatchOutcome | null;
  /** The booker's planned finish, or null. */
  readonly plannedFinishKey: ContentKey | null;
  /** The sides with competitors, by side. */
  readonly sides: readonly MatchOutcomeSide[];
}

/** What the resolver may use. `rng` is the phase's own stream lookup. */
export interface MatchOutcomeDeps {
  readonly read: GameWorldView;
  readonly tunables: EngineTunables;
  readonly rng: (stream: StreamName) => RngStream;
}

/** How a match ended and why. */
export interface MatchOutcomeResolution {
  readonly outcome: MatchOutcome;
  readonly finishKey: ContentKey | null;
  readonly methodKey: ContentKey | null;
  /** Whether a title can change hands; null leaves it to the method's `changesTitles`. */
  readonly titleCanChange: Traced<boolean> | null;
  /** The decision, shown in the segment's Why? panel. */
  readonly trace: TraceNode;
}

/** What a system writes to decide every match's result on show night. */
export interface MatchOutcomeResolver {
  /** `system.camelName`, for example `match.resolveOutcome`. */
  readonly id: string;
  readonly resolve: (input: MatchOutcomeInput, deps: MatchOutcomeDeps) => MatchOutcomeResolution;
}

export const OUTCOME_DECISION_LABEL = 'How the match ended';
export const BOOKED_RESULT_REASON = 'Booked result';
export const NO_PLAN_NO_CONTEST_REASON =
  'No winner was planned for this match, so it ends as a no contest';

/**
 * The built-in resolver: a planned result is used as booked; a match with no plan ends as a no
 * contest. It leaves the finish null and the title rule to the method's `changesTitles`.
 */
export const plannedOrNoContest: MatchOutcomeResolver = {
  id: 'shows.plannedOrNoContest',
  resolve: (input) => {
    const decision = startDecision<MatchOutcome['kind']>(OUTCOME_DECISION_LABEL);
    if (input.plan === null) {
      const chosen = decision.choose('noContest', NO_PLAN_NO_CONTEST_REASON);
      return {
        outcome: { kind: 'noContest' },
        finishKey: null,
        methodKey: null,
        titleCanChange: null,
        trace: chosen.trace,
      };
    }
    const chosen = decision.choose(input.plan.kind, BOOKED_RESULT_REASON);
    return {
      outcome: input.plan,
      finishKey: null,
      methodKey: input.plan.kind === 'win' ? input.plan.methodKey : null,
      titleCanChange: null,
      trace: chosen.trace,
    };
  },
};

let registeredResolver: MatchOutcomeResolver | null = null;

/**
 * Installs the match outcome resolver.
 *
 * @throws RegistryError for a malformed id, or when a resolver is already registered.
 */
export function registerMatchOutcomeResolver(def: MatchOutcomeResolver): void {
  checkSeamId('Match outcome resolver', def.id);
  if (registeredResolver !== null) {
    throw new RegistryError(
      `Match outcome resolver "${def.id}": "${registeredResolver.id}" is already registered, and only one may be`,
      { id: def.id, registered: registeredResolver.id },
    );
  }
  registeredResolver = { ...def };
}

/** The resolver the shows phase uses: the registered one, else `plannedOrNoContest`. */
export function matchOutcomeResolver(): MatchOutcomeResolver {
  return registeredResolver ?? plannedOrNoContest;
}

/** Removes the registered resolver when its id is `id`. For tests. */
export function unregisterMatchOutcomeResolver(id: string): boolean {
  if (registeredResolver?.id !== id) {
    return false;
  }
  registeredResolver = null;
  return true;
}
