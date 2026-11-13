// The two-year title check (AIP5-04): rival bookers change titles at a plausible rate and never
// hand a title to someone who can't hold it. Design:
// docs/design/rival-booking.md#how-a-rival-shows-results-are-decided
//
// Two years of the default world take a minute or more, so this runs with `RB_SLOW_TESTS=1`:
//   RB_SLOW_TESTS=1 npx vitest run --root ../.. --project engine test/systems/aip/results/titleRate
// It prints the numbers it measured (recorded in docs/design/rival-booking.md#two-year-title-check)
// and the time `aip.decideResults` takes.
import { describe, expect, it } from 'vitest';
import { createEngine } from '../../../../src/core/api';
import { defineSystem, type SystemBundle } from '../../../../src/core/api/system';
import { compareDates, diffDays, type GameDate } from '../../../../src/core/date';
import type { SegmentId, TitleId } from '../../../../src/core/ids';
import { definePhase } from '../../../../src/core/pipeline/phase';
import { methodOf } from '../../../../src/model/catalogs';
import {
  DECIDE_RESULTS_STEP_ORDER,
  registerBookedCardStep,
  TITLE_DECISION_KIND,
} from '../../../../src/systems/aip';
import { employmentAt, openReignOf } from '../../../../src/systems/aip/inputs';
import { cardSegments } from '../../../../src/systems/booking/card';
import { showControllerOf } from '../../../../src/systems/calendar/control';
import { defaultSystems } from '../../../../src/systems';
import { availabilityOf } from '../../../../src/systems/workers/helpers/availability';
import { isEligibleForTitle } from '../../../../src/systems/workers/helpers/eligibility';
import { withMyShowsRun } from '../../../support';
import { SLOW_TESTS } from '../../../support/slow';
import { startDefaultGame } from '../../calendar/default-game';

const DAYS = Number(process.env['RB_TITLE_DAYS'] ?? '730');
/** Longleaf Championship Wrestling, a mid-sized promotion: most of the world is rivals. */
const PLAYER_PROMOTION_KEY = 'pro-us-southeast';

function now(): number {
  // eslint-disable-next-line no-restricted-properties -- a timing report has to read the real clock
  return performance.now();
}

/** A title change a rival booker planned, checked on the morning it was booked. */
interface PlannedChange {
  readonly segmentId: SegmentId;
  readonly titleId: TitleId;
  readonly date: GameDate;
  readonly house: boolean;
  /** What stops a new champion: eligibility, availability or a short contract. Empty when fine. */
  readonly problems: readonly string[];
}

interface Watch {
  readonly planned: PlannedChange[];
  /** Rival matches booked as draws. */
  draws: number;
  /** Rival matches with a planned result. */
  plannedMatches: number;
  /** Rival matches about to run with no planned result: `show (status) date: segment`. */
  readonly unplanned: string[];
}

/**
 * Looks at every computer show booked today, right before show night runs it: each title the
 * planned winners would take (they don't hold it and the method can change titles), and whether
 * they could hold it.
 */
function watchingSystem(watch: Watch): SystemBundle {
  return defineSystem({
    id: 'watchRivalTitles',
    phases: [
      definePhase({
        id: 'watchRivalTitles.check',
        group: 'shows',
        order: 1,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          const minContract = ctx.tunables.get('aip.titles.challengerMinContractDays');
          for (const show of ctx.read.tables.eventInstances.lookup('byDate', ctx.date)) {
            if (
              (show.status !== 'booked' && show.status !== 'scheduled') ||
              showControllerOf(ctx.read, show).kind !== 'computer'
            ) {
              continue;
            }
            for (const segment of cardSegments(ctx.read, show.id)) {
              if (segment.kind !== 'match') {
                continue;
              }
              if (segment.outcome === null) {
                watch.unplanned.push(`${show.name} (${show.status}) ${ctx.date}: ${segment.id}`);
                continue;
              }
              watch.plannedMatches += 1;
              if (segment.outcome.kind === 'draw') {
                watch.draws += 1;
              }
              const outcome = segment.outcome;
              if (
                outcome.kind !== 'win' ||
                methodOf(ctx.read, outcome.methodKey)?.changesTitles !== true
              ) {
                continue;
              }
              const winners = ctx.read.tables.participants
                .lookup('bySegment', segment.id)
                .filter((row) => row.role === 'competitor' && row.side === outcome.winningSide)
                .map((row) => row.personId);
              for (const titleId of segment.match.titleIds) {
                const title = ctx.read.tables.titles.require(titleId);
                const reign = openReignOf(ctx.read, titleId);
                if (reign?.holderIds.every((holderId) => winners.includes(holderId)) === true) {
                  continue;
                }
                if (winners.length !== title.holderCount) {
                  continue;
                }
                const problems: string[] = [];
                for (const personId of winners) {
                  const person = ctx.read.tables.people.require(personId);
                  const employment = employmentAt(ctx.read, personId, show.promotionId, ctx.date);
                  problems.push(
                    ...isEligibleForTitle(person, title).map((reason) => reason.message),
                  );
                  const availability = availabilityOf(person, employment, ctx.date);
                  if (availability.status !== 'available') {
                    problems.push(availability.reason);
                  }
                  if (
                    employment?.endsOn !== null &&
                    employment?.endsOn !== undefined &&
                    diffDays(ctx.date, employment.endsOn) < minContract
                  ) {
                    problems.push(`${person.defaultRingName}'s contract is too short`);
                  }
                }
                watch.planned.push({
                  segmentId: segment.id,
                  titleId,
                  date: ctx.date,
                  house: show.importance === 'house',
                  problems,
                });
              }
            }
          }
        },
      }),
    ],
  });
}

