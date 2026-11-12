import type { ReactNode } from 'react';
import type { EventInstanceId, ShowResultsView } from '@ringside/engine';
import { createExtensionRegistry } from '@/components/extensionRegistry';

/** What a results section is drawn from. */
export interface ResultsSectionProps {
  readonly eventInstanceId: EventInstanceId;
  /** The page's `shows.results` answer. */
  readonly view: ShowResultsView;
}

/**
 * One section another feature adds under a show's segments, such as MTCH3's "Popularity &
 * momentum", EVT4's card flow or ECO's show money.
 */
export interface ResultsSectionDefinition {
  /** Unique, prefixed with the feature: `mtch3.popularity`. */
  readonly id: string;
  /** Heads the section's panel. */
  readonly label: string;
  /** Its place among the sections, lowest first; ties go by id. */
  readonly order: number;
  /** Draws the section's body, or returns null to leave the whole section out for this show. */
  readonly render: (props: ResultsSectionProps) => ReactNode;
}

const sections = createExtensionRegistry<ResultsSectionDefinition>('A results section');

/**
 * Adds a section under the segments of every results page, without editing the page. Returns a
 * function that removes it again; throws when the id is taken. Sections appear once the reveal
 * has finished.
 */
export function registerResultsSection(definition: ResultsSectionDefinition): () => void {
  return sections.register(definition);
}

/** Lowest `order` first, then by id. */
function inDisplayOrder(
  definitions: readonly ResultsSectionDefinition[],
): readonly ResultsSectionDefinition[] {
  return [...definitions].sort(
    (left, right) =>
      left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}

/** Every registered section in display order. */
export function listResultsSections(): readonly ResultsSectionDefinition[] {
  return inDisplayOrder(sections.list());
}

/** The registered sections in display order, kept current as features add theirs. */
export function useResultsSections(): readonly ResultsSectionDefinition[] {
  return inDisplayOrder(sections.useDefinitions());
}
