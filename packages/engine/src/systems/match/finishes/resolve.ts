/**
 * Resolving a match (MTCH2-03): the one entry point the lab's Simulate and the show night call to
 * turn a booking plan into a complete `MatchResolution`.
 *
 * A plan names the winner (Auto, a side or a Draw), the finish (or Auto) and the method (or none).
 * The steps, in order:
 *
 * 1. The allowed finishes (`allowedFinishes`); a planned finish outside them is `finishNotAllowed`.
 * 2. The outcome kind: the planned finish's, else `draw` for a planned Draw, else `win`. A planned
 *    side with a finish nobody wins, or a Draw with a finish that is not a draw, is
 *    `finishOutcomeMismatch`.
 * 3. In Random winners mode a planned side, Draw, finish or method is refused (`randomWinners`).
 * 4. For a win, the planned side (`unknownSide` when the match has no such side, or nobody competes
 *    on it), else `autoWinner` with `match.autoWinner.randomness` (standard) or
 *    `match.randomWinners.randomness` (Random winners).
 * 5. The finish: the planned one, else `autoFinish` over the allowed finishes of that outcome kind
 *    (and, with a planned method, only those that list it), with the winner's alignment.
 *    `noFinishAvailable` when there are none.
 * 6. The method via `chooseMethod`; a planned method the finish does not list is
 *    `methodNotInFinish`.
 *
 * Plan checks (steps 1–3, the planned side and a planned method) are all made before anything is
 * rolled, and every problem is reported. The function is pure: it reads only its inputs, the
 * catalogs and the tunables, and draws only on the streams `deps.rng` hands it.
 *
 * The trace is one decision, "Match result", whose children are the winner, finish and method
 * decisions, so a single Why? shows the whole reasoning.
 *
 * Design: docs/design/match-finishes.md#resolving-a-match.
 */

import type { Reason } from '../../../core/api/result';
import type { ContentKey } from '../../../core/content-key';
import { InvariantError } from '../../../core/errors';
import type { RngStream } from '../../../core/rng/registry';
import { limitTrace, startDecision, traced, type Traced } from '../../../core/trace';
import { tunableNode } from '../../../core/trace/tunable-node';
import type { Catalogs, FinishOutcomeKind } from '../../../model/catalogs';
import type { MatchOutcome } from '../../../model/entities/segment';
import type { DeepReadonly } from '../../../model/world';
import type { EngineTunables } from '../../tunables';
import { autoWinnerScore } from '../formulas/autoWinnerScore';
import { allowedFinishes, type FinishEntry } from './allowed';
import { autoFinish, winnerAlignmentOf } from './autoFinish';
import { autoWinner, type AutoWinnerMode } from './autoWinner';
import type { AutoWinnerSide } from './autoWinnerInputs';
import { chooseMethod } from './chooseMethod';
import type { MatchResolution } from './resolution';

export const RESOLVING_A_MATCH_DOC_REF = 'match-finishes.md#resolving-a-match';

export const MATCH_RESULT_LABEL = 'Match result';
export const WINNER_DECISION_LABEL = 'Who won';
export const BOOKED_WINNER_REASON = 'Booked winner';
export const BOOKED_FINISH_LABEL = 'Finish';
export const BOOKED_FINISH_REASON = 'Booked finish';
/** The option a no-winner decision records. */
export const NO_WINNER_OPTION = 'none';
export const RANDOM_WINNERS_MESSAGE =
  'Results on your shows are decided on the night (Random winners).';

/** Every reason code `resolveMatchOutcome` can refuse with. */
export const RESOLVE_MATCH_REASON_CODES = [
  'finishNotAllowed',
  'finishOutcomeMismatch',
  'randomWinners',
  'unknownSide',
  'noCompetitors',
  'noFinishAvailable',
  'methodNotInFinish',
] as const;

export type ResolveMatchReasonCode = (typeof RESOLVE_MATCH_REASON_CODES)[number];

/** Who the booker said wins. */
export type PlannedWinner = 'auto' | { readonly side: number } | 'draw';

/** The booking plan for one match. */
export interface MatchPlan {
  readonly winner: PlannedWinner;
  /** The planned finish, or null for Auto. */
  readonly finishKey: ContentKey | null;
  /** The planned method, or null to let the finish decide. */
  readonly methodKey: ContentKey | null;
}

