import { create } from 'zustand';
import type {
  ContentKey,
  EventImportance,
  GameDate,
  LabOptions,
  LabWorkerRow,
  PersonId,
  PlannedWinner,
  PreviewAngleArgs,
  PreviewArgs,
  PreviewBatchResult,
  PreviewExtensionArgs,
  PreviewResult,
  PromotionId,
  RegionId,
  SegmentKind,
  SimulateArgs,
  SimulateBatchResult,
  SimulateResult,
  SlotRole,
} from '@ringside/engine';
import { PREVIEW_MAX_SIDE_SIZE, PREVIEW_SEED_MAX } from '@ringside/engine';
import { useSessionStore } from '@/app/session/sessionStore';
import type { BeatDraft } from '@/components/BeatEditor';

/** The most sides the lab builds: the most a preview takes. */
export const LAB_MAX_SIDES = 30;

/** The most people one side holds: the most a preview takes. */
export const LAB_MAX_SIDE_SIZE = PREVIEW_MAX_SIDE_SIZE;

/** The most nights one Run plays out (the Runs slider's top). */
export const LAB_MAX_RUNS = 100;

/** The Runs a fresh lab starts with: one night, shown in full. */
export const LAB_DEFAULT_RUNS = 1;

/** What the segment is and the show it is on. */
export interface LabSetup {
  readonly kind: SegmentKind;
  /** The match type or angle type; null until the catalog gives one. */
  readonly typeKey: ContentKey | null;
  readonly slotRole: SlotRole;
  readonly importance: EventImportance;
  /** Null on a world with no regions. */
  readonly regionId: RegionId | null;
  readonly televised: boolean;
  /** The promotion running the show; null for a seat that runs none. */
  readonly promotionId: PromotionId | null;
}

/**
 * The result a Run plays out for a match (MTCH2-04): who wins (Auto, a stored 0-based side or a
 * Draw) and the finish (null for Auto). The winner goes back to Auto when the match type changes.
 */
export interface LabResultPlan {
  readonly winner: PlannedWinner;
  readonly finishKey: ContentKey | null;
}

/**
 * The segment's crew. MTCH4-05's Physical panel sets the producer until MTCH8's Crew section
 * takes over the same field.
 */
export interface LabCrew {
  readonly producerId: PersonId | null;
}

/** A lab with no producer. */
export const NO_CREW: LabCrew = { producerId: null };

/**
 * Angle mode's draft (MTCH5-05): the angle type, its beats with the people in each group and the
 * manager what-ifs. Kept for the session only, never saved to the world.
 */
export interface LabAngleDraft {
  /** Null until Angle mode is first opened. */
  readonly angleTypeKey: ContentKey | null;
  readonly beats: readonly BeatDraft[];
  /**
   * Who talks for a person instead of their contract's manager: a manager's id, or null for "No
   * manager". Someone left out keeps their contract's manager.
   */
  readonly managerOverrides: Readonly<Record<PersonId, PersonId | null>>;
  /** What the pickers knew about each person placed or chosen as a manager. */
  readonly people: Readonly<Record<PersonId, LabWorkerRow>>;
}

/** An empty draft: Angle mode fills it with the first type's default beat when it opens. */
export const EMPTY_ANGLE_DRAFT: LabAngleDraft = {
  angleTypeKey: null,
  beats: [],
  managerOverrides: {},
  people: {},
};

/** The angle Run on screen: the arguments `match.previewAngle` was asked with. */
export interface LabAngleRun {
  readonly args: PreviewAngleArgs;
}

/** The plan a fresh lab, or a new match type, starts with. */
export const AUTO_RESULT_PLAN: LabResultPlan = { winner: 'auto', finishKey: null };

/**
 * A batch's summary: `match.simulateBatch`'s (with the outcome counts) for a match,
 * `match.previewBatch`'s for a talking segment.
 */
export type LabBatch = PreviewBatchResult | SimulateBatchResult;

