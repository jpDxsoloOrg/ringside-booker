/**
 * Show-night injuries end to end on the shipped default world (WRK6-07): a year of play with every
 * show carded (the save budget's setup), the player pressing Run the show on every show day.
 *
 * Checked every evening, after the day's shows, by an observer phase:
 * - every injury from a match came through MTCH4's applier into WRK6's built-in handler
 *   (`health.injure`): a `segment` row pointing at a match on a show completed that day, with the
 *   worker's injury pointer set;
 * - an injured worker is unavailable to booking (WRK1 `availabilityOf` says injured until the
 *   expected return) and the rival planner (`buildCardPool`) never puts them in a match before they
 *   are back;
 * - every injury ends on its expected return day, and none is left open past it.
 *
 * Prints the year's injury counts (in a match or off screen, the player's workers or rivals') and
 * the run's wall time. Simulating the year takes about a minute, so it runs with `RB_SLOW_TESTS=1`:
 *   RB_SLOW_TESTS=1 npx vitest run --root ../.. --project engine test/systems/health/showNightInjuries
 * `RB_INJURY_DAYS` changes the length (default 365).
 *
 * Measured on the WRK6-07 branch (365 days): see docs/design/health.md#show-night-injuries.
 */

import { describe, expect, it } from 'vitest';
import { createEngine } from '../../../src/core/api';
import { defineSystem } from '../../../src/core/api/system';
import { compareDates, type GameDate } from '../../../src/core/date';
import type { InjuryId } from '../../../src/core/ids';
import { definePhase } from '../../../src/core/pipeline/phase';
import { defaultSystems } from '../../../src/systems';
import { showControllerOf } from '../../../src/systems/calendar/control';
import { worksForAHuman } from '../../../src/systems/health/notice';
import { availabilityOf } from '../../../src/systems/workers/helpers/availability';
import { withMyShowsRun } from '../../support';
import { cardEveryShowSystem } from '../../support/card-every-show';
import { SLOW_TESTS } from '../../support/slow';
import { startDefaultGame } from '../calendar/default-game';

const DAYS = Number(process.env['RB_INJURY_DAYS'] ?? '365');
const TIMEOUT_MS = 120_000 + DAYS * 3_000;

interface Counts {
  inMatch: number;
  offscreen: number;
}

interface Observed {
  readonly player: Counts;
  readonly rivals: Counts;
  /** Problems found, each a sentence naming the day and the people. */
  readonly problems: string[];
  /** Injuries seen being sustained, so each is counted once. */
  readonly seen: Set<InjuryId>;
  healed: number;
  /** Rival matches checked for injured workers. */
  rivalMatchesChecked: number;
}

function observer(observed: Observed) {
  return defineSystem({
    id: 'testInjuryObserver',
    phases: [
      definePhase({
        id: 'testInjuryObserver.checkEvening',
        group: 'periodic',
        order: 99,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          const { read } = ctx;
          const day: GameDate = ctx.date;
          const problem = (text: string): void => {
            observed.problems.push(`${day}: ${text}`);
          };
          for (const injury of read.tables.injuries.values()) {
            const person = read.tables.people.require(injury.personId);
            if (injury.returnedOn === null) {
              // Open: still out, and booking sees it.
              if (compareDates(injury.expectedReturn, day) <= 0) {
                problem(`${injury.id} is still open on or after its return day`);
              }
              if (person.injury === null) {
                problem(`${injury.id} is open but ${person.id} has no injury`);
                continue;
              }
              const availability = availabilityOf(person, null, day);
              if (
                availability.status !== 'injured' ||
                availability.until !== injury.expectedReturn
              ) {
                problem(`${person.id} is ${availability.status} while ${injury.id} is open`);
              }
            } else if (injury.returnedOn === day) {
              observed.healed += 1;
              if (injury.returnedOn !== injury.expectedReturn) {
                problem(`${injury.id} ended on ${injury.returnedOn}, not ${injury.expectedReturn}`);
              }
            }
            if (injury.since !== day || observed.seen.has(injury.id)) {
              continue;
            }
            observed.seen.add(injury.id);
            const side = worksForAHuman(read, injury.personId, day)
              ? observed.player
              : observed.rivals;
            if (injury.source === 'world') {
              side.offscreen += 1;
              continue;
            }
            side.inMatch += 1;
            const segment =
              injury.segmentId === null ? undefined : read.tables.segments.get(injury.segmentId);
            const show =
              segment === undefined
                ? undefined
                : read.tables.eventInstances.get(segment.eventInstanceId);
            if (segment?.kind !== 'match' || show?.status !== 'completed' || show.date !== day) {
              problem(`${injury.id} from a match does not point at a match run tonight`);
            }
          }

          // Rival cards tonight: nobody wrestled while out with an injury from before today.
          for (const show of read.tables.eventInstances.lookup('byDate', day)) {
            if (show.status !== 'completed' || showControllerOf(read, show).kind !== 'computer') {
              continue;
            }
            for (const segment of read.tables.segments.lookup('byEventInstance', show.id)) {
              if (segment.kind !== 'match') {
                continue;
              }
              observed.rivalMatchesChecked += 1;
              for (const participant of read.tables.participants.lookup('bySegment', segment.id)) {
                if (participant.role !== 'competitor') {
                  continue;
                }
                const open = read.tables.injuries.lookupOne('openByPerson', participant.personId);
                if (open !== undefined && compareDates(open.since, day) < 0) {
                  problem(`${participant.personId} wrestled for a rival while out (${open.id})`);
                }
              }
            }
          }
        },
      }),
    ],
  });
}

function now(): number {
  // eslint-disable-next-line no-restricted-properties -- the report prints the real run time
  return performance.now();
}

describe.runIf(SLOW_TESTS)(`show-night injuries over ${String(DAYS)} default-world days`, () => {
  it(
    'apply match injuries through health.injure, keep the injured out and bring them back on time',
    { timeout: TIMEOUT_MS },
    async () => {
      const observed: Observed = {
        player: { inMatch: 0, offscreen: 0 },
        rivals: { inMatch: 0, offscreen: 0 },
        problems: [],
        seen: new Set(),
        healed: 0,
        rivalMatchesChecked: 0,
      };
      const engine = createEngine({
        state: startDefaultGame(),
        systems: withMyShowsRun([...defaultSystems, cardEveryShowSystem, observer(observed)]),
      });
      const startedAt = now();
      const advanced = await engine.advanceDays({ maxDays: DAYS });
      const wallMs = now() - startedAt;
      expect(advanced.failures).toEqual([]);
      expect(advanced.daysAdvanced).toBe(DAYS);

      console.log(
        [
          `${String(DAYS)} days of the default world, every show carded: ${(wallMs / 1000).toFixed(1)} s`,
          `  player's workers: ${String(observed.player.inMatch)} in a match, ${String(observed.player.offscreen)} off screen`,
          `  rivals' workers:  ${String(observed.rivals.inMatch)} in a match, ${String(observed.rivals.offscreen)} off screen`,
          `  returned: ${String(observed.healed)}; rival matches checked: ${String(observed.rivalMatchesChecked)}`,
        ].join('\n'),
      );

      expect(observed.problems).toEqual([]);
      // The player's matches injure people; rival rules skip in-match injuries by default.
      expect(observed.player.inMatch).toBeGreaterThan(0);
      expect(observed.rivals.inMatch).toBe(0);
      expect(observed.rivals.offscreen).toBeGreaterThan(0);
      expect(observed.healed).toBeGreaterThan(0);
      expect(observed.rivalMatchesChecked).toBeGreaterThan(0);
    },
  );
});
