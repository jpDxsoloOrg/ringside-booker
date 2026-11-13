/**
 * Which kind of injury someone picks up, when the caller did not name one.
 *
 * Design: docs/design/health.md#injuries.
 */

import type { ContentKey } from '../../../core/content-key';
import type { RngStream } from '../../../core/rng/registry';
import { rollWeighted } from '../../../core/rng/rolls';
import { startDecision } from '../../../core/trace/decision';
import type { Traced } from '../../../core/trace/types';
import type { InjuryKind } from '../../../model/catalogs';
import { INJURY_DOC_REF } from './injurySeverity';

export interface InjuryKindPickInputs {
  /** The kinds to pick from. Sorted by key here, so the caller's order does not matter. */
  catalog: readonly InjuryKind[];
}

/** The reason when there is nothing to pick from. */
export const NO_INJURY_KINDS = 'No injury kinds in this world';

/**
 * Considers every kind with its catalog `weight` and rolls one, drawing once from `deps.rng`. An
 * empty catalog is a decision with no options that returns null and draws nothing.
 */
export function pickInjuryKind(
  inputs: InjuryKindPickInputs,
  deps: { rng: RngStream },
): Traced<ContentKey | null> {
  const entries = [...inputs.catalog].sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
  if (entries.length === 0) {
    const empty = startDecision<string>('Injury', { docRef: INJURY_DOC_REF }).choose(
      '',
      NO_INJURY_KINDS,
    );
    return { value: null, trace: empty.trace };
  }
  const decision = startDecision<string>('Injury', { docRef: INJURY_DOC_REF });
  for (const kind of entries) {
    decision.consider(kind.key, kind.weight, kind.label);
  }
  const rolled = rollWeighted(
    deps.rng,
    entries.map((kind) => ({ item: kind, weight: kind.weight })),
    'Injury roll',
    (kind) => kind.label,
  );
  const chosen = decision.roll(rolled.roll).choose(rolled.value.key, rolled.value.label);
  return { value: rolled.value.key, trace: chosen.trace };
}
