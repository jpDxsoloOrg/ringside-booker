/**
 * MTCH2 on show night (EVT3-07): the match outcome resolver the shows phase calls for every match,
 * registered at module load through show night's `registerMatchOutcomeResolver` seam.
 *
 * It adapts `resolveMatchOutcome` to a stored segment:
 *
 * - The plan is the segment's `outcome` (a planned side with its method, a Draw, or nothing) plus
 *   its `match.finishKey`. A match with no plan gets an automatic winner and finish, so an
 *   unplanned match (a rival card, or a Random winners game) has a winner instead of a no contest.
 * - A match booked as Auto or Random (`match.resultPlan`, MTCH2-08) has no planned outcome: Auto
 *   is the auto-winner (`winner: 'auto'`, standard mode), Random is a coin flip (`coinFlip` mode),
 *   each with the booked finish when there is one. Neither ever gives a draw.
 * - The mode is `randomWinners` when `randomWinnersActive` is true for the show's promotion and
 *   brand. A result booked anyway in Random winners mode is set aside and decided on the night,
 *   with a note in the trace: show night cannot refuse a card it is running.
 * - A planned no contest without a finish keeps the no contest and picks one of the no-contest
 *   finishes the match allows (`autoFinish`), since `resolveMatchOutcome` plans only wins and draws.
 * - A plan `resolveMatchOutcome` refuses (a finish the match no longer allows, say) is tried again
 *   with only the winner booked, then falls back to the booked result as `plannedOrNoContest` reads
 *   it; each step adds a note with the reasons.
 * - `titleCanChange` comes from MTCH2's title rule (the method **and** the finish allow it), which
 *   EVT3-04's title decision prefers over the method flag.
 *
 * It draws only on the world's `match.auto-winner` and `match.finish` streams.
 *
 * Design: docs/design/match-finishes.md#integration and show-night.md#match-outcome-resolver.
 */

import type { Reason } from '../../../core/api/result';
import type { ContentKey } from '../../../core/content-key';
import { limitTrace, startDecision, type TraceNode, type Traced } from '../../../core/trace';
import type { Catalogs } from '../../../model/catalogs';
import type { MatchOutcome } from '../../../model/entities/segment';
import type { DeepReadonly } from '../../../model/world';
import {
  plannedOrNoContest,
  registerMatchOutcomeResolver,
  type MatchOutcomeDeps,
  type MatchOutcomeInput,
  type MatchOutcomeResolution,
  type MatchOutcomeResolver,
} from '../../shows/registries';
import { allowedFinishes } from './allowed';
import { autoFinish } from './autoFinish';
import type { AutoWinnerMode } from './autoWinner';
import { autoWinnerInputsOf, type AutoWinnerSide } from './autoWinnerInputs';
import { randomWinnersActive } from './randomWinners';
import {
  MATCH_RESULT_LABEL,
  NO_WINNER_OPTION,
  RESOLVING_A_MATCH_DOC_REF,
  WINNER_DECISION_LABEL,
  resolveMatchOutcome,
  type MatchPlan,
  type ResolveMatchOutcomeInput,
} from './resolve';
import { titleCanChange } from './titleRule';

export const MATCH_OUTCOME_RESOLVER_ID = 'match.resolveOutcome';

export const RANDOM_WINNERS_SET_ASIDE_NOTE =
  'Random winners: the booked result was set aside and decided on the night';
export const BOOKED_NO_CONTEST_REASON = 'Booked no contest';

/** The note when the booked finish or method could not be used, with the refusals' reasons. */
export function planSetAsideNote(reasons: readonly Reason[]): string {
  const because = reasons.map((entry) => entry.message).join(' ');
  return `The booked finish couldn't be used, so only the winner was kept. ${because}`;
}

/** The note when nothing about the booked plan could be resolved. */
export function bookedResultFallbackNote(reasons: readonly Reason[]): string {
  const because = reasons.map((entry) => entry.message).join(' ');
  return `The result was kept as booked, without a finish. ${because}`;
}

