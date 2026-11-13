/**
 * How a rival match is won: the method roll at the end of a rival booker's result (AIP5-04).
 *
 * The candidates are the win methods in the catalog (not hidden, in catalog `order`):
 *
 * - a planned title change keeps only methods that change titles, so EVT3 moves the belt;
 * - `forceNoChange` (nobody in the match can hold the title) keeps only methods that can't;
 * - otherwise every method is a candidate, weighted 1 for a title-changing method and
 *   `aip.winner.method.nonTitleWeight` for the rest (count-outs and disqualifications are rare).
 *
 * With MTCH2's finishes in the save, a method is a candidate only when one of the match's allowed
 * win finishes lists it (and, for a planned change, that finish lets titles change), so show night
 * can always find a finish for the booked method and never quietly undoes a planned change.
 *
 * One weighted roll on the caller's stream, only with two or more candidates. Pure apart from the
 * catalog reads. See docs/design/rival-booking.md#how-a-rival-shows-results-are-decided.
 */

import type { ContentKey } from '../../../core/content-key';
import type { RngStream } from '../../../core/rng/registry';
import { rollWeighted } from '../../../core/rng/rolls';
import { startDecision, type Traced } from '../../../core/trace';
import { methodsOf, type MethodDef } from '../../../model/catalogs';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { allowedFinishes } from '../../match/finishes/allowed';
import type { EngineTunables } from '../../tunables';
import { WINNERS_DOC_REF } from './tunables';

/** What the method roll needs to know about the match. */
export interface RivalMethodArgs {
  /** The plan moves a title: only title-changing methods. */
  readonly titleChange: boolean;
  /** Nobody here can hold the title: only methods that can't change titles. */
  readonly forceNoChange: boolean;
  /** The match, for MTCH2's allowed finishes; left out, every catalog method may be used. */
  readonly match?: {
    readonly matchTypeKey: ContentKey;
    readonly sideCount: number;
    readonly stipulationKeys: readonly ContentKey[];
  };
}

export interface RivalMethodDeps {
  readonly tunables: EngineTunables;
  /** The `aip.winners` stream (or the show's own keyed stream). */
  readonly rng: RngStream;
}

export const METHOD_LABEL = 'How the match is won';
export const METHOD_ROLL = 'Method';
export const TITLE_CHANGE_METHODS_RULE = 'A title change needs a method that changes titles';
export const NO_CHANGE_METHODS_RULE = "Nobody here can hold the title: a method that can't move it";
export const ONLY_METHOD_NOTE = 'Only one way to win fits';
export const NO_METHOD_REASON = 'No way of winning fits this match';

/** The methods a win finish allowed in this match lists, or null when the save has no finishes. */
function finishMethods(
  read: GameWorldView,
  args: RivalMethodArgs,
): { any: Set<string>; titleChanging: Set<string> } | null {
  const { catalogs } = read.meta;
  if (args.match === undefined || Object.keys(catalogs.finishes ?? {}).length === 0) {
    return null;
  }
  const any = new Set<string>();
  const titleChanging = new Set<string>();
  for (const finish of allowedFinishes(catalogs, {
    matchTypeKey: args.match.matchTypeKey,
    sideCount: args.match.sideCount,
    stipulationKeys: args.match.stipulationKeys,
  })) {
    if (finish.outcomeKind !== 'win') {
      continue;
    }
    for (const entry of finish.methods) {
      any.add(entry.methodKey);
      if (finish.allowsTitleChange) {
        titleChanging.add(entry.methodKey);
      }
    }
  }
  return { any, titleChanging };
}

/**
 * Picks how a rival match is won, or returns null (with nothing drawn) when no method fits: a
 * content problem the caller logs, planning a no contest instead.
 */
export function pickRivalMethod(
  read: GameWorldView,
  args: RivalMethodArgs,
  deps: RivalMethodDeps,
): Traced<ContentKey> | null {
  const decision = startDecision<ContentKey>(METHOD_LABEL, { docRef: WINNERS_DOC_REF });
  const fromFinishes = finishMethods(read, args);
  let candidates: DeepReadonly<MethodDef>[] = [...methodsOf(read)];
  if (fromFinishes !== null) {
    const allowed = args.titleChange ? fromFinishes.titleChanging : fromFinishes.any;
    candidates = candidates.filter((method) => allowed.has(method.key));
  }
  if (args.titleChange) {
    decision.rule(TITLE_CHANGE_METHODS_RULE, true);
    candidates = candidates.filter((method) => method.changesTitles);
  } else if (args.forceNoChange) {
    decision.rule(NO_CHANGE_METHODS_RULE, true);
    candidates = candidates.filter((method) => !method.changesTitles);
  }
  if (candidates.length === 0) {
    return null;
  }
  const nonTitleWeight =
    args.titleChange || args.forceNoChange
      ? 1
      : decision.tunable(deps.tunables, 'aip.winner.method.nonTitleWeight');
  const weighted = candidates.map((method) => ({
    item: method,
    weight: method.changesTitles ? 1 : nonTitleWeight,
  }));
  for (const entry of weighted) {
    decision.consider(entry.item.key, entry.weight, entry.item.name);
  }
  const live = weighted.filter((entry) => entry.weight > 0);
  const [only] = live;
  if (only === undefined) {
    return null;
  }
  if (live.length === 1) {
    decision.note(ONLY_METHOD_NOTE);
    return decision.choose(only.item.key, only.item.name);
  }
  const roll = rollWeighted(deps.rng, live, METHOD_ROLL, (method) => method.name);
  decision.roll(roll.roll);
  return decision.choose(roll.value.key, roll.value.name);
}