/** True for a match batch, which counts who won and how. */
export function isSimulateBatch(batch: LabBatch): batch is SimulateBatchResult {
  return 'sides' in batch;
}

/**
 * One Run's answer (MTCH2-07), kept until the next Run or until the world changes. Every Run rolls
 * on a fresh seed; with Runs above 1 the night shown in full is the batch's last.
 */
export interface LabRun {
  /** The arguments of the night shown in full. */
  readonly args: PreviewArgs;
  /** The plan the match played out; null when nothing was simulated (a talking segment). */
  readonly plan: LabResultPlan | null;
  /** The night shown in full: its rating, warnings and worker lines. */
  readonly rating: PreviewResult;
  /** The same night's winner and finish; null for a talking segment. */
  readonly simulation: SimulateResult | null;
  /** How many nights the Run played out. */
  readonly runs: number;
  /** The summary of every night; null with Runs at 1. */
  readonly batch: LabBatch | null;
  /** The game date the run was rated on, so a result from before a Next Day says so. */
  readonly date: GameDate | null;
}

export interface LabState {
  /** False until the lab's defaults have been read from `match.labOptions`. */
  readonly seeded: boolean;
  readonly setup: LabSetup;
  /** One list of people per side, in the order they were added. */
  readonly sides: readonly (readonly PersonId[])[];
  /** What the picker knew about each person placed, for their chips until a fresher list arrives. */
  readonly people: Readonly<Record<PersonId, LabWorkerRow>>;
  /** How many nights the next Run plays out, 1 to {@link LAB_MAX_RUNS}. */
  readonly runs: number;
  /** The Run on screen, or null before the first. */
  readonly lastRun: LabRun | null;
  /** The result a match's Run plays out. */
  readonly result: LabResultPlan;
  /** The segment's crew (the producer). */
  readonly crew: LabCrew;
  /**
   * The Physical panel's "Fatigue going in" what-ifs (MTCH4-05), 0 to 100 by person: a preview
   * only, never the world.
   */
  readonly fatigueOverrides: Readonly<Partial<Record<PersonId, number>>>;
  /** True while a Run is on its way. */
  readonly pending: boolean;
  /** The engine's reasons for refusing the last request, in player words. */
  readonly refusal: readonly string[];
  /** Angle mode's draft (MTCH5-05). */
  readonly angle: LabAngleDraft;
  /** The angle Run asked for last, or null before the first. */
  readonly angleRun: LabAngleRun | null;

  readonly seed: (options: LabOptions, sideCount: number) => void;
  readonly setKind: (kind: SegmentKind, typeKey: ContentKey | null, sideCount: number) => void;
  readonly setType: (typeKey: ContentKey, sideCount: number) => void;
  readonly setSlotRole: (slotRole: SlotRole) => void;
  readonly setImportance: (importance: EventImportance) => void;
  readonly setRegion: (regionId: RegionId) => void;
  readonly setTelevised: (televised: boolean) => void;
  /** The promotion the segment is rated as (the "Rate as" select). */
  readonly setPromotion: (promotionId: PromotionId) => void;
  readonly addPerson: (side: number, row: LabWorkerRow) => boolean;
  readonly removePerson: (side: number, personId: PersonId) => void;
  readonly addSide: () => void;
  readonly removeSide: (side: number) => void;
  readonly clearAll: () => void;
  readonly setWinner: (winner: PlannedWinner) => void;
  readonly setFinish: (finishKey: ContentKey | null) => void;
  /** Sets the producer, or none. */
  readonly setProducer: (producerId: PersonId | null) => void;
  /** Sets one worker's fatigue what-if, or clears it with null ("As now"). */
  readonly setFatigueOverride: (personId: PersonId, fatigue: number | null) => void;
  /** Sets Runs, kept whole and within 1 to {@link LAB_MAX_RUNS}. */
  readonly setRuns: (runs: number) => void;
  readonly startRequest: () => number;
  readonly finishRun: (ticket: number, run: LabRun) => void;
  readonly failRequest: (ticket: number, reasons: readonly string[]) => void;
  /** Changes Angle mode's draft; the fields left out stay. */
  readonly setAngle: (change: Partial<LabAngleDraft>) => void;
  /** Asks for an angle Run with these arguments. */
  readonly runAngle: (args: PreviewAngleArgs) => void;
  /** Back to an empty, unseeded lab: the world changed. */
  readonly reset: () => void;
}

