import type { ReactNode } from 'react';
import type { EventInstanceId, SegmentResultView, ShowResultsView } from '@ringside/engine';
import { createExtensionRegistry } from '@/components/extensionRegistry';

/** What a section of the per-segment report is drawn from. */
export interface SegmentReportSectionProps {
  readonly eventInstanceId: EventInstanceId;
  /** The segment that just ran, with its result and rating (a `shows.results` line). */
  readonly segment: SegmentResultView;
  /** The show's `shows.results` answer, for names and the rest of the card. */
  readonly view: ShowResultsView;
}

/**
 * One section another feature adds to the show night screen's report after each segment
 * (EVT10-02), such as MTCH3's popularity and momentum or MTCH4's physical toll.
 */
export interface SegmentReportSectionDefinition {
  /** Unique, prefixed with the feature: `mtch3.popularity`. */
  readonly id: string;
  /** Heads the section inside the report. */
  readonly label: string;
  /** Its place among the sections, lowest first; ties go by id. */
  readonly order: number;
  /**
   * Draws the section's body for one segment, or returns null to leave it out for that segment
   * (a talking segment has no physical toll). Called during render: return an element, and put
   * any engine query inside that element's component.
   */
  readonly render: (props: SegmentReportSectionProps) => ReactNode;
}

const sections = createExtensionRegistry<SegmentReportSectionDefinition>(
  'A segment report section',
);

/**
 * Adds a section to the report the show night screen shows after each segment, without editing
 * the screen. Returns a function that removes it again; throws when the id is taken.
 */
export function registerSegmentReportSection(
  definition: SegmentReportSectionDefinition,
): () => void {
  return sections.register(definition);
}

/** Lowest `order` first, then by id. */
function inDisplayOrder(
  definitions: readonly SegmentReportSectionDefinition[],
): readonly SegmentReportSectionDefinition[] {
  return [...definitions].sort(
    (left, right) =>
      left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}

/** Every registered section in display order. */
export function listSegmentReportSections(): readonly SegmentReportSectionDefinition[] {
  return inDisplayOrder(sections.list());
}

/** The registered sections in display order, kept current as features add theirs. */
export function useSegmentReportSections(): readonly SegmentReportSectionDefinition[] {
  return inDisplayOrder(sections.useDefinitions());
}
