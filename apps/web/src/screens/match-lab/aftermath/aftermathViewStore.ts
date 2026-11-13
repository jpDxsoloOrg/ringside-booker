import { create } from 'zustand';
import type { AftermathLevel } from './aftermathText';

/**
 * The Aftermath panel's viewer conveniences (MTCH3-04): which level the popularity figures are
 * shown at. Part of the Match lab's in-memory state, never in the save, and kept when the lab
 * resets for a new world: it is how this viewer likes to read the panel, not part of the setup.
 */
export interface AftermathViewState {
  readonly level: AftermathLevel;
  readonly setLevel: (level: AftermathLevel) => void;
}

export const useAftermathViewStore = create<AftermathViewState>()((set) => ({
  level: 'region',
  setLevel: (level) => {
    set({ level });
  },
}));