export interface ResolveMatchOutcomeInput {
  readonly matchTypeKey: ContentKey;
  readonly stipulationKeys: readonly ContentKey[];
  /** Every side built, in side order (`autoWinnerInputsOf`). */
  readonly sides: readonly AutoWinnerSide[];
  /** The show's region as the player reads it. */
  readonly regionName: string;
  readonly plan: MatchPlan;
  readonly mode: AutoWinnerMode;
}

/** The streams `resolveMatchOutcome` draws on. */
export type ResolveStreamName = 'match.auto-winner' | 'match.finish';

export interface ResolveMatchOutcomeDeps {
  readonly catalogs: DeepReadonly<Catalogs>;
  readonly tunables: EngineTunables;
  /** The stream for each kind of roll; called only when that roll is needed. */
  readonly rng: (name: ResolveStreamName) => RngStream;
}

export type ResolveMatchOutcomeResult =
  | { readonly ok: true; readonly resolution: Traced<MatchResolution> }
  | { readonly ok: false; readonly reasons: Reason[] };

function reason(code: ResolveMatchReasonCode, message: string, field: string): Reason {
  return { code, message, field };
}

function sideName(side: number): string {
  return `Side ${String(side + 1)}`;
}

/** The kind of outcome the plan asks for, before anything is rolled. */
function outcomeKindOf(plan: MatchPlan, plannedFinish: FinishEntry | undefined): FinishOutcomeKind {
  if (plannedFinish !== undefined) {
    return plannedFinish.outcomeKind;
  }
  return plan.winner === 'draw' ? 'draw' : 'win';
}

interface CheckedPlan {
  readonly allowed: readonly FinishEntry[];
  readonly plannedFinish: FinishEntry | undefined;
  readonly outcomeKind: FinishOutcomeKind;
  readonly reasons: Reason[];
}

function finishName(catalogs: DeepReadonly<Catalogs>, key: ContentKey): string {
  return catalogs.finishes?.[key]?.name ?? key;
}

function methodName(catalogs: DeepReadonly<Catalogs>, key: ContentKey): string {
  return catalogs.methods?.[key]?.name ?? key;
}

/** Steps 1–3 and the planned side and method: every problem with the plan itself. */
function checkPlan(input: ResolveMatchOutcomeInput, catalogs: DeepReadonly<Catalogs>): CheckedPlan {
  const { plan } = input;
  const reasons: Reason[] = [];
  const allowed = allowedFinishes(catalogs, {
    matchTypeKey: input.matchTypeKey,
    sideCount: input.sides.length,
    stipulationKeys: input.stipulationKeys,
  });

  // (1) The planned finish must be one this match may end with.
  let plannedFinish: FinishEntry | undefined;
  if (plan.finishKey !== null) {
    plannedFinish = allowed.find((entry) => entry.key === plan.finishKey);
    if (plannedFinish === undefined) {
      reasons.push(
        reason(
          'finishNotAllowed',
          `${finishName(catalogs, plan.finishKey)} isn't a finish this match can end with.`,
          'plan.finishKey',
        ),
      );
    }
  }

  // (2) The finish must suit the planned winner.
  const outcomeKind = outcomeKindOf(plan, plannedFinish);
  if (plannedFinish !== undefined) {
    if (typeof plan.winner === 'object' && plannedFinish.outcomeKind !== 'win') {
      reasons.push(
        reason(
          'finishOutcomeMismatch',
          `Nobody wins with a ${plannedFinish.name} finish, so ${sideName(plan.winner.side)} can't win with it.`,
          'plan.finishKey',
        ),
      );
    }
    if (plan.winner === 'draw' && plannedFinish.outcomeKind !== 'draw') {
      reasons.push(
        reason(
          'finishOutcomeMismatch',
          `A draw needs a draw finish; ${plannedFinish.name} isn't one.`,
          'plan.finishKey',
        ),
      );
    }
  }

  // (3) Random winners: nothing about the result may be planned.
  if (
    input.mode === 'randomWinners' &&
    (plan.winner !== 'auto' || plan.finishKey !== null || plan.methodKey !== null)
  ) {
    reasons.push(reason('randomWinners', RANDOM_WINNERS_MESSAGE, 'plan'));
  }

  // The planned side must be in the match, with somebody competing on it.
  if (typeof plan.winner === 'object') {
    const plannedSide = plan.winner.side;
    const side = input.sides.find((entry) => entry.side === plannedSide);
    if (side === undefined) {
      reasons.push(
        reason('unknownSide', `${sideName(plannedSide)} isn't in this match.`, 'plan.winner'),
      );
    } else if (side.competitors.length === 0) {
      reasons.push(
        reason(
          'unknownSide',
          `Nobody competes for ${side.sideLabel}, so it can't win.`,
          'plan.winner',
        ),
      );
    }
  }

  // A planned method must be one the finish (or, for an Auto finish, some candidate) lists.
  if (plan.methodKey !== null) {
    const methodKey = plan.methodKey;
    const name = methodName(catalogs, methodKey);
    if (plannedFinish !== undefined) {
      if (!plannedFinish.methods.some((method) => method.methodKey === methodKey)) {
        reasons.push(
          reason(
            'methodNotInFinish',
            `A ${plannedFinish.name} finish can't end by ${name}.`,
            'plan.methodKey',
          ),
        );
      }
    } else if (plan.finishKey === null) {
      const anyFinish = allowed.some(
        (entry) =>
          entry.outcomeKind === outcomeKind &&
          entry.methods.some((method) => method.methodKey === methodKey),
      );
      if (!anyFinish) {
        reasons.push(
          reason(
            'methodNotInFinish',
            outcomeKind === 'win'
              ? `No finish this match can end with ends by ${name}.`
              : `Nobody wins a draw, so there is no method such as ${name}.`,
            'plan.methodKey',
          ),
        );
      }
    }
  }

  return { allowed, plannedFinish, outcomeKind, reasons };
}

