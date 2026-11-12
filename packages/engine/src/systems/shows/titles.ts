/**
 * Title outcomes on show night (EVT3-04): after a title match is rated, each title on the line
 * either changes hands, is kept by its champion (a defence), stays vacant, or is left alone (a no
 * contest). Built in as the `shows.titleOutcome` segment result applier at order 10, so later
 * appliers (MTCH3's popularity at 30) already see the new champion.
 *
 * Design: docs/design/show-night.md#title-outcomes.
 */

import type { PhaseContext } from '../../core/pipeline/context';
import type { PersonId, TeamId, TitleId } from '../../core/ids';
import { startDecision, type Traced } from '../../core/trace';
import { methodOf } from '../../model/catalogs';
import type { MatchOutcome } from '../../model/entities/segment';
import type { Title } from '../../model/entities/title';
import type { TitleReign } from '../../model/entities/title-reign';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';
import type { SegmentResult, SegmentResultApplier } from './registries';
import { titleOutcomeTraceRef } from './traces';

export const TITLE_OUTCOME_DOC_REF = 'show-night.md#title-outcomes';
export const DRAW_COUNTS_AS_DEFENCE = 'shows.titles.drawCountsAsDefence';

/** What a title match meant for one title on the line. */
export type TitleOutcome = 'changed' | 'retained' | 'stillVacant' | 'noChange';

export const CHAMPION_WON_REASON = 'Champion won';
export const NO_CONTEST_REASON = 'No contest: the title stays where it was';
export const DRAW_DEFENCE_REASON = 'Draw: the champion keeps the title, and it counts as a defence';
export const DRAW_NO_DEFENCE_REASON =
  'Draw: the champion keeps the title, but it does not count as a defence';
export const DRAW_VACANT_REASON = 'Draw: the title stays vacant';

/** Everything the decision reads, as plain data. */
export interface TitleOutcomeInputs {
  readonly titleName: string;
  /** How many people hold the title at once. */
  readonly holderCount: number;
  /** True when the title has no open reign: every side is then a challenger side. */
  readonly vacant: boolean;
  /** How the match ended. */
  readonly outcome: MatchOutcome;
  /** True when the winning side holds the title (always false for a vacant title or a non-win). */
  readonly holdersWon: boolean;
  /** Competitors on the winning side. */
  readonly winnerCount: number;
  /** The method that won the match; null when it is not in the catalog. */
  readonly method: { readonly name: string; readonly changesTitles: boolean } | null;
  /** MTCH2's title rule (method and finish), when the resolver decided it; null otherwise. */
  readonly titleCanChange: Traced<boolean> | null;
}

export interface TitleOutcomeDeps {
  readonly tunables: EngineTunables;
}

function titleCanChangeText(rule: Traced<boolean>): string {
  return rule.trace.kind === 'decision' ? rule.trace.reason : rule.trace.label;
}

/**
 * Decides what a title match means for one title. A challenger win moves the title only when the
 * method (or, with MTCH2, the method and the finish) can change titles and the winning side has as
 * many competitors as the title has holders; every failing rule keeps the title where it was.
 */
