/**
 * One "Why?" panel at a time. Every `WhyButton` owns a panel, and this store says which one is
 * open: opening another replaces it, so phones never stack sheets and focus always goes back to
 * the button that opened the panel on screen.
 */
import { create } from 'zustand';

export interface TracePanelState {
  /** The id of the panel that is open, or null. */
  readonly openPanelId: string | null;
  /** Opens this panel, closing any other. */
  readonly openPanel: (panelId: string) => void;
  /** Closes this panel, if it is the open one. */
  readonly closePanel: (panelId: string) => void;
}

export const useTracePanelStore = create<TracePanelState>()((set) => ({
  openPanelId: null,
  openPanel: (panelId) => {
    set({ openPanelId: panelId });
  },
  closePanel: (panelId) => {
    set((state) => (state.openPanelId === panelId ? { openPanelId: null } : state));
  },
}));