function noWinnerTrace(because: string): Traced<string> {
  return startDecision<string>(WINNER_DECISION_LABEL, { docRef: RESOLVING_A_MATCH_DOC_REF })
    .note(because)
    .choose(NO_WINNER_OPTION, because);
}

/** Step 4 for a win: the winning side and its trace, or a refusal. */
function decideWinner(
  input: ResolveMatchOutcomeInput,
  deps: ResolveMatchOutcomeDeps,
): { side: AutoWinnerSide; trace: Traced<unknown> } | Reason {
  const { plan } = input;
  if (typeof plan.winner === 'object') {
    const plannedSide = plan.winner.side;
    const side = input.sides.find((entry) => entry.side === plannedSide);
    if (side === undefined) {
      return reason('unknownSide', `${sideName(plannedSide)} isn't in this match.`, 'plan.winner');
    }
    const trace = startDecision<string>(WINNER_DECISION_LABEL, {
      docRef: RESOLVING_A_MATCH_DOC_REF,
    }).choose(side.sideLabel, BOOKED_WINNER_REASON);
    return { side, trace };
  }
  const contenders = input.sides.filter((side) => side.competitors.length > 0);
  if (contenders.length === 0) {
    return reason(
      'noCompetitors',
      'Nobody in this match is competing, so nobody can win.',
      'sides',
    );
  }
  const randomnessKey =
    input.mode === 'randomWinners'
      ? 'match.randomWinners.randomness'
      : 'match.autoWinner.randomness';
  const randomness = traced(
    deps.tunables.get(randomnessKey),
    tunableNode(deps.tunables, randomnessKey, 'Unpredictability'),
  );
  const winner = autoWinner(
    {
      sides: contenders.map((side) => ({
        side: side.side,
        label: side.sideLabel,
        score: autoWinnerScore(
          {
            sideLabel: side.sideLabel,
            regionName: input.regionName,
            competitors: side.competitors,
          },
          { tunables: deps.tunables },
        ),
        lowestPersonId: side.competitors
          .map((competitor) => competitor.personId)
          .reduce((lowest, id) => (id < lowest ? id : lowest)),
      })),
      randomness,
      mode: input.mode,
    },
    { rng: deps.rng('match.auto-winner') },
  );
  const side = contenders.find((entry) => entry.side === winner.value);
  if (side === undefined) {
    throw new InvariantError('autoWinner picked a side it was not given', { side: winner.value });
  }
  return { side, trace: winner };
}

function outcomeLabel(outcome: MatchOutcome, winner: AutoWinnerSide | null): string {
  if (outcome.kind === 'win') {
    return `${winner?.sideLabel ?? sideName(outcome.winningSide)} wins`;
  }
  return outcome.kind === 'draw' ? 'Draw' : 'No contest';
}

/**
 * Turns a plan into a complete outcome, finish and method, with one trace; or refuses an
 * inconsistent plan with player-readable reasons.
 */