const EMPTY_SETUP: LabSetup = {
  kind: 'match',
  typeKey: null,
  slotRole: 'midcard',
  importance: 'regular',
  regionId: null,
  televised: true,
  promotionId: null,
};

const EMPTY_LAB = {
  seeded: false,
  setup: EMPTY_SETUP,
  sides: [[], []],
  people: {},
  runs: LAB_DEFAULT_RUNS,
  lastRun: null,
  result: AUTO_RESULT_PLAN,
  crew: NO_CREW,
  fatigueOverrides: {},
  pending: false,
  refusal: [],
  angle: EMPTY_ANGLE_DRAFT,
  angleRun: null,
} as const satisfies Partial<LabState>;

/** Counts requests, so an answer that arrives after a reset (or a newer request) is dropped. */
let requestTicket = 0;

/**
 * `sides` resized to `count`: empty sides are added or taken off the end, but a side someone is
 * standing on is never dropped, so choosing a new match type keeps everyone already placed.
 */
export function resizeSides(
  sides: readonly (readonly PersonId[])[],
  count: number,
): (readonly PersonId[])[] {
  const next = [...sides];
  while (next.length > count && next.at(-1)?.length === 0) next.pop();
  while (next.length < count) next.push([]);
  return next;
}

/** The side a person stands on (0-based), or null. */
export function sideOf(sides: readonly (readonly PersonId[])[], personId: PersonId): number | null {
  const index = sides.findIndex((side) => side.includes(personId));
  return index === -1 ? null : index;
}

/**
 * The preview arguments the lab would send now with `previewSeed`, or null while something is
 * missing: a type, a region, a promotion, or someone on every side.
 */
export function previewArgsOf(
  state: Pick<LabState, 'setup' | 'sides'> & Partial<Pick<LabState, 'crew'>>,
  previewSeed: number,
): PreviewArgs | null {
  const { setup, sides } = state;
  const producerId = state.crew?.producerId ?? null;
  if (setup.typeKey === null || setup.regionId === null || setup.promotionId === null) return null;
  if (sides.length === 0 || sides.some((side) => side.length === 0)) return null;
  return {
    kind: setup.kind,
    typeKey: setup.typeKey,
    sides: sides.map((side) => [...side]),
    slotRole: setup.slotRole,
    importance: setup.importance,
    regionId: setup.regionId,
    televised: setup.televised,
    promotionId: setup.promotionId,
    previewSeed,
    ...(producerId === null ? {} : { crew: { producerId } }),
  };
}

/**
 * The preview extensions a match's Run asks for (MTCH4-05): the Physical panel's toll, with the
 * what-ifs of the people on a side.
 */
export function labExtensionsOf(
  state: Pick<LabState, 'sides' | 'fatigueOverrides'>,
): PreviewExtensionArgs {
  const fatigueOverrides: Record<PersonId, number> = {};
  for (const personId of state.sides.flat()) {
    const fatigue = state.fatigueOverrides[personId];
    if (fatigue !== undefined) fatigueOverrides[personId] = fatigue;
  }
  return {
    physical: Object.keys(fatigueOverrides).length === 0 ? {} : { fatigueOverrides },
  };
}

/** The Simulate arguments for a match: its preview arguments plus the plan to play out. */
export function simulateArgsOf(args: PreviewArgs, plan: LabResultPlan): SimulateArgs {
  return { ...args, winner: plan.winner, finishKey: plan.finishKey, methodKey: null };
}

