/**
 * The popularity trace sections seam: other features add lines to the headline popularity Why?
 * without the office system knowing about them (DAY2-02).
 *
 * EVT5-04 is the expected first user ("Recent shows: <show> on <date>, worldwide +0.8"). A section
 * returns plain lines for one promotion on one day; the headline formula records each line as a
 * note after the main line and its context notes, sections in `order` (then id) order. A section
 * that returns no lines adds nothing. Lines are worked out whenever the trace is re-recorded, so a
 * section reads the world as it stands then.
 *
 * Design: docs/design/office.md#trace-sections.
 */

import { RegistryError } from '../../core/errors';
import type { GameDate } from '../../core/date';
import type { PromotionId } from '../../core/ids';
import type { GameWorldView } from '../../model/tables';

/** One registered section. */
export interface PopularityTraceSectionSpec {
  /** Unique, `system.camelName` style, for example `promoPop.recentShows`. */
  readonly id: string;
  /** Position among the sections; lower comes first. */
  readonly order: number;
  /** The section's lines for `promotionId` on `date`; empty for none. */
  readonly lines: (
    read: GameWorldView,
    promotionId: PromotionId,
    date: GameDate,
  ) => readonly string[];
}

const registry = new Map<string, PopularityTraceSectionSpec>();

/**
 * Adds a section to every headline popularity Why? recorded from now on. Returns the function that
 * removes it again (for tests).
 *
 * @throws RegistryError when a section with the same id is already registered.
 */
export function registerPopularityTraceSection(spec: PopularityTraceSectionSpec): () => void {
  if (registry.has(spec.id)) {
    throw new RegistryError(
      `A popularity trace section with id "${spec.id}" is already registered`,
    );
  }
  registry.set(spec.id, spec);
  return () => {
    if (registry.get(spec.id) === spec) {
      registry.delete(spec.id);
    }
  };
}

/** The registered sections in order (then id). */
export function popularityTraceSections(): readonly PopularityTraceSectionSpec[] {
  return [...registry.values()].sort(
    (left, right) =>
      left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}

/** Every registered section's lines for one promotion on one day, in section order. */
export function popularityTraceSectionLines(
  read: GameWorldView,
  promotionId: PromotionId,
  date: GameDate,
): string[] {
  return popularityTraceSections().flatMap((section) => [
    ...section.lines(read, promotionId, date),
  ]);
}
