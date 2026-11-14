/**
 * The titles system's day phase: `titles.vacateOrphaned` (CRTV1-03).
 *
 * A champion who no longer works for the title's promotion (or its parent) for
 * `titles.orphanGraceDays` days loses the title, with a Why? that says when they left. It runs
 * daily in the `contracts` group at order 90, after every contract change of the day (the
 * lifecycle at 10, walk-outs at 30), the same for every promotion, the player's and the rivals'.
 * A tag or trios title is vacated whole when any one holder has been gone too long.
 *
 * Why a daily check and not a reaction to `contract.expired` / `released` / `quit`: the grace
 * period means the vacancy comes days after the event, and nothing in the save may hold a pending
 * vacancy (no schema change). The check is cheap: one `openByTitle` index lookup per active title
 * and one `byPerson` lookup per champion; the trace is built only for a title it vacates. It also
 * catches champions who left before this rule existed (ECO4's releases kept the belt).
 *
 * Design: docs/design/titles.md#orphaned-champions.
 */

import { diffDays, type GameDate } from '../../core/date';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import type { PhaseContext } from '../../core/pipeline/context';
import { startDecision } from '../../core/trace/decision';
import { inputOf } from '../../core/trace/helpers';
import type { Traced } from '../../core/trace/types';
import type { PersonId } from '../../core/ids';
import type { Title } from '../../model/entities/title';
import type { TitleReign } from '../../model/entities/title-reign';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { ORPHANED_VACANCY_REASON_KEY, vacateTitle } from './doors';
import { reignDateText } from './formulas/reignDays';
import { employedForTitle, lastEmployedForTitleOn, ringNameForTitle } from './helpers/employment';
import { currentReign } from './helpers/holders';

export const VACATE_ORPHANED_PHASE_ID = 'titles.vacateOrphaned';
export const ORPHANED_CHAMPIONS_DOC_REF = 'docs/design/titles.md#orphaned-champions';

/** How one champion stands with the title's promotion today. */
export interface HolderStanding {
  readonly personId: PersonId;
  readonly ringName: string;
  /** Works for the promotion (or its parent) today. */
  readonly employed: boolean;
  /** When not employed: the day their last contract there ended, or the day they won it. */
  readonly since: GameDate | null;
  /** When not employed: whole days since `since`. */
  readonly daysGone: number | null;
}

function daysText(days: number): string {
  if (days === 0) {
    return 'left today';
  }
  return days === 1 ? '1 day' : `${String(days)} days`;
}

function promotionText(read: GameWorldView, title: DeepReadonly<Title>): string {
  const promotion = read.tables.promotions.get(title.promotionId);
  const name = promotion?.name ?? title.promotionId;
  return promotion?.parentPromotionId == null ? name : `${name} or its parent`;
}

/** Where every holder of `reign` stands on `date`. */
export function holderStandings(
  read: GameWorldView,
  title: DeepReadonly<Title>,
  reign: DeepReadonly<TitleReign>,
  date: GameDate,
): HolderStanding[] {
  return reign.holderIds.map((personId) => {
    const ringName = ringNameForTitle(read, personId, title.promotionId, date);
    if (employedForTitle(read, personId, title.promotionId, date)) {
      return { personId, ringName, employed: true, since: null, daysGone: null };
    }
    const since = lastEmployedForTitleOn(read, personId, title.promotionId) ?? reign.wonOn;
    return { personId, ringName, employed: false, since, daysGone: diffDays(since, date) };
  });
}

/** True when some holder has been gone for at least `graceDays`. */
export function isOrphaned(standings: readonly HolderStanding[], graceDays: number): boolean {
  return standings.some((standing) => standing.daysGone !== null && standing.daysGone >= graceDays);
}

/**
 * The Why? of an orphaned vacancy: one rule per holder (passed while they still work there or are
 * within the grace period), the grace tunable, and the choice.
 */
export function orphanVacancyExplanation(
  ctx: Pick<PhaseContext, 'read' | 'tunables'>,
  title: DeepReadonly<Title>,
  standings: readonly HolderStanding[],
): Traced<string> {
  const decision = startDecision<string>('How the reign ended', {
    docRef: ORPHANED_CHAMPIONS_DOC_REF,
  });
  const where = promotionText(ctx.read, title);
  const grace = ctx.tunables.get('titles.orphanGraceDays');
  for (const standing of standings) {
    // The champion as a linked line first, so the Why? panel's name opens their profile.
    const personRef = { kind: 'person', id: standing.personId } as const;
    if (standing.since === null || standing.daysGone === null) {
      decision.include(standing.ringName, inputOf(standing.ringName, 'Under contract', personRef));
      decision.rule(`${standing.ringName} works for ${where}`, true);
      continue;
    }
    decision.include(
      standing.ringName,
      inputOf(
        standing.ringName,
        standing.daysGone === 0 ? 'Left today' : `No contract for ${daysText(standing.daysGone)}`,
        personRef,
      ),
    );
    decision.rule(
      `${standing.ringName} has had no contract with ${where} since ${reignDateText(standing.since)} (${daysText(standing.daysGone)})`,
      standing.daysGone < grace,
    );
  }
  decision.tunable(ctx.tunables, 'titles.orphanGraceDays', 'Days a champion may be gone');
  return decision.choose('vacated', 'A champion has been gone longer than the grace period');
}

/** The open reigns of active titles, in reign ID order. One index lookup per title. */
function openReignsOfActiveTitles(read: GameWorldView): TitleReign[] {
  const reigns: TitleReign[] = [];
  for (const title of read.tables.titles.values()) {
    if (title.status !== 'active') {
      continue;
    }
    const reign = currentReign(read, title.id);
    if (reign !== null) {
      reigns.push(reign);
    }
  }
  return reigns.sort((left, right) => compareIds(left.id, right.id));
}

/** The phase body: vacates every title whose champion has been gone for the grace period. */
export function runVacateOrphaned(ctx: PhaseContext): void {
  const grace = ctx.tunables.get('titles.orphanGraceDays');
  for (const reign of openReignsOfActiveTitles(ctx.read)) {
    const title = ctx.read.tables.titles.require(reign.titleId);
    // Nearly every day every champion is still employed: one lookup each, nothing else.
    if (
      reign.holderIds.every((personId) =>
        employedForTitle(ctx.read, personId, title.promotionId, ctx.date),
      )
    ) {
      continue;
    }
    const standings = holderStandings(ctx.read, title, reign, ctx.date);
    if (!isOrphaned(standings, grace)) {
      continue;
    }
    vacateTitle(ctx, {
      titleId: title.id,
      reasonKey: ORPHANED_VACANCY_REASON_KEY,
      source: 'system',
      explanation: orphanVacancyExplanation(ctx, title, standings),
    });
  }
}

export const vacateOrphanedPhase: PhaseDefinition = definePhase({
  id: VACATE_ORPHANED_PHASE_ID,
  group: 'contracts',
  order: 90,
  cadence: { kind: 'daily' },
  run: runVacateOrphaned,
});

export const titlesPhases: readonly PhaseDefinition[] = [vacateOrphanedPhase];
