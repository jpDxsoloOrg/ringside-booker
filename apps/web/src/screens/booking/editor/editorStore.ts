/**
 * The seam between the booking card and the segment editor (EVT2-06).
 *
 * The card's add and edit actions only call `openNew` / `openExisting` here; they never import the
 * editor. The booking screen draws `SegmentEditorSheet` (`./SegmentEditorSheet.tsx`) from this
 * store with the card it has loaded, so the editor gets the slot or segment from `request` and
 * everything else (the card, its title options, each segment's `draft`) from its props.
 */
import { create } from 'zustand';
import type { EventInstanceId, SegmentId } from '@ringside/engine';

/** What a new segment starts as: a match, or a talking segment (an angle). */
export type SegmentEditorKind = 'match' | 'angle';

/** Add a segment to an open slot. `slot` is stored (0-based) within its section. */
export interface NewSegmentRequest {
  readonly mode: 'new';
  readonly eventInstanceId: EventInstanceId;
  readonly preShow: boolean;
  readonly slot: number;
  readonly kind: SegmentEditorKind;
}

/** Change a segment already on the card. */
export interface ExistingSegmentRequest {
  readonly mode: 'existing';
  readonly segmentId: SegmentId;
}

export type SegmentEditorRequest = NewSegmentRequest | ExistingSegmentRequest;

export interface SegmentEditorState {
  /** What the editor is open on, or null while it is closed. */
  readonly request: SegmentEditorRequest | null;
  readonly openNew: (target: Omit<NewSegmentRequest, 'mode'>) => void;
  readonly openExisting: (segmentId: SegmentId) => void;
  readonly close: () => void;
}

export const useSegmentEditor = create<SegmentEditorState>()((set) => ({
  request: null,
  openNew: (target) => {
    set({ request: { mode: 'new', ...target } });
  },
  openExisting: (segmentId) => {
    set({ request: { mode: 'existing', segmentId } });
  },
  close: () => {
    set({ request: null });
  },
}));
