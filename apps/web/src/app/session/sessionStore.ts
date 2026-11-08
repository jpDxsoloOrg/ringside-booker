import { create } from 'zustand';
import type { LoadIssue } from '@ringside/engine';
import type { LocalSeat } from '@/worker/localViewer';

/**
 * The seat this device plays: the viewer and controller the engine host injects into every call,
 * and the promotion that controller runs (null while unemployed). The engine host works it out
 * when a world loads (`resolveLocalViewer`); nothing in the UI names "the player's promotion" on
 * its own.
 */
export type { LocalSeat };

export interface LoadedSession {
  readonly saveSlotId: string | null;
  readonly seat: LocalSeat;
}

/**
 * What the shell tells the player once after a load: the format upgrades that ran on the save and
 * the problems the load worked around (such as dropped unknown tunable overrides).
 */
export interface LoadNotice {
  /** The titles of the upgrades that ran, oldest first. */
  readonly upgrades: readonly string[];
  readonly warnings: readonly LoadIssue[];
}

export interface SessionState {
  /** Whether a world is loaded in the engine, which is what the in-game routes need. */
  readonly worldLoaded: boolean;
  /** The save slot the world came from, or null for a world not saved yet. */
  readonly saveSlotId: string | null;
  readonly seat: LocalSeat | null;
  /** The one-time notice about the load that started this session, until it is dismissed. */
  readonly loadNotice: LoadNotice | null;
  /** Called by the engine host and the load screens once a world is ready. */
  readonly setLoaded: (session: LoadedSession) => void;
  /** Back to "no world", for example after quitting to the title screen for good. */
  readonly clear: () => void;
  /** Shows the load notice in the shell. */
  readonly showLoadNotice: (notice: LoadNotice) => void;
  readonly dismissLoadNotice: () => void;
}

const EMPTY_SESSION = {
  worldLoaded: false,
  saveSlotId: null,
  seat: null,
  loadNotice: null,
} as const;

/**
 * UI-only session state: is a world loaded, and whose seat is this. Game data stays in the
 * engine; this store exists so routing can decide without a round trip to the worker.
 * The engine host and the load screens write it; the shell only reads it.
 */
export const useSessionStore = create<SessionState>()((set) => ({
  ...EMPTY_SESSION,
  setLoaded: ({ saveSlotId, seat }) => {
    set({ worldLoaded: true, saveSlotId, seat, loadNotice: null });
  },
  clear: () => {
    set(EMPTY_SESSION);
  },
  showLoadNotice: (loadNotice) => {
    set({ loadNotice });
  },
  dismissLoadNotice: () => {
    set({ loadNotice: null });
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
