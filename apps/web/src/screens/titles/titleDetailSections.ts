import type { ReactNode } from 'react';
import type { TitleDetail, TitleId } from '@ringside/engine';
import { createExtensionRegistry, sortedByOrder } from '@/components/extensionRegistry';

/** What a title page section is drawn from. */
export interface TitleDetailSectionContext {
  readonly titleId: TitleId;
  /** The engine's `titles.detail` answer. */
  readonly detail: TitleDetail;
}

/** Which column of the title page a section sits in. */
export type TitleDetailSectionColumn = 'main' | 'side';

/**
 * One section another feature adds to every title page (CRTV2's prestige history and #1
 * contender), without editing the page. `main` sections come after the lineage, `side` ones under
 * the records.
 */
export interface TitleDetailSection {
  /** Unique across every registered section. */
  readonly id: string;
  /** Its place in its column, lowest first; ties keep registration order. */
  readonly order: number;
  readonly column: TitleDetailSectionColumn;
  /** Draws the section, usually a `Panel` with an `h2`. */
  readonly render: (context: TitleDetailSectionContext) => ReactNode;
  /** Return false to leave the section out for this title (a retired one, say). */
  readonly visible?: (detail: TitleDetail) => boolean;
}

const registry = createExtensionRegistry<TitleDetailSection>('A title page section');

/**
 * Adds a section to every title page. Returns a function that removes it again. Throws when the id
 * is already taken.
 */
export function registerTitleDetailSection(section: TitleDetailSection): () => void {
  return registry.register(section);
}

/** Every registered section, lowest `order` first. */
export function titleDetailSections(): readonly TitleDetailSection[] {
  return sortedByOrder(registry.list());
}

/** The registered sections, kept current as features add and remove theirs. Unsorted. */
export const useTitleDetailSections = registry.useDefinitions;

/** The sections to draw in one column for one title: ordered, hidden ones left out. */
export function visibleTitleDetailSections(
  sections: readonly TitleDetailSection[],
  column: TitleDetailSectionColumn,
  detail: TitleDetail,
): readonly TitleDetailSection[] {
  return sortedByOrder(sections).filter(
    (section) => section.column === column && (section.visible?.(detail) ?? true),
  );
}