/** Runs as the slider may hold it: whole, 1 to {@link LAB_MAX_RUNS}. */
export function clampRuns(runs: number): number {
  if (!Number.isFinite(runs)) return LAB_DEFAULT_RUNS;
  return Math.min(LAB_MAX_RUNS, Math.max(1, Math.round(runs)));
}

/** A whole number from 0 to 2^32 − 1 from the browser's random source. */
function randomUint32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

/**
 * A fresh seed for a Run of `runs` nights: night `i` rolls with the seed plus `i`, so the seed is
 * picked low enough that the last night's seed is still a valid preview seed. The engine stays
 * deterministic for a given seed; only the lab picks a new one every time.
 */
export function freshSeed(runs: number, random: () => number = randomUint32): number {
  const choices = PREVIEW_SEED_MAX - (clampRuns(runs) - 1) + 1;
  return random() % choices;
}

/** True when two plans ask for the same result. */
export function samePlan(left: LabResultPlan, right: LabResultPlan): boolean {
  const sameWinner =
    typeof left.winner === 'object' && typeof right.winner === 'object'
      ? left.winner.side === right.winner.side
      : left.winner === right.winner;
  return sameWinner && left.finishKey === right.finishKey;
}

/** True when two previews rate the same segment, whatever their seeds. */
export function sameSegment(left: PreviewArgs, right: PreviewArgs): boolean {
  return (
    left.kind === right.kind &&
    left.typeKey === right.typeKey &&
    left.slotRole === right.slotRole &&
    left.importance === right.importance &&
    left.regionId === right.regionId &&
    left.televised === right.televised &&
    left.promotionId === right.promotionId &&
    (left.crew?.producerId ?? null) === (right.crew?.producerId ?? null) &&
    left.sides.length === right.sides.length &&
    left.sides.every(
      (side, index) =>
        side.length === right.sides[index]?.length &&
        side.every((personId, place) => right.sides[index]?.[place] === personId),
    )
  );
}

/**
 * True when the setup, the sides or (for a match) the winner and finish changed after the Run on
 * screen: the result says "Out of date: run again" rather than re-running on every change. Runs
 * and the seed are not part of it.
 */
export function isOutOfDate(
  state: Pick<LabState, 'setup' | 'sides' | 'result'> & Partial<Pick<LabState, 'crew'>>,
  shown: Pick<LabRun, 'args' | 'plan'> | null,
): boolean {
  if (shown === null) return false;
  const current = previewArgsOf(state, shown.args.previewSeed);
  if (current === null || !sameSegment(current, shown.args)) return true;
  return shown.plan !== null && !samePlan(state.result, shown.plan);
}

/** The plan with a removed side's winner put back to Auto (later sides move down one). */
function planWithoutSide(plan: LabResultPlan, side: number): LabResultPlan {
  return typeof plan.winner === 'object' && plan.winner.side >= side
    ? { ...plan, winner: 'auto' }
    : plan;
}

/**
 * The Match lab's state: the setup, the sides, the result plan, Runs and the last answer. It lives for the
 * session, so leaving the lab and coming back keeps the line-up, and it empties when the session's
 * world changes (a load, a new game, a quit).
 */
