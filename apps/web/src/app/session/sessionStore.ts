import { create } from 'zustand';
import type { Controller, PromotionId } from '@ringside/engine';

/**
 * Who is looking at the world. Mirrors the engine's `Viewer` (a controller, or the all-seeing view
 * tools and tests use), which the engine API ticket adds to `@ringside/engine`.
 *
 * TODO(UI-08): import `Viewer` from `@ringside/engine` and `LocalSeat` from
 * `@/worker/localViewer` once the engine host lands, and delete these local copies.
 */
export type Viewer =
  | { readonly kind: 'controller'; readonly controller: Controller }
  | { readonly kind: 'omniscient' };

/**
 * The seat this device plays: the viewer and controller the engine host injects into every call,
 * and the promotion that controller runs (null while unemployed). The engine host works it out
 * when a world loads; nothing in the UI names "the player's promotion" on its own.
 */
export interface LocalSeat {
  readonly viewer: Viewer;
  readonly controller: Controller;
  readonly promotionId: PromotionId | null;
}

export interface LoadedSession {
  readonly saveSlotId: string | null;
  readonly seat: LocalSeat;
}

export interface SessionState {
  /** Whether a world is loaded in the engine, which is what the in-game routes need. */
  readonly worldLoaded: boolean;
  /** The save slot the world came from, or null for a world not saved yet. */
  readonly saveSlotId: string | null;
  readonly seat: LocalSeat | null;
  /** Called by the engine host and the load screens once a world is ready. */
  readonly setLoaded: (session: LoadedSession) => void;
  /** Back to "no world", for example after quitting to the title screen for good. */
  readonly clear: () => void;
}

const EMPTY_SESSION = { worldLoaded: false, saveSlotId: null, seat: null } as const;

/**
 * UI-only session state: is a world loaded, and whose seat is this. Game data stays in the
 * engine; this store exists so routing can decide without a round trip to the worker.
 * The engine host and the load screens write it; the shell only reads it.
 */
export const useSessionStore = create<SessionState>()((set) => ({
  ...EMPTY_SESSION,
  setLoaded: ({ saveSlotId, seat }) => {
    set({ worldLoaded: true, saveSlotId, seat });
  },
  clear: () => {
    set(EMPTY_SESSION);
  },
}));

/** True when the local seat runs a promotion. False while unemployed or with no world loaded. */
export function selectHasPromotion(state: SessionState): boolean {
  return state.seat?.promotionId != null;
}

/** Whether the local seat runs a promotion, kept current as the session changes. */
export function useHasPromotion(): boolean {
  return useSessionStore(selectHasPromotion);
}

/** Whether a world is loaded. */
export function useWorldLoaded(): boolean {
  return useSessionStore((state) => state.worldLoaded);
}
