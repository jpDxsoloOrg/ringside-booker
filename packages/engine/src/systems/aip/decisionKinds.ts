/**
 * The decision-kind registry: every kind of rival decision, with the label the Decision log's
 * filter chip shows for it.
 *
 * `aiDecisions.kind` is an open camelCase key, so a later rival feature adds a kind with one
 * `registerDecisionKind` call in its own module and no save change. `recordDecision` refuses a
 * kind nobody registered, so a typo fails its job instead of writing rows no screen can label.
 * The rival desk registers `rosterReview` here; the others (`push`, `card`, `title`, ...) come
 * with their features. See docs/design/rival-desk.md#decision-log.
 */

import { RegistryError } from '../../core/errors';
import { AI_DECISION_KIND_PATTERN } from '../../model/entities/ai-decision';

/** What a feature writes to add a decision kind. */
export interface DecisionKindSpec {
  /** A short lower camelCase key, such as `rosterReview`. */
  readonly kind: string;
  /** The player's label for the Decision log filter chip, such as "Roster review". */
  readonly chip: string;
  /** The name of an `Icon` from the web app's Lucide set; left out for no icon. */
  readonly icon?: string;
}

/** A registered decision kind. */
export interface DecisionKind {
  readonly kind: string;
  readonly chip: string;
  readonly icon: string | null;
}

const registry = new Map<string, DecisionKind>();

/**
 * Adds a decision kind. Returns a function that removes it again (for tests).
 *
 * @throws RegistryError for a malformed kind, an empty chip label, or a kind already registered.
 */
export function registerDecisionKind(spec: DecisionKindSpec): () => void {
  if (!AI_DECISION_KIND_PATTERN.test(spec.kind) || spec.kind.length > 40) {
    throw new RegistryError(
      `Decision kind "${spec.kind}": a kind is a short lower camelCase key, such as "rosterReview"`,
      { kind: spec.kind },
    );
  }
  if (spec.chip.trim() === '') {
    throw new RegistryError(`Decision kind "${spec.kind}": the chip label is empty`, {
      kind: spec.kind,
    });
  }
  const existing = registry.get(spec.kind);
  if (existing !== undefined) {
    throw new RegistryError(
      `Decision kind "${spec.kind}" ("${spec.chip}") is already registered as "${existing.chip}"`,
      { kind: spec.kind },
    );
  }
  const stored: DecisionKind = Object.freeze({
    kind: spec.kind,
    chip: spec.chip,
    icon: spec.icon ?? null,
  });
  registry.set(spec.kind, stored);
  return () => {
    if (registry.get(spec.kind) === stored) {
      registry.delete(spec.kind);
    }
  };
}

/** Every registered decision kind, sorted by kind. */
export function decisionKinds(): DecisionKind[] {
  return [...registry.values()].sort((left, right) =>
    left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0,
  );
}

/** The registered kind, or null when nobody registered it. */
export function decisionKindOf(kind: string): DecisionKind | null {
  return registry.get(kind) ?? null;
}

/** The weekly roster review's decisions (AIP1-05). */
export const ROSTER_REVIEW_DECISION_KIND = 'rosterReview';

registerDecisionKind({ kind: ROSTER_REVIEW_DECISION_KIND, chip: 'Roster review' });