function note(label: string): TraceNode {
  return { kind: 'note', label, value: null };
}

/** The trace with notes placed before the decision's own children. */
function withNotes(trace: TraceNode, notes: readonly string[]): TraceNode {
  if (notes.length === 0 || trace.kind !== 'decision') {
    return trace;
  }
  return limitTrace({ ...trace, children: [...notes.map(note), ...(trace.children ?? [])] });
}

/** The booker's plan as `resolveMatchOutcome` reads it. A planned no contest is handled apart. */
function matchPlanOf(plan: MatchOutcome | null, plannedFinishKey: ContentKey | null): MatchPlan {
  if (plan === null || plan.kind === 'noContest') {
    return { winner: 'auto', finishKey: plannedFinishKey, methodKey: null };
  }
  if (plan.kind === 'draw') {
    return { winner: 'draw', finishKey: plannedFinishKey, methodKey: null };
  }
  return {
    winner: { side: plan.winningSide },
    finishKey: plannedFinishKey,
    methodKey: plan.methodKey,
  };
}

const AUTO_PLAN: MatchPlan = { winner: 'auto', finishKey: null, methodKey: null };

/** The title rule for a resolved finish and method. */
function titleRuleOf(
  catalogs: DeepReadonly<Catalogs>,
  finishKey: ContentKey,
  methodKey: ContentKey | null,
): Traced<boolean> | null {
  const finish = catalogs.finishes?.[finishKey];
  if (finish === undefined) {
    return null;
  }
  const method = methodKey === null ? undefined : catalogs.methods?.[methodKey];
  return titleCanChange({
    finish: { name: finish.name, allowsTitleChange: finish.allowsTitleChange },
    method:
      method === undefined ? null : { name: method.name, changesTitles: method.changesTitles },
  });
}

/** A booked no contest with no finish: keep it, and pick the finish among the allowed ones. */
function bookedNoContest(
  base: Omit<ResolveMatchOutcomeInput, 'plan' | 'mode'>,
  input: MatchOutcomeInput,
  deps: MatchOutcomeDeps,
): MatchOutcomeResolution {
  const { catalogs } = deps.read.meta;
  const candidates = allowedFinishes(catalogs, {
    matchTypeKey: base.matchTypeKey,
    sideCount: base.sides.length,
    stipulationKeys: base.stipulationKeys,
  }).filter((entry) => entry.outcomeKind === 'noContest');
  if (candidates.length === 0) {
    return plannedOrNoContest.resolve(input, deps);
  }
  const picked = autoFinish(
    { candidates, winnerAlignment: null },
    { tunables: deps.tunables, rng: deps.rng('match.finish') },
  );
  const finish = candidates.find((entry) => entry.key === picked.value);
  const finishName = finish?.name ?? picked.value;
  const winner = startDecision<string>(WINNER_DECISION_LABEL, {
    docRef: RESOLVING_A_MATCH_DOC_REF,
  }).choose(NO_WINNER_OPTION, BOOKED_NO_CONTEST_REASON);
  return {
    outcome: { kind: 'noContest' },
    finishKey: picked.value,
    methodKey: null,
    titleCanChange: titleRuleOf(catalogs, picked.value, null),
    trace: limitTrace({
      kind: 'decision',
      label: MATCH_RESULT_LABEL,
      value: 'No contest',
      chosen: 'No contest',
      reason: finishName,
      considered: [],
      docRef: RESOLVING_A_MATCH_DOC_REF,
      children: [winner.trace, picked.trace],
    }),
  };
}

interface Attempt {
  readonly plan: MatchPlan;
  readonly notes: readonly string[];
}

