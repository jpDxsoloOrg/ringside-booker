import { create } from 'zustand';
import type {
  ContentKey,
  EventImportance,
  GameDate,
  LabOptions,
  LabWorkerRow,
  PersonId,
  PlannedWinner,
  PreviewArgs,
  PreviewBatchArgs,
  PreviewBatchResult,
  PreviewResult,
  PromotionId,
  RegionId,
  SegmentKind,
  SimulateArgs,
  SimulateResult,
  SlotRole,
} from '@ringside/engine';
import { PREVIEW_MAX_SIDE_SIZE, PREVIEW_SEED_MAX } from '@ringside/engine';
import { useSessionStore } from '@/app/session/sessionStore';

/** The most sides the lab builds: the most a preview takes. */
export const LAB_MAX_SIDES = 30;

/** The most people one side holds: the most a preview takes. */
export const LAB_MAX_SIDE_SIZE = PREVIEW_MAX_SIDE_SIZE;

/** The seed a fresh lab rolls with. */
export const LAB_FIRST_SEED = 1;

/** How many nights Run x100 rolls. */
export const LAB_BATCH_RUNS = 100;

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

/** One Run's answer, kept until the next Run or until the world changes. */
export interface LabRun {
  readonly args: PreviewArgs;
  readonly result: PreviewResult;
  /** The game date the run was rated on, so a result from before a Next Day says so. */
  readonly date: GameDate | null;
}

/** One Run x100's answer. */
export interface LabBatchRun {
  readonly args: PreviewBatchArgs;
  readonly result: PreviewBatchResult;
  readonly date: GameDate | null;
}

/**
 * The result the lab plays out on Simulate (MTCH2-04): who wins (Auto, a stored 0-based side or a
 * Draw) and the finish (null for Auto). The winner goes back to Auto when the match type changes.
 */
export interface LabResultPlan {
  readonly winner: PlannedWinner;
  readonly finishKey: ContentKey | null;
}

/** The plan a fresh lab, or a new match type, starts with. */
export const AUTO_RESULT_PLAN: LabResultPlan = { winner: 'auto', finishKey: null };

/** One Simulate's answer, kept until the next Run or Simulate, or until the world changes. */
export interface LabSimulation {
  readonly args: SimulateArgs;
  readonly result: SimulateResult;
  readonly date: GameDate | null;
}

/** Which button's request is on its way. */
export type LabPending = 'run' | 'batch' | 'simulate' | null;

export interface LabState {
  /** False until the lab's defaults have been read from `match.labOptions`. */
  readonly seeded: boolean;
  readonly setup: LabSetup;
  /** One list of people per side, in the order they were added. */
  readonly sides: readonly (readonly PersonId[])[];
  /** What the picker knew about each person placed, for their chips until a fresher list arrives. */
  readonly people: Readonly<Record<PersonId, LabWorkerRow>>;
  /** The seed the next Run rolls with. */
  readonly previewSeed: number;
  /** The arguments of the Run on screen, or null before the first. */
  readonly submitted: PreviewArgs | null;
  /** The arguments of the Run x100 on screen, or null. */
  readonly batch: PreviewBatchArgs | null;
  readonly lastRun: LabRun | null;
  readonly lastBatch: LabBatchRun | null;
  /** The result Simulate plays out. */
  readonly result: LabResultPlan;
  /** The Simulate on screen, or null (a Run replaces it). */
  readonly simulation: LabSimulation | null;
  readonly pending: LabPending;
  /** The engine's reasons for refusing the last request, in player words. */
  readonly refusal: readonly string[];

  readonly seed: (options: LabOptions, sideCount: number) => void;
  readonly setKind: (kind: SegmentKind, typeKey: ContentKey | null, sideCount: number) => void;
  readonly setType: (typeKey: ContentKey, sideCount: number) => void;
  readonly setSlotRole: (slotRole: SlotRole) => void;
  readonly setImportance: (importance: EventImportance) => void;
  readonly setRegion: (regionId: RegionId) => void;
  readonly setTelevised: (televised: boolean) => void;
  readonly addPerson: (side: number, row: LabWorkerRow) => boolean;
  readonly removePerson: (side: number, personId: PersonId) => void;
  readonly addSide: () => void;
  readonly removeSide: (side: number) => void;
  readonly clearAll: () => void;
  readonly setWinner: (winner: PlannedWinner) => void;
  readonly setFinish: (finishKey: ContentKey | null) => void;
  readonly nextSeed: () => void;
  readonly startRequest: (pending: Exclude<LabPending, null>) => number;
  readonly finishRun: (ticket: number, run: LabRun) => void;
  readonly finishBatch: (ticket: number, batch: LabBatchRun) => void;
  readonly finishSimulation: (ticket: number, simulation: LabSimulation) => void;
  readonly failRequest: (ticket: number, reasons: readonly string[]) => void;
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
  previewSeed: LAB_FIRST_SEED,
  submitted: null,
  batch: null,
  lastRun: null,
  lastBatch: null,
  result: AUTO_RESULT_PLAN,
  simulation: null,
  pending: null,
  refusal: [],
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
 * The preview arguments the lab would send now, or null while something is missing: a type, a
 * region, a promotion, or someone on every side.
 */
export function previewArgsOf(
  state: Pick<LabState, 'setup' | 'sides' | 'previewSeed'>,
): PreviewArgs | null {
  const { setup, sides, previewSeed } = state;
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
  };
}