export const useLabStore = create<LabState>()((set, get) => ({
  ...EMPTY_LAB,
  seed: (options, sideCount) => {
    if (get().seeded) return;
    const { defaults } = options;
    set({
      seeded: true,
      sides: resizeSides([], sideCount),
      setup: {
        kind: defaults.kind,
        typeKey: defaults.typeKey,
        slotRole: defaults.slotRole,
        importance: defaults.importance,
        regionId: defaults.regionId,
        televised: defaults.televised,
        promotionId: options.promotion?.id ?? null,
      },
    });
  },
  setKind: (kind, typeKey, sideCount) => {
    set((state) => ({
      setup: { ...state.setup, kind, typeKey },
      sides: resizeSides(state.sides, sideCount),
      result: AUTO_RESULT_PLAN,
    }));
  },
  setType: (typeKey, sideCount) => {
    set((state) => {
      const sides = resizeSides(state.sides, sideCount);
      return {
        setup: { ...state.setup, typeKey },
        sides,
        // A new match type puts the winner back to Auto; the finish stays while the new type
        // allows it (the Finish select resets it, and says so, when it doesn't).
        result:
          typeKey === state.setup.typeKey ? state.result : { ...state.result, winner: 'auto' },
      };
    });
  },
  setSlotRole: (slotRole) => {
    set((state) => ({ setup: { ...state.setup, slotRole } }));
  },
  setImportance: (importance) => {
    set((state) => ({ setup: { ...state.setup, importance } }));
  },
  setRegion: (regionId) => {
    set((state) => ({ setup: { ...state.setup, regionId } }));
  },
  setTelevised: (televised) => {
    set((state) => ({ setup: { ...state.setup, televised } }));
  },
  setPromotion: (promotionId) => {
    set((state) => ({ setup: { ...state.setup, promotionId } }));
  },
  addPerson: (side, row) => {
    const { sides, people } = get();
    const target = sides[side];
    if (target === undefined || target.length >= LAB_MAX_SIDE_SIZE) return false;
    if (sideOf(sides, row.personId) !== null) return false;
    set({
      sides: sides.map((members, index) => (index === side ? [...members, row.personId] : members)),
      people: { ...people, [row.personId]: row },
    });
    return true;
  },
  removePerson: (side, personId) => {
    set((state) => ({
      sides: state.sides.map((members, index) =>
        index === side ? members.filter((member) => member !== personId) : members,
      ),
    }));
  },
  addSide: () => {
    set((state) => (state.sides.length >= LAB_MAX_SIDES ? {} : { sides: [...state.sides, []] }));
  },
  removeSide: (side) => {
    set((state) =>
      state.sides.length <= 1
        ? {}
        : {
            sides: state.sides.filter((_, index) => index !== side),
            result: planWithoutSide(state.result, side),
          },
    );
  },
  clearAll: () => {
    set((state) => ({ sides: state.sides.map(() => []) }));
  },
  setWinner: (winner) => {
    set((state) => ({ result: { ...state.result, winner } }));
  },
  setFinish: (finishKey) => {
    set((state) => ({ result: { ...state.result, finishKey } }));
  },
  setProducer: (producerId) => {
    set({ crew: { producerId } });
  },
  setFatigueOverride: (personId, fatigue) => {
    set((state) => {
      const next: Partial<Record<PersonId, number>> = {};
      // Keeps the what-ifs of the people still on a side; anyone else's is dropped.
      for (const id of state.sides.flat()) {
        const value = state.fatigueOverrides[id];
        if (id !== personId && value !== undefined) next[id] = value;
      }
      if (fatigue !== null) next[personId] = fatigue;
      return { fatigueOverrides: next };
    });
  },
  setRuns: (runs) => {
    set({ runs: clampRuns(runs) });
  },
  startRequest: () => {
    requestTicket += 1;
    set({ pending: true, refusal: [] });
    return requestTicket;
  },
  finishRun: (ticket, run) => {
    if (ticket !== requestTicket) return;
    set({ pending: false, lastRun: run });
  },
  failRequest: (ticket, reasons) => {
    if (ticket !== requestTicket) return;
    set({ pending: false, refusal: reasons });
  },
  setAngle: (change) => {
    set((state) => ({ angle: { ...state.angle, ...change } }));
  },
  runAngle: (args) => {
    set({ angleRun: { args } });
  },
  reset: () => {
    requestTicket += 1;
    set(EMPTY_LAB);
  },
}));

// A different seat means a different world (or none): the lab starts again from its defaults.
useSessionStore.subscribe((state, previous) => {
  if (state.seat !== previous.seat) useLabStore.getState().reset();
});