describe.runIf(SLOW_TESTS)(`rival titles over ${String(DAYS)} days of the default world`, () => {
  it(
    'change at a plausible rate, never on a house show, never to someone who cannot hold them',
    { timeout: 120_000 + DAYS * 2_000 },
    async () => {
      // Time aip.decideResults with steps just before and after it.
      let decideMs = 0;
      let decideShows = 0;
      let startedAt = 0;
      const removeStart = registerBookedCardStep({
        id: 'test.timeResultsStart',
        order: DECIDE_RESULTS_STEP_ORDER - 1,
        run: () => {
          startedAt = now();
        },
      });
      const removeEnd = registerBookedCardStep({
        id: 'test.timeResultsEnd',
        order: DECIDE_RESULTS_STEP_ORDER + 1,
        run: () => {
          decideMs += now() - startedAt;
          decideShows += 1;
        },
      });
      try {
        const watch: Watch = { planned: [], draws: 0, plannedMatches: 0, unplanned: [] };
        const state = startDefaultGame({
          player: { mode: 'existing', promotionKey: PLAYER_PROMOTION_KEY },
        });
        const start = state.world.meta.currentDate;
        const engine = createEngine({
          state,
          systems: withMyShowsRun([...defaultSystems, watchingSystem(watch)]),
        });
        const simStarted = now();
        const advanced = await engine.advanceDays({ maxDays: DAYS });
        const simMs = now() - simStarted;
        expect(advanced.failures).toEqual([]);
        expect(advanced.daysAdvanced).toBe(DAYS);

        const { tables } = engine.exportState().world;
        const controllerOf = new Map(
          tables.promotions.map((promotion) => [promotion.id, promotion.controller.kind]),
        );
        const rivalTitles = tables.titles.filter(
          (title) =>
            controllerOf.get(title.promotionId) === 'computer' && title.status !== 'retired',
        );
        const rivalTitleIds = new Set(rivalTitles.map((title) => title.id));
        const segmentsById = new Map(tables.segments.map((segment) => [segment.id, segment]));
        const showsById = new Map(tables.eventInstances.map((show) => [show.id, show]));
        const plannedBySegmentTitle = new Map(
          watch.planned.map((entry) => [`${entry.segmentId}|${entry.titleId}`, entry]),
        );

        expect(watch.unplanned).toEqual([]);
        // Every new reign on a computer show was planned there, by someone who could hold it.
        const newReigns = tables.titleReigns.filter(
          (reign) =>
            rivalTitleIds.has(reign.titleId) &&
            reign.wonInSegmentId !== null &&
            compareDates(reign.wonOn, start) >= 0,
        );
        let onComputerShows = 0;
        for (const reign of newReigns) {
          const segment =
            reign.wonInSegmentId === null ? undefined : segmentsById.get(reign.wonInSegmentId);
          const show = segment === undefined ? undefined : showsById.get(segment.eventInstanceId);
          expect(show, `show of reign ${reign.id}`).toBeDefined();
          if (show === undefined) {
            continue;
          }
          expect(show.importance, `${reign.id} on ${show.name}`).not.toBe('house');
          const planned = plannedBySegmentTitle.get(
            `${String(reign.wonInSegmentId)}|${reign.titleId}`,
          );
          expect(
            planned,
            `planned change for reign ${reign.id}: ${show.name} (${show.importance}) on ${show.date}, ${JSON.stringify(segment?.kind === 'match' ? { outcome: segment.outcome, titles: segment.match.titleIds } : null)}, holders ${reign.holderIds.join(' & ')}`,
          ).toBeDefined();
          expect(planned?.problems ?? [], `new champions of reign ${reign.id}`).toEqual([]);
          onComputerShows += 1;
        }
        expect(watch.planned.filter((entry) => entry.house)).toEqual([]);
        expect(watch.draws).toBe(0);
        expect(watch.unplanned).toEqual([]);

        // Reign lengths and how often titles move.
        const ended = tables.titleReigns.filter(
          (reign) =>
            rivalTitleIds.has(reign.titleId) &&
            reign.lostOn !== null &&
            compareDates(reign.lostOn, start) >= 0,
        );
        const endedInRun = ended.filter((reign) => compareDates(reign.wonOn, start) >= 0);
        const meanDays = (reigns: typeof ended): number =>
          reigns.length === 0
            ? 0
            : reigns.reduce(
                (sum, reign) => sum + diffDays(reign.wonOn, reign.lostOn ?? reign.wonOn),
                0,
              ) / reigns.length;
        const defencesOf = new Map<TitleId, number>();
        const changesOf = new Map<TitleId, number>();
        for (const reign of tables.titleReigns) {
          if (!rivalTitleIds.has(reign.titleId)) {
            continue;
          }
          defencesOf.set(reign.titleId, (defencesOf.get(reign.titleId) ?? 0) + reign.defences);
          if (reign.wonInSegmentId !== null && compareDates(reign.wonOn, start) >= 0) {
            changesOf.set(reign.titleId, (changesOf.get(reign.titleId) ?? 0) + 1);
          }
        }
        const defended = rivalTitles.filter((title) => (defencesOf.get(title.id) ?? 0) >= 4);
        const defendedAndChanged = defended.filter((title) => (changesOf.get(title.id) ?? 0) > 0);
        const years = DAYS / 365;
        const perTitle = rivalTitles.map(
          (title) =>
            `${title.name}: ${String(changesOf.get(title.id) ?? 0)} changes, ${String(defencesOf.get(title.id) ?? 0)} defences`,
        );
        const reasons = new Map<string, number>();
        for (const row of tables.aiDecisions) {
          if (row.kind === TITLE_DECISION_KIND) {
            const reason = `${String(row.summary.params['plan'])}: ${String(row.summary.params['reason'])}`;
            reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
          }
        }
        const reasonLines = [...reasons.entries()]
          .sort((left, right) => right[1] - left[1])
          .map(([reason, count]) => `  ${String(count)} x ${reason}`);
        const changeShare = defended.length === 0 ? 1 : defendedAndChanged.length / defended.length;
        console.log(
          [
            `${String(DAYS)} days, player on Longleaf: sim ${(simMs / 1000).toFixed(1)} s`,
            `aip.decideResults: ${decideMs.toFixed(0)} ms over ${String(decideShows)} rival shows (${(decideMs / Math.max(decideShows, 1)).toFixed(2)} ms a show, ${(decideMs / DAYS).toFixed(2)} ms a day)`,
            `Rival matches planned: ${String(watch.plannedMatches)}, draws ${String(watch.draws)}`,
            `Rival titles: ${String(rivalTitles.length)}; new reigns on computer shows: ${String(onComputerShows)} (${(onComputerShows / rivalTitles.length / years).toFixed(2)} changes per title per year)`,
            `Reigns ended in the run: ${String(ended.length)}, mean ${meanDays(ended).toFixed(0)} days; those also begun in it: ${String(endedInRun.length)}, mean ${meanDays(endedInRun).toFixed(0)} days`,
            `Titles defended 4+ times: ${String(defended.length)}, changed hands: ${String(defendedAndChanged.length)} (${(changeShare * 100).toFixed(0)}%)`,
            'Title decisions by plan and reason (the decision log keeps the newest):',
            ...reasonLines,
            ...perTitle,
          ].join('\n'),
        );
        expect(meanDays(ended)).toBeGreaterThanOrEqual(60);
        expect(meanDays(ended)).toBeLessThanOrEqual(400);
        expect(changeShare).toBeGreaterThanOrEqual(0.6);
      } finally {
        removeStart();
        removeEnd();
      }
    },
  );
});