/**
 * The Simulate arguments the lab would send now: the preview arguments plus the result plan, or
 * null while something is missing or the segment is a talking segment (nobody wins one).
 */
export function simulateArgsOf(
  state: Pick<LabState, 'setup' | 'sides' | 'previewSeed' | 'result'>,
): SimulateArgs | null {
  const args = previewArgsOf(state);
  if (args?.kind !== 'match') return null;
  return {
    ...args,
    winner: state.result.winner,
    finishKey: state.result.finishKey,
    methodKey: null,
  };
}

/** The preview arguments inside Simulate's, without the plan. */
export function previewPartOf(args: SimulateArgs): PreviewArgs {
  return {
    kind: args.kind,
    typeKey: args.typeKey,
    sides: args.sides,
    slotRole: args.slotRole,
    importance: args.importance,
    regionId: args.regionId,
    televised: args.televised,
    ...(args.promotionId === undefined ? {} : { promotionId: args.promotionId }),
    previewSeed: args.previewSeed,
  };
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
    left.sides.length === right.sides.length &&
    left.sides.every(
      (side, index) =>
        side.length === right.sides[index]?.length &&
        side.every((personId, place) => right.sides[index]?.[place] === personId),
    )
  );
}

/**
 * True when the setup or the sides changed after the result on screen was rated: the screen says
 * "Out of date: run again" rather than re-rating on every change.
 */
export function isOutOfDate(
  state: Pick<LabState, 'setup' | 'sides' | 'previewSeed'>,
  shown: PreviewArgs | null,
): boolean {
  if (shown === null) return false;
  const current = previewArgsOf(state);
  return current === null || !sameSegment(current, shown);
}

/** True when the setup, the sides or the result plan changed after the Simulate on screen. */
export function isSimulationOutOfDate(
  state: Pick<LabState, 'setup' | 'sides' | 'previewSeed' | 'result'>,
  shown: SimulateArgs | null,
): boolean {
  if (shown === null) return false;
  return (
    isOutOfDate(state, previewPartOf(shown)) ||
    !samePlan(state.result, { winner: shown.winner, finishKey: shown.finishKey })
  );
}

/** The plan with a removed side's winner put back to Auto (later sides move down one). */
function planWithoutSide(plan: LabResultPlan, side: number): LabResultPlan {
  return typeof plan.winner === 'object' && plan.winner.side >= side
    ? { ...plan, winner: 'auto' }
    : plan;
}

/**
 * The Match lab's state: the setup, the sides, the seed and the last answers. It lives for the
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
  nextSeed: () => {
    set((state) => ({
      previewSeed: state.previewSeed >= PREVIEW_SEED_MAX ? LAB_FIRST_SEED : state.previewSeed + 1,
    }));
  },
  startRequest: (pending) => {
    requestTicket += 1;
    set({ pending, refusal: [] });
    return requestTicket;
  },
  finishRun: (ticket, run) => {
    if (ticket !== requestTicket) return;
    // A new single night replaces the batch too, unless the batch is of this very segment.
    const { lastBatch } = get();
    const keepBatch = lastBatch !== null && sameSegment(lastBatch.args, run.args);
    set({
      pending: null,
      submitted: run.args,
      lastRun: run,
      simulation: null,
      ...(keepBatch ? {} : { batch: null, lastBatch: null }),
    });
  },
  finishBatch: (ticket, batch) => {
    if (ticket !== requestTicket) return;
    set({ pending: null, batch: batch.args, lastBatch: batch });
  },
  finishSimulation: (ticket, simulation) => {
    if (ticket !== requestTicket) return;
    // The simulated night is also the Run on screen: its rating, warnings and worker lines.
    const args = previewPartOf(simulation.args);
    const { lastBatch } = get();
    const keepBatch = lastBatch !== null && sameSegment(lastBatch.args, args);
    set({
      pending: null,
      submitted: args,
      lastRun: { args, result: simulation.result.preview, date: simulation.date },
      simulation,
      ...(keepBatch ? {} : { batch: null, lastBatch: null }),
    });
  },
  failRequest: (ticket, reasons) => {
    if (ticket !== requestTicket) return;
    set({ pending: null, refusal: reasons });
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