/** Every side with a competitor, as the auto-winner reads it. */
function sidesOf(input: MatchOutcomeInput, deps: MatchOutcomeDeps): AutoWinnerSide[] {
  return autoWinnerInputsOf(deps.read, {
    promotionId: input.promotionId,
    regionId: input.regionId,
    sides: input.sides.map((side) => ({ side: side.side, personIds: side.personIds })),
  });
}

/** Decides how a match on show night ends, with MTCH2's finishes, auto-winner and title rule. */
export function resolveOnShowNight(
  input: MatchOutcomeInput,
  deps: MatchOutcomeDeps,
): MatchOutcomeResolution {
  const { read } = deps;
  const { catalogs } = read.meta;
  const segment = read.tables.segments.get(input.segmentId);
  // A save from before finishes existed, or a segment that is not a match: the booked result.
  if (catalogs.finishes === undefined || segment?.kind !== 'match') {
    return plannedOrNoContest.resolve(input, deps);
  }
  const show = read.tables.eventInstances.get(input.eventInstanceId);
  const randomWinners = randomWinnersActive(read, {
    promotionId: input.promotionId,
    brandId: show?.brandId ?? null,
  });
  const base = {
    matchTypeKey: segment.match.matchTypeKey,
    stipulationKeys: [...segment.match.stipulationKeys],
    sides: sidesOf(input, deps),
    regionName: read.tables.regions.get(input.regionId)?.name ?? input.regionId,
  };

  const { resultPlan } = segment.match;
  const booked = input.plan !== null || input.plannedFinishKey !== null || resultPlan !== undefined;
  const attempts: Attempt[] = [];
  let mode: AutoWinnerMode = randomWinners ? 'randomWinners' : 'standard';
  if (randomWinners) {
    attempts.push({ plan: AUTO_PLAN, notes: booked ? [RANDOM_WINNERS_SET_ASIDE_NOTE] : [] });
  } else if (resultPlan !== undefined && input.plan === null) {
    mode = resultPlan === 'random' ? 'coinFlip' : 'standard';
    const plan: MatchPlan = { ...AUTO_PLAN, finishKey: input.plannedFinishKey };
    attempts.push({ plan, notes: [] });
    if (plan.finishKey !== null) {
      attempts.push({ plan: AUTO_PLAN, notes: [] });
    }
  } else if (input.plan?.kind === 'noContest' && input.plannedFinishKey === null) {
    return bookedNoContest(base, input, deps);
  } else {
    const plan = matchPlanOf(input.plan, input.plannedFinishKey);
    attempts.push({ plan, notes: [] });
    if (plan.finishKey !== null || plan.methodKey !== null) {
      attempts.push({ plan: { ...plan, finishKey: null, methodKey: null }, notes: [] });
    }
  }

  const refusals: Reason[] = [];
  for (const [index, attempt] of attempts.entries()) {
    const resolved = resolveMatchOutcome(
      { ...base, plan: attempt.plan, mode },
      { catalogs, tunables: deps.tunables, rng: (name) => deps.rng(name) },
    );
    if (resolved.ok) {
      const { value, trace } = resolved.resolution;
      const notes = index === 0 ? attempt.notes : [planSetAsideNote(refusals)];
      return {
        outcome: value.outcome,
        finishKey: value.finishKey,
        methodKey: value.methodKey,
        titleCanChange: titleRuleOf(catalogs, value.finishKey, value.methodKey),
        trace: withNotes(trace, notes),
      };
    }
    if (index === 0) {
      refusals.push(...resolved.reasons);
    }
  }
  const fallback = plannedOrNoContest.resolve(input, deps);
  return { ...fallback, trace: withNotes(fallback.trace, [bookedResultFallbackNote(refusals)]) };
}

/** MTCH2's match outcome resolver for show night. */
export const showNightOutcomeResolver: MatchOutcomeResolver = {
  id: MATCH_OUTCOME_RESOLVER_ID,
  resolve: resolveOnShowNight,
};

registerMatchOutcomeResolver(showNightOutcomeResolver);