export function titleOutcomeDecision(
  inputs: TitleOutcomeInputs,
  deps: TitleOutcomeDeps,
): Traced<TitleOutcome> {
  const decision = startDecision<TitleOutcome>(`Title outcome: ${inputs.titleName}`, {
    docRef: TITLE_OUTCOME_DOC_REF,
  });
  const kept: TitleOutcome = inputs.vacant ? 'stillVacant' : 'retained';
  const { outcome } = inputs;

  if (outcome.kind === 'noContest') {
    return decision.choose('noChange', NO_CONTEST_REASON);
  }
  if (outcome.kind === 'draw') {
    if (inputs.vacant) {
      return decision.choose('stillVacant', DRAW_VACANT_REASON);
    }
    const counts = decision.tunable(
      deps.tunables,
      DRAW_COUNTS_AS_DEFENCE,
      'Draws count as defences',
    );
    return decision.choose('retained', counts ? DRAW_DEFENCE_REASON : DRAW_NO_DEFENCE_REASON);
  }
  if (inputs.holdersWon) {
    return decision.choose('retained', CHAMPION_WON_REASON);
  }

  const methodName = inputs.method?.name ?? 'This method';
  let failed: string | null = null;
  if (inputs.titleCanChange === null) {
    const allows = inputs.method?.changesTitles === true;
    decision.rule(`${methodName} can change titles`, allows);
    if (!allows) {
      failed = `${methodName} can't change titles`;
    }
  } else {
    const text = titleCanChangeText(inputs.titleCanChange);
    decision.rule(text, inputs.titleCanChange.value);
    if (!inputs.titleCanChange.value) {
      failed = text;
    }
  }
  const sizeText = `Winning side has ${String(inputs.winnerCount)} competitors; the title needs ${String(inputs.holderCount)}`;
  const sizeOk = inputs.winnerCount === inputs.holderCount;
  decision.rule(sizeText, sizeOk);
  if (!sizeOk) {
    failed ??= sizeText;
  }
  if (failed !== null) {
    return decision.choose(kept, failed);
  }
  return decision.choose('changed', `Challengers won by ${methodName}`);
}

/** True when a decision of `retained` adds a defence: always for a win, for a draw by the flag. */
export function countsAsDefence(
  outcome: MatchOutcome,
  decided: TitleOutcome,
  tunables: EngineTunables,
): boolean {
  if (decided !== 'retained') {
    return false;
  }
  return (
    outcome.kind === 'win' || (outcome.kind === 'draw' && tunables.get(DRAW_COUNTS_AS_DEFENCE))
  );
}

/** The ring name a holder used with the title's promotion when they won, else their default. */
function ringNameAt(
  read: GameWorldView,
  personId: PersonId,
  promotionId: Title['promotionId'],
): string {
  const employment = read.tables.employments
    .lookup('byPerson', personId)
    .find((row) => row.status === 'active' && row.promotionId === promotionId);
  return employment?.ringName ?? read.tables.people.get(personId)?.defaultRingName ?? personId;
}

/** The winners' shared team, for a title held by more than one person; else null. */
function winningTeam(
  read: GameWorldView,
  result: SegmentResult,
  holderCount: number,
): TeamId | null {
  if (holderCount <= 1) {
    return null;
  }
  const winners = new Set(result.winnerIds);
  const teams = read.tables.participants
    .lookup('bySegment', result.segmentId)
    .filter((row) => row.role === 'competitor' && winners.has(row.personId))
    .map((row) => row.teamId);
  const [first] = teams;
  if (first === undefined || first === null) {
    return null;
  }
  return teams.every((teamId) => teamId === first) ? first : null;
}

/** The sides that hold any current champion of the reign. */
function holderSides(result: SegmentResult, reign: DeepReadonly<TitleReign>): Set<number> {
  const holders = new Set<string>(reign.holderIds);
  return new Set(
    result.sides
      .filter((side) => side.personIds.some((personId) => holders.has(personId)))
      .map((side) => side.side),
  );
}

/** A title on the line, or null (logged) when it cannot be settled here. */
function settleableTitle(
  ctx: PhaseContext,
  result: SegmentResult,
  titleId: TitleId,
): DeepReadonly<Title> | null {
  const title = ctx.read.tables.titles.get(titleId);
  if (title === undefined) {
    ctx.log(`Title ${titleId} on segment ${result.segmentId} was skipped: it no longer exists`);
    return null;
  }
  if (title.status === 'retired') {
    ctx.log(
      `${title.name} (${title.id}) on segment ${result.segmentId} was skipped: it is retired`,
    );
    return null;
  }
  if (title.promotionId !== result.promotionId) {
    ctx.log(
      `${title.name} (${title.id}) on segment ${result.segmentId} was skipped: it belongs to another promotion`,
    );
    return null;
  }
  return title;
}

