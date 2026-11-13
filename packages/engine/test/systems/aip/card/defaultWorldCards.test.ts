// Rival cards on the shipped default world (AIP4-05): four weeks of show days, every computer show
// booked with a valid card or cancelled with a reason. Design: docs/design/rival-booking.md#show-day
//
// A new default-world game takes a few seconds and four weeks of it a few more, so this runs with
// `RB_SLOW_TESTS=1`.
import { describe, expect, it } from 'vitest';
import { createEngine } from '../../../../src/core/api';
import { defineSystem, type SystemBundle } from '../../../../src/core/api/system';
import { addDays, compareDates } from '../../../../src/core/date';
import type { EventInstanceId, PersonId } from '../../../../src/core/ids';
import { definePhase } from '../../../../src/core/pipeline/phase';
import { CARD_DECISION_KIND, NO_PLANNED_RESULT_CODE } from '../../../../src/systems/aip';
import { cardSegments } from '../../../../src/systems/booking/card';
import { validateCard } from '../../../../src/systems/booking/validate/validateCard';
import { showControllerOf } from '../../../../src/systems/calendar/control';
import { defaultSystems } from '../../../../src/systems';
import { withMyShowsRun } from '../../../support';
import { SLOW_TESTS } from '../../../support/slow';
import { startDefaultGame } from '../../calendar/default-game';

const DAYS = 28;

interface Checked {
  readonly id: EventInstanceId;
  readonly name: string;
  readonly errors: readonly string[];
  /** People in more than one match on the card. */
  readonly twice: readonly PersonId[];
}

/**
 * Checks every computer show booked today, right before show night runs it (`shows` group, order
 * 1): EVT2's validation apart from planned winners, and nobody in two matches.
 */
function checkingSystem(checked: Checked[]): SystemBundle {
  return defineSystem({
    id: 'checkRivalCards',
    phases: [
      definePhase({
        id: 'checkRivalCards.check',
        group: 'shows',
        order: 1,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          for (const show of ctx.read.tables.eventInstances.lookup('byDate', ctx.date)) {
            if (show.status !== 'booked' || showControllerOf(ctx.read, show).kind !== 'computer') {
              continue;
            }
            const errors = validateCard(ctx.read, show.id, { tunables: ctx.tunables })
              .errors.filter((issue) => issue.code !== NO_PLANNED_RESULT_CODE)
              .map((issue) => `${issue.code}: ${issue.message}`);
            const seen = new Set<PersonId>();
            const twice: PersonId[] = [];
            for (const segment of cardSegments(ctx.read, show.id)) {
              if (segment.kind !== 'match') {
                continue;
              }
              for (const participant of ctx.read.tables.participants.lookup(
                'bySegment',
                segment.id,
              )) {
                if (seen.has(participant.personId)) {
                  twice.push(participant.personId);
                }
                seen.add(participant.personId);
              }
            }
            checked.push({ id: show.id, name: show.name, errors, twice });
          }
        },
      }),
    ],
  });
}

describe.runIf(SLOW_TESTS)('rival cards on the default world', () => {
  it(
    `books or cancels every computer show for ${String(DAYS)} days, each booked card valid`,
    { timeout: 120_000 },
    async () => {
      const checked: Checked[] = [];
      const state = startDefaultGame();
      const start = state.world.meta.currentDate;
      const engine = createEngine({
        state,
        systems: withMyShowsRun([...defaultSystems, checkingSystem(checked)]),
      });
      const result = await engine.advanceDays({ maxDays: DAYS });
      expect(result.failures).toEqual([]);
      expect(result.daysAdvanced).toBe(DAYS);

      const after = engine.exportState().world;
      const end = addDays(start, DAYS);
      const computerShows = after.tables.eventInstances.filter(
        (show) =>
          compareDates(show.date, start) >= 0 &&
          compareDates(show.date, end) < 0 &&
          after.tables.promotions.find((promotion) => promotion.id === show.promotionId)?.controller
            .kind === 'computer',
      );
      expect(computerShows.length).toBeGreaterThan(20);

      const decisions = new Map(
        after.tables.aiDecisions
          .filter((decision) => decision.kind === CARD_DECISION_KIND)
          .map((decision) => [decision.refs.eventInstanceId, decision]),
      );
      const checkedIds = new Set(checked.map((entry) => entry.id));
      for (const show of computerShows) {
        // Every rival show ran with its card, or was called off with a reason.
        expect(['completed', 'cancelled'], `${show.name} ${show.date}`).toContain(show.status);
        if (show.status === 'completed') {
          expect(checkedIds.has(show.id), `${show.name} ${show.date} was booked`).toBe(true);
        } else {
          expect(show.cancellation?.reason).toBe('byPromotion');
          const reason = decisions.get(show.id)?.summary.params['reason'];
          expect(String(reason ?? '')).not.toBe('');
        }
        expect(decisions.get(show.id)?.revealOn).toBe(show.airDate);
      }
      for (const entry of checked) {
        expect(entry.errors, entry.name).toEqual([]);
        expect(entry.twice, entry.name).toEqual([]);
      }
    },
  );
});