export function resolveMatchOutcome(
  input: ResolveMatchOutcomeInput,
  deps: ResolveMatchOutcomeDeps,
): ResolveMatchOutcomeResult {
  const { catalogs } = deps;
  const { plan } = input;
  const checked = checkPlan(input, catalogs);
  if (checked.reasons.length > 0) {
    return { ok: false, reasons: checked.reasons };
  }
  const { allowed, plannedFinish, outcomeKind } = checked;

  // (4) Who won.
  let winner: AutoWinnerSide | null = null;
  let winnerTrace: Traced<unknown>;
  if (outcomeKind === 'win') {
    const decided = decideWinner(input, deps);
    if ('code' in decided) {
      return { ok: false, reasons: [decided] };
    }
    winner = decided.side;
    winnerTrace = decided.trace;
  } else {
    winnerTrace = noWinnerTrace(
      outcomeKind === 'draw' ? 'A draw: nobody wins' : 'No contest: nobody wins',
    );
  }

  // (5) The finish.
  let finish: FinishEntry;
  let finishTrace: Traced<unknown>;
  if (plannedFinish === undefined) {
    const candidates = allowed.filter(
      (entry) =>
        entry.outcomeKind === outcomeKind &&
        (plan.methodKey === null ||
          entry.methods.some((method) => method.methodKey === plan.methodKey)),
    );
    if (candidates.length === 0) {
      return {
        ok: false,
        reasons: [
          reason(
            'noFinishAvailable',
            outcomeKind === 'draw'
              ? "This match can't end in a draw: it has no draw finish."
              : 'No finish this match can end with fits the plan.',
            'plan.finishKey',
          ),
        ],
      };
    }
    const picked = autoFinish(
      {
        candidates,
        winnerAlignment:
          winner === null
            ? null
            : winnerAlignmentOf(winner.competitors.map((competitor) => competitor.alignment)),
      },
      { tunables: deps.tunables, rng: deps.rng('match.finish') },
    );
    const pickedFinish = candidates.find((entry) => entry.key === picked.value);
    if (pickedFinish === undefined) {
      throw new InvariantError('autoFinish picked a finish it was not given', {
        finishKey: picked.value,
      });
    }
    finish = pickedFinish;
    finishTrace = picked;
  } else {
    finish = plannedFinish;
    finishTrace = startDecision<string>(BOOKED_FINISH_LABEL, {
      docRef: RESOLVING_A_MATCH_DOC_REF,
    }).choose(
      plannedFinish.name.length > 0 ? plannedFinish.name : plannedFinish.key,
      BOOKED_FINISH_REASON,
    );
  }

  // (6) The method. The plan checks above make sure a planned method is one the finish lists.
  const methodNames: Record<string, string> = {};
  for (const method of Object.values(catalogs.methods ?? {})) {
    methodNames[method.key] = method.name;
  }
  const method = chooseMethod(
    { finish, plannedMethodKey: plan.methodKey, methodNames },
    { rng: deps.rng('match.finish') },
  );

  let outcome: MatchOutcome;
  if (outcomeKind === 'win') {
    if (winner === null || method.value === null) {
      return {
        ok: false,
        reasons: [
          reason(
            'noFinishAvailable',
            `A ${finish.name} finish has no way to end the match.`,
            'plan.finishKey',
          ),
        ],
      };
    }
    outcome = { kind: 'win', winningSide: winner.side, methodKey: method.value };
  } else {
    outcome = { kind: outcomeKind };
  }

  const resolution: MatchResolution = {
    outcome,
    finishKey: finish.key,
    methodKey: method.value,
  };
  const label = outcomeLabel(outcome, winner);
  // A finish named after its only method (Disqualification, Count-out) is said once.
  const methodLabel = method.value === null ? null : methodName(catalogs, method.value);
  const because =
    methodLabel === null || methodLabel === finish.name
      ? finish.name
      : `${finish.name}, ${methodLabel}`;
  const trace = limitTrace({
    kind: 'decision',
    label: MATCH_RESULT_LABEL,
    value: label,
    chosen: label,
    reason: because,
    considered: [],
    docRef: RESOLVING_A_MATCH_DOC_REF,
    children: [winnerTrace.trace, finishTrace.trace, method.trace],
  });
  return { ok: true, resolution: { value: resolution, trace } };
}