function settleTitle(
  ctx: PhaseContext,
  result: SegmentResult,
  outcome: MatchOutcome,
  title: DeepReadonly<Title>,
): void {
  const reign = ctx.read.tables.titleReigns.lookupOne('openByTitle', title.id) ?? null;
  const holdersWon =
    reign !== null && outcome.kind === 'win' && holderSides(result, reign).has(outcome.winningSide);
  const methodKey = result.methodKey ?? (outcome.kind === 'win' ? outcome.methodKey : null);
  const method = methodKey === null ? undefined : methodOf(ctx.read, methodKey);
  const decision = titleOutcomeDecision(
    {
      titleName: title.name,
      holderCount: title.holderCount,
      vacant: reign === null,
      outcome,
      holdersWon,
      winnerCount: result.winnerIds.length,
      method:
        method === undefined
          ? methodKey === null
            ? null
            : { name: methodKey, changesTitles: false }
          : { name: method.name, changesTitles: method.changesTitles },
      titleCanChange: result.titleCanChange,
    },
    { tunables: ctx.tunables },
  );
  ctx.recordTrace(titleOutcomeTraceRef(result.segmentId, title.id), ctx.date, decision);

  if (decision.value === 'changed') {
    // Close the old reign first: the openByTitle unique index allows one open reign per title.
    if (reign !== null) {
      ctx.tx.update('titleReigns', reign.id, {
        lostOn: ctx.date,
        endReason: 'lost',
        endedInSegmentId: result.segmentId,
      });
    }
    const holderIds = [...result.winnerIds].sort(compareIds);
    const created = ctx.tx.create('titleReigns', {
      titleId: title.id,
      holderIds,
      teamId: winningTeam(ctx.read, result, title.holderCount),
      wonOn: ctx.date,
      lostOn: null,
      wonInSegmentId: result.segmentId,
      endedInSegmentId: null,
      endReason: null,
      defences: 0,
      holderNamesAtTime: holderIds.map((personId) =>
        ringNameAt(ctx.read, personId, title.promotionId),
      ),
    });
    ctx.publish('title.changed', {
      titleId: title.id,
      promotionId: title.promotionId,
      fromReignId: reign?.id ?? null,
      toReignId: created.id,
      segmentId: result.segmentId,
      eventInstanceId: result.eventInstanceId,
      newHolderIds: holderIds,
      previousHolderIds: reign === null ? [] : [...reign.holderIds],
    });
    return;
  }

  if (reign !== null && countsAsDefence(outcome, decision.value, ctx.tunables)) {
    const defences = reign.defences + 1;
    ctx.tx.update('titleReigns', reign.id, { defences });
    ctx.publish('title.defended', {
      titleId: title.id,
      promotionId: title.promotionId,
      reignId: reign.id,
      segmentId: result.segmentId,
      eventInstanceId: result.eventInstanceId,
      defences,
    });
  }
}

/** Settles every title on the line in a match, in title id order. */
export function applyTitleOutcomes(ctx: PhaseContext, result: SegmentResult): void {
  if (result.kind !== 'match' || result.outcome === null || result.titleIds.length === 0) {
    return;
  }
  const outcome = result.outcome;
  for (const titleId of [...new Set(result.titleIds)].sort(compareIds)) {
    const title = settleableTitle(ctx, result, titleId);
    if (title !== null) {
      settleTitle(ctx, result, outcome, title);
    }
  }
}

export const TITLE_OUTCOME_APPLIER_ID = 'shows.titleOutcome';

/** The built-in applier: order 10, before MTCH3's popularity (30), so it sees the new champion. */
export const titleOutcomeApplier: SegmentResultApplier = {
  id: TITLE_OUTCOME_APPLIER_ID,
  order: 10,
  apply: applyTitleOutcomes,
};
