import { create } from 'zustand';
import type {
  ContentKey,
  EventImportance,
  GameDate,
  LabOptions,
  LabWorkerRow,
  PersonId,
  PreviewArgs,
  PreviewBatchArgs,
  PreviewBatchResult,
  PreviewResult,
  PromotionId,
  RegionId,
  SegmentKind,
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

/** Which button's request is on its way. */
export type LabPending = 'run' | 'batch' | null;

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
  readonly nextSeed: () => void;
  readonly startRequest: (pending: Exclude<LabPending, null>) => number;
  readonly finishRun: (ticket: number, run: LabRun) => void;
  readonly finishBatch: (ticket: number, batch: LabBatchRun) => void;
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
    }));
  },
  setType: (typeKey, sideCount) => {
    set((state) => ({
      setup: { ...state.setup, typeKey },
      sides: resizeSides(state.sides, sideCount),
    }));
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
      state.sides.length <= 1 ? {} : { sides: state.sides.filter((_, index) => index !== side) },
    );
  },
  clearAll: () => {
    set((state) => ({ sides: state.sides.map(() => []) }));
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
      ...(keepBatch ? {} : { batch: null, lastBatch: null }),
    });
  },
  finishBatch: (ticket, batch) => {
    if (ticket !== requestTicket) return;
    set({ pending: null, batch: batch.args, lastBatch: batch });
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
