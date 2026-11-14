/**
 * The player's cards for year-long balance runs (EVT6-11's box office calibration), standing in for
 * three kinds of booker:
 *
 * - **poor**: every main-card slot a singles match between the least popular wrestlers on the
 *   roster (an average show score in the high 30s on Altura);
 * - **decent**: `cardEveryShowSystem`'s random singles (low 50s);
 * - **good**: Auto-fill, the rival booker's plan with no planned winners (low 60s).
 *
 * Each fills only the player's own empty cards, in the `shows` group before show night; rivals
 * still book their own shows. Add the result of `playerCardsSystems` to `withMyShowsRun`.
 */

import { defineSystem, type SystemBundle } from '../../src/core/api/system';
import { parseContentKey } from '../../src/core/content-key';
import { definePhase } from '../../src/core/pipeline/phase';
import { promotionStatusKey } from '../../src/model/entities/employment';
import { planCard } from '../../src/systems/aip/card/planCard';
import { AUTOFILL_STREAM } from '../../src/systems/aip/card/streams';
import { cardSegments, MatchDraftSchema, writeSegment } from '../../src/systems/booking';
import { structuralProblems } from '../../src/systems/booking/writer';
import { myShowsOn } from '../../src/systems/shows/tonight';
import { cardEveryShowSystem } from './card-every-show';

export type PlayerCards = 'poor' | 'decent' | 'good';

const SINGLES = parseContentKey('match.singles');

/** The player's cards from the least popular wrestlers on the roster. */
export const poorCardsSystem: SystemBundle = defineSystem({
  id: 'testPoorCards',
  phases: [
    definePhase({
      id: 'testPoorCards.fill',
      group: 'shows',
      order: 4,
      cadence: { kind: 'daily' },
      run: (ctx) => {
        for (const show of myShowsOn(ctx.read, ctx.date)) {
          if (cardSegments(ctx.read, show.id).length > 0) continue;
          const popularity = new Map<string, number>();
          const roster = ctx.read.tables.employments
            .lookup('byPromotionStatus', promotionStatusKey(show.promotionId, 'active'))
            .filter((employment) => employment.role === 'wrestler')
            .map((employment) => {
              const values = Object.values(
                ctx.read.tables.people.require(employment.personId).regionalPop,
              );
              const total = values.reduce((sum, value) => sum + value, 0);
              popularity.set(employment.personId, total / Math.max(1, values.length));
              return employment.personId;
            })
            .sort(
              (left, right) =>
                (popularity.get(left) ?? 0) - (popularity.get(right) ?? 0) ||
                left.localeCompare(right),
            );
          for (let slot = 0; slot < show.format.slots; slot += 1) {
            const left = roster[slot * 2];
            const right = roster[slot * 2 + 1];
            if (left === undefined || right === undefined) break;
            const draft = MatchDraftSchema.parse({
              kind: 'match',
              label: null,
              match: { matchTypeKey: SINGLES },
              participants: [
                { personId: left, side: 0, role: 'competitor', teamId: null },
                { personId: right, side: 1, role: 'competitor', teamId: null },
              ],
              outcome: null,
            });
            writeSegment(ctx.tx, { eventInstanceId: show.id, preShow: false, slot, draft });
          }
        }
      },
    }),
  ],
});

/** The player's cards from Auto-fill, as pressing it on every show would (no planned winners). */
export const autoFillCardsSystem: SystemBundle = defineSystem({
  id: 'testAutoFillCards',
  phases: [
    definePhase({
      id: 'testAutoFillCards.fill',
      group: 'shows',
      order: 4,
      cadence: { kind: 'daily' },
      run: (ctx) => {
        for (const show of myShowsOn(ctx.read, ctx.date)) {
          if (cardSegments(ctx.read, show.id).length > 0) continue;
          const plan = planCard(
            ctx.read,
            { instance: show, today: ctx.date, mode: 'fresh' },
            { tunables: ctx.tunables, rng: ctx.rng(AUTOFILL_STREAM) },
          );
          if (plan.kind === 'cancel') continue;
          for (const placement of plan.placements) {
            const target = { preShow: placement.preShow, slot: placement.slot };
            const draft =
              placement.draft.kind === 'match'
                ? { ...placement.draft, outcome: null }
                : placement.draft;
            if (structuralProblems(ctx.read, { instance: show, draft, target }).length > 0) {
              continue;
            }
            writeSegment(ctx.tx, { eventInstanceId: show.id, ...target, draft });
          }
        }
      },
    }),
  ],
});

/** The test systems that book the player's cards the given way (and card any show left empty). */
export function playerCardsSystems(cards: PlayerCards): SystemBundle[] {
  if (cards === 'poor') return [poorCardsSystem, cardEveryShowSystem];
  if (cards === 'good') return [autoFillCardsSystem, cardEveryShowSystem];
  return [cardEveryShowSystem];
}
