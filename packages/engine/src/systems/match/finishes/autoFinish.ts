/**
 * The finish decided on the night (MTCH2-02): when the booker left a match's finish open, one is
 * picked by a seeded weighted roll among the finishes the match may use.
 *
 * Each candidate weighs its catalog `autoWeight`; a cheating finish weighs
 * `match.autoFinish.heelCheatingFactor` times as much when the winning side is mostly heels.
 * Candidates that weigh 0 are listed ("Never picked automatically") but never rolled. The caller
 * passes the allowed finishes (`allowedFinishes`) already narrowed to the outcome kind it wants,
 * so the pick never lands on a finish the match type disallows.
 *
 * The trace's options are the finishes' names ("Clean finish"), so the Why? reads as words; the
 * returned value is the finish's content key.
 *
 * Design: docs/design/match-finishes.md#finish-on-the-night.
 */

import type { ContentKey } from '../../../core/content-key';
import { InvalidArgumentError } from '../../../core/errors';
import { rollWeighted } from '../../../core/rng/rolls';
import type { RngStream } from '../../../core/rng/registry';
import { startCalc, startDecision, type Traced } from '../../../core/trace';
import type { Alignment } from '../../../model/entities/employment';
import type { EngineTunables } from '../../tunables';
import type { FinishEntry } from './allowed';

export const FINISH_ON_THE_NIGHT_DOC_REF = 'match-finishes.md#finish-on-the-night';

export const AUTO_FINISH_LABEL = 'Finish decided on the night';
export const AUTO_FINISH_RULE = 'Only finishes this match type allows';
export const NEVER_PICKED_REASON = 'Never picked automatically';
export const ONLY_FINISH_NOTE = 'Only finish available';
export const PICKED_BY_ROLL_REASON = 'Picked by weighted roll';
export const ALL_WEIGHTS_ZERO_FINISH_NOTE =
  'Every finish weighs 0 here, so the first one in catalog order is used';

/** What `autoFinish` needs to know about each candidate. */
export type AutoFinishCandidate = Pick<FinishEntry, 'key' | 'name' | 'category' | 'autoWeight'>;

export interface AutoFinishInputs {
  /** The finishes allowed for this match and outcome kind, in catalog order. At least one. */
  readonly candidates: readonly AutoFinishCandidate[];
  /** The winning side's alignment (`winnerAlignmentOf`); null when nobody on it is employed. */
  readonly winnerAlignment: Alignment | null;
}

export interface AutoFinishDeps {
  readonly tunables: EngineTunables;
  readonly rng: RngStream;
}

/**
 * The winning side's alignment: the one most of its members have. A tie between alignments gives
 * `tweener`; null entries (people not employed by the promotion) do not count, and a side with
 * nobody counted gives null.
 */
export function winnerAlignmentOf(alignments: readonly (Alignment | null)[]): Alignment | null {
  const counts = new Map<Alignment, number>();
  for (const alignment of alignments) {
    if (alignment !== null) {
      counts.set(alignment, (counts.get(alignment) ?? 0) + 1);
    }
  }
  let best: Alignment | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [alignment, count] of counts) {
    if (count > bestCount) {
      best = alignment;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  if (best === null) {
    return null;
  }
  return tied ? 'tweener' : best;
}

function candidateWeight(
  candidate: AutoFinishCandidate,
  winnerAlignment: Alignment | null,
  tunables: EngineTunables,
): Traced<number> {
  const calc = startCalc(`${candidate.name} weight`, candidate.autoWeight, {
    startLabel: 'Automatic weight',
    docRef: FINISH_ON_THE_NIGHT_DOC_REF,
  });
  if (candidate.category === 'cheating') {
    const heelWinner = winnerAlignment === 'heel';
    calc.branch('The winner is a heel', heelWinner);
    if (heelWinner) {
      calc.multiply(
        'Heels cheat more',
        calc.tunable(tunables, 'match.autoFinish.heelCheatingFactor', 'Heel cheating factor'),
      );
    }
  }
  return calc.done();
}

/**
 * Picks the finish a match ends with. One candidate is used without a roll; otherwise one weighted
 * roll on `deps.rng` over the candidates that weigh more than 0.
 *
 * @throws InvalidArgumentError when there are no candidates.
 */
export function autoFinish(inputs: AutoFinishInputs, deps: AutoFinishDeps): Traced<ContentKey> {
  const [first] = inputs.candidates;
  if (first === undefined) {
    throw new InvalidArgumentError(
      'autoFinish',
      'candidates',
      inputs.candidates.length,
      'at least one finish',
    );
  }
  const labels = optionLabels(inputs.candidates);
  const labelOf = (key: ContentKey): string => labels.get(key) ?? key;
  const decision = startDecision<string>(AUTO_FINISH_LABEL, {
    docRef: FINISH_ON_THE_NIGHT_DOC_REF,
  }).rule(AUTO_FINISH_RULE, true);
  if (inputs.candidates.length === 1) {
    const only = decision.note(ONLY_FINISH_NOTE).choose(labelOf(first.key), ONLY_FINISH_NOTE);
    return { value: first.key, trace: only.trace };
  }
  const entries: { item: ContentKey; weight: number }[] = [];
  for (const candidate of inputs.candidates) {
    const weight = candidateWeight(candidate, inputs.winnerAlignment, deps.tunables);
    if (weight.value > 0) {
      decision.consider(labelOf(candidate.key), weight);
      entries.push({ item: candidate.key, weight: weight.value });
    } else {
      decision.consider(labelOf(candidate.key), weight, NEVER_PICKED_REASON);
    }
  }
  if (entries.length === 0) {
    const fallback = decision
      .note(ALL_WEIGHTS_ZERO_FINISH_NOTE)
      .choose(labelOf(first.key), ALL_WEIGHTS_ZERO_FINISH_NOTE);
    return { value: first.key, trace: fallback.trace };
  }
  const picked = rollWeighted(deps.rng, entries, 'Finish', labelOf);
  const chosen = decision.roll(picked.roll).choose(labelOf(picked.value), PICKED_BY_ROLL_REASON);
  return { value: picked.value, trace: chosen.trace };
}

/**
 * The option text each candidate shows in the trace: its name, or "name (key)" when two candidates
 * share a name, so every option stays distinct (the key alone when a candidate has no name).
 */
function optionLabels(candidates: readonly AutoFinishCandidate[]): Map<ContentKey, string> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.name, (counts.get(candidate.name) ?? 0) + 1);
  }
  const labels = new Map<ContentKey, string>();
  for (const candidate of candidates) {
    if (candidate.name.length === 0) {
      labels.set(candidate.key, candidate.key);
    } else {
      const shared = (counts.get(candidate.name) ?? 0) > 1;
      labels.set(candidate.key, shared ? `${candidate.name} (${candidate.key})` : candidate.name);
    }
  }
  return labels;
}
