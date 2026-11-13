import { createExtensionRegistry } from '@/components/extensionRegistry';
import type { ResultsSectionProps } from './resultsSectionRegistry';

/** Whether a line is good news, bad news or neither: it colours the value, never alone. */
export type ShowReportLineTone = 'positive' | 'negative' | 'neutral';

/** One line of the show report's "What changed" panel. */
export interface ShowReportLineContent {
  /** What changed, a word or two: "Fans", "Popularity", "Money". */
  readonly label: string;
  /** The change in plain words: "gained in 9 regions, lost in 2", "4 up, 2 down", "+$12,400". */
  readonly text: string;
  readonly tone?: ShowReportLineTone;
  /**
   * The element id lower on the page the line links to, such as a results section's
   * (`resultsSectionAnchor('evt5.popularity')`) or a segment card's (`segmentCardAnchor(id)`).
   */
  readonly targetId?: string;
}

/**
 * A line another feature adds to the show report's "What changed" panel, such as EVT5's fans by
 * region, MTCH3's popularity counts or ECO's show money.
 */
export interface ShowReportLineDefinition {
  /** Unique, prefixed with the feature: `evt5.fans`. */
  readonly id: string;
  /** Its place in the panel, lowest first; ties go by id. */
  readonly order: number;
  /**
   * The line for this show, or null to leave it out (the feature has nothing to say, or its data
   * is still loading). Called as a React hook, once per page, so it may ask the engine with
   * `useEngineQuery`; name the function `use…` so the hook rules check it.
   */
  readonly line: (props: ResultsSectionProps) => ShowReportLineContent | null;
}

const lines = createExtensionRegistry<ShowReportLineDefinition>('A show report line');

/**
 * Adds a line to the "What changed" panel of every results page, without editing the page.
 * Returns a function that removes it again; throws when the id is taken. A feature that has not
 * registered a line simply has none: there are no placeholders.
 */
export function registerShowReportLine(definition: ShowReportLineDefinition): () => void {
  return lines.register(definition);
}

function inDisplayOrder(
  definitions: readonly ShowReportLineDefinition[],
): readonly ShowReportLineDefinition[] {
  return [...definitions].sort(
    (left, right) =>
      left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}

/** Every registered line in display order. */
export function listShowReportLines(): readonly ShowReportLineDefinition[] {
  return inDisplayOrder(lines.list());
}

/** The registered lines in display order, kept current as features add theirs. */
export function useShowReportLines(): readonly ShowReportLineDefinition[] {
  return inDisplayOrder(lines.useDefinitions());
}

/** The element id of a results section's panel, so a report line can link to it. */
export function resultsSectionAnchor(sectionId: string): string {
  return `results-section-${sectionId.replace(/[^\w-]/gu, '-')}`;
}

/** The element id of a segment's card on the results page. */
export function segmentCardAnchor(segmentId: string): string {
  return `segment-${segmentId}`;
}
