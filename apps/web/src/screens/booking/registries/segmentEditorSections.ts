import type { ReactNode } from 'react';
import type { BookingShowView, BookingSlotView, SegmentDraft } from '@ringside/engine';
import { createExtensionRegistry, sortedByOrder } from '@/components/extensionRegistry';
import type { SegmentDraftPatch } from '../editor/useSegmentDraft';

export type { SegmentDraftPatch } from '../editor/useSegmentDraft';

/** Which segments a section is drawn for. */
export type SegmentEditorSectionAppliesTo = 'match' | 'angle' | 'both';

/** What a registered section is drawn from. */
export interface SegmentEditorSectionContext {
  /** The draft as the booker has it now, not yet saved. */
  readonly draft: SegmentDraft;
  /**
   * Changes this section's part of the draft. Nothing is written until the booker saves the
   * sheet: sections never call commands themselves.
   */
  readonly patch: (partial: SegmentDraftPatch) => void;
  readonly show: BookingShowView;
  /** The slot being filled or edited. */
  readonly slot: BookingSlotView;
  /** True while the sheet is saving, or when the card can no longer change. */
  readonly disabled: boolean;
}

/** One part another feature adds to the segment editor: finish, beats, stipulations, crew. */
export interface SegmentEditorSectionDefinition {
  /** Unique, prefixed with the feature: `match.finish`. */
  readonly id: string;
  /** Its place after the built-in fields, lowest first; ties go by id. */
  readonly order: number;
  readonly appliesTo: SegmentEditorSectionAppliesTo;
  /** Heads the section and names it as a group. */
  readonly title: string;
  /** Draws the section, or returns null to leave it out for this draft. */
  readonly render: (context: SegmentEditorSectionContext) => ReactNode;
}

const sections = createExtensionRegistry<SegmentEditorSectionDefinition>(
  'A segment editor section',
);

/**
 * Adds a section to the segment editor without editing it. It is drawn after the Result field,
 * edits the same draft through `patch`, and is saved with the segment. Returns a function that
 * removes it again; throws when the id is taken. Register from a file imported by
 * `../sections/index.ts`.
 */
export function registerSegmentEditorSection(
  definition: SegmentEditorSectionDefinition,
): () => void {
  return sections.register(definition);
}

/** Every registered section, in registration order. */
export function registeredSegmentEditorSections(): readonly SegmentEditorSectionDefinition[] {
  return sections.list();
}

/** The sections for a kind of segment, lowest `order` first, then by id. */
export function sectionsFor(
  definitions: readonly SegmentEditorSectionDefinition[],
  kind: 'match' | 'angle',
): readonly SegmentEditorSectionDefinition[] {
  const byId = [...definitions].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  return sortedByOrder(
    byId.filter((section) => section.appliesTo === 'both' || section.appliesTo === kind),
  );
}

/** The registered sections for a kind of segment, kept current as features add theirs. */
export function useSegmentEditorSections(
  kind: 'match' | 'angle',
): readonly SegmentEditorSectionDefinition[] {
  return sectionsFor(sections.useDefinitions(), kind);
}
