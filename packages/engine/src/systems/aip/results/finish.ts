/**
 * How a rival match ends when the save has MTCH2's finishes (AIP5-06): the finish and its method,
 * planned together with the winner so show night runs the match exactly as the booker meant it.
 *
 * The candidates are the match's allowed finishes (`allowedFinishes`) of the planned outcome kind:
 *
 * - a planned title change keeps only finishes for which `titleCanChange({ finish, method })` is
 *   true for at least one of the finish's methods, and the method is then picked among those
 *   methods only, so MTCH2's title rule can never quietly undo the change;
 * - `forceNoChange` (nobody in the match may take the title) keeps only finishes with at least one
 *   method that cannot change titles, and the method is picked among those;
 * - otherwise every allowed finish of that kind, with all its methods.
 *
 * The finish is MTCH2's `autoFinish` (its weights, heels cheating more) and the method MTCH2's
 * `chooseMethod`, both on the caller's stream: the finish roll first, then the method roll, each
 * only when there is more than one candidate. A draw plans a draw finish and no method.
 *
 * Without finishes in the catalog the caller uses `pickRivalMethod` instead. See
 * docs/design/rival-booking.md#how-a-rival-shows-results-are-decided.
 */

import type { ContentKey } from '../../../core/content-key';
import type { RngStream } from '../../../core/rng/registry';
import type { TraceNode, Traced } from '../../../core/trace';
import type { Alignment } from '../../../model/entities/employment';
import type { GameWorldView } from '../../../model/tables';
import { allowedFinishes, type FinishEntry } from '../../match/finishes/allowed';
import { autoFinish } from '../../match/finishes/autoFinish';
import { chooseMethod } from '../../match/finishes/chooseMethod';
import { titleCanChange } from '../../match/finishes/titleRule';
import type { EngineTunables } from '../../tunables';

/** What the finish pick needs to know about the match and its planned result. */
export interface RivalFinishArgs {
  readonly matchTypeKey: ContentKey;
  readonly sideCount: number;
  readonly stipulationKeys: readonly ContentKey[];
  /** A planned win or a planned draw. */
  readonly outcomeKind: 'win' | 'draw';
  /** The winning side's alignment, for the heel cheating factor; null for a draw. */
  readonly winnerAlignment: Alignment | null;
  /** The plan moves a title: the finish and method must let it change hands. */
  readonly titleChange: boolean;
  /** Nobody here may hold the title: the finish and method must not move it. */
  readonly forceNoChange: boolean;
}

export interface RivalFinishDeps {
  readonly tunables: EngineTunables;
  /** The show's `aip.winners` stream. */
  readonly rng: RngStream;
}

/** The planned finish and method, each with its decision. */
export interface RivalFinish {
  readonly finishKey: ContentKey;
  /** Null for a draw. */
  readonly methodKey: ContentKey | null;
  readonly finish: Traced<ContentKey>;
  readonly method: Traced<ContentKey | null>;
}

export const FINISH_LABEL = 'How the match ends';
export const TITLE_CHANGE_FINISH_RULE = 'A title change needs a finish that lets titles move';
export const NO_CHANGE_FINISH_RULE = "Nobody here can hold the title: a finish that can't move it";

/**
 * The finish decision as a stored rival result keeps it: the options with their weights, the rules
 * and the roll, without each candidate's weight worked out step by step (the weights are the
 * options' scores; MTCH2's Why? on the results page explains them). Rival results are stored for
 * every rival match, so this keeps them small.
 */
export function leanFinishTrace(finish: Traced<ContentKey>): TraceNode {
  const { trace } = finish;
  if (trace.kind !== 'decision') {
    return trace;
  }
  const children = (trace.children ?? []).filter((child) => child.kind !== 'formula');
  // Rest destructuring is the typed way to drop a readonly key.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { children: _all, ...rest } = trace;
  return children.length === 0 ? rest : { ...rest, children };
}

/** True when the save's catalogs hold finishes, so rival results plan one. */
export function hasFinishes(read: GameWorldView): boolean {
  return Object.keys(read.meta.catalogs.finishes ?? {}).length > 0;
}

/** The finish with only the methods the plan allows (none for a draw), or null when none fit. */
function narrowed(
  read: GameWorldView,
  finish: FinishEntry,
  args: RivalFinishArgs,
): FinishEntry | null {
  if (finish.outcomeKind !== args.outcomeKind) {
    return null;
  }
  if (finish.outcomeKind !== 'win') {
    return finish;
  }
  if (!args.titleChange && !args.forceNoChange) {
    return finish.methods.length > 0 ? finish : null;
  }
  const methods = finish.methods.filter((entry) => {
    const method = read.meta.catalogs.methods?.[entry.methodKey];
    const moves = titleCanChange({
      finish: { name: finish.name, allowsTitleChange: finish.allowsTitleChange },
      method:
        method === undefined ? null : { name: method.name, changesTitles: method.changesTitles },
    }).value;
    return args.titleChange ? moves : !moves;
  });
  return methods.length === 0 ? null : { ...finish, methods };
}

/** Method names by key, for `chooseMethod`'s trace. */
function methodNames(read: GameWorldView): Record<string, string> {
  const names: Record<string, string> = {};
  for (const [key, method] of Object.entries(read.meta.catalogs.methods ?? {})) {
    names[key] = method.name;
  }
  return names;
}

/**
 * Plans how a rival match ends, or returns null (with nothing drawn) when no allowed finish fits
 * the plan: a content problem the caller logs, planning a no contest instead.
 */
export function pickRivalFinish(
  read: GameWorldView,
  args: RivalFinishArgs,
  deps: RivalFinishDeps,
): RivalFinish | null {
  const candidates = allowedFinishes(read.meta.catalogs, {
    matchTypeKey: args.matchTypeKey,
    sideCount: args.sideCount,
    stipulationKeys: args.stipulationKeys,
  })
    .map((finish) => narrowed(read, finish, args))
    .filter((finish): finish is FinishEntry => finish !== null);
  if (candidates.length === 0) {
    return null;
  }
  const finish = autoFinish(
    { candidates, winnerAlignment: args.outcomeKind === 'win' ? args.winnerAlignment : null },
    { tunables: deps.tunables, rng: deps.rng },
  );
  const picked = candidates.find((entry) => entry.key === finish.value);
  if (picked === undefined) {
    return null;
  }
  const method = chooseMethod(
    { finish: picked, plannedMethodKey: null, methodNames: methodNames(read) },
    { rng: deps.rng },
  );
  return { finishKey: picked.key, methodKey: method.value, finish, method };
}
