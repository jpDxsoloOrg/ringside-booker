/**
 * A test-only system that gives every show a card, for balance checks of what real cards do over
 * a long run (MTCH3-05's measurement setup, rebuilt for MTCH3-07).
 *
 * Headless runs have no cards: the player books by hand and the rivals' shows are scored off
 * screen until AIP4. This system's phase runs in the `shows` group just before show night (order
 * 5) and, for every open show today with an empty card, fills each main-card slot with a singles
 * match between two of the promotion's active wrestlers (the show's brand first), with no planned
 * winner, so MTCH2's auto-winner decides. A human-run show is then run by `runMyShowsSystem`
 * (`run-my-shows.ts`), standing in for the player pressing Run the show.
 * Who meets whom is a fixed shuffle of the roster per show, so a run is deterministic.
 */

import { parseContentKey } from '../../src/core/content-key';
import type { PersonId } from '../../src/core/ids';
import { definePhase } from '../../src/core/pipeline/phase';
import { defineSystem, type SystemBundle } from '../../src/core/api/system';
import { promotionStatusKey } from '../../src/model/entities/employment';
import { MatchDraftSchema, writeSegment, type MatchDraft } from '../../src/systems/booking';
import { cardSegments } from '../../src/systems/booking/card';
import { showsToRunToday } from '../../src/systems/shows';

const SINGLES = parseContentKey('match.singles');

function singles(left: PersonId, right: PersonId): MatchDraft {
  return MatchDraftSchema.parse({
    kind: 'match',
    label: null,
    match: { matchTypeKey: SINGLES },
    participants: [
      { personId: left, side: 0, role: 'competitor', teamId: null },
      { personId: right, side: 1, role: 'competitor', teamId: null },
    ],
    outcome: null,
  });
}

/** A small deterministic hash of a text, for the shuffle seed. */
function hashOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
  }
  return hash;
}

/** Fisher–Yates with a xorshift stream seeded from `seed`. */
function shuffled<T>(values: readonly T[], seed: number): T[] {
  const out = [...values];
  let state = seed === 0 ? 1 : seed;
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
  for (let index = out.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(next() * (index + 1));
    const held = out[index];
    const swap = out[pick];
    if (held !== undefined && swap !== undefined) {
      out[index] = swap;
      out[pick] = held;
    }
  }
  return out;
}

export const CARD_EVERY_SHOW_PHASE_ID = 'cardEveryShow.fill';

export const cardEveryShowSystem: SystemBundle = defineSystem({
  id: 'cardEveryShow',
  phases: [
    definePhase({
      id: CARD_EVERY_SHOW_PHASE_ID,
      group: 'shows',
      order: 5,
      cadence: { kind: 'daily' },
      run: (ctx) => {
        for (const show of showsToRunToday(ctx.read)) {
          if (cardSegments(ctx.read, show.id).length > 0) {
            continue;
          }
          const roster = ctx.read.tables.employments
            .lookup('byPromotionStatus', promotionStatusKey(show.promotionId, 'active'))
            .filter((employment) => employment.role === 'wrestler');
          const brand = roster.filter(
            (employment) => show.brandId !== null && employment.brandId === show.brandId,
          );
          const pool = (brand.length >= 2 ? brand : roster).map(
            (employment) => employment.personId,
          );
          const order = shuffled([...pool].sort(), hashOf(show.id));
          for (let slot = 0; slot < show.format.slots; slot += 1) {
            const left = order[slot * 2];
            const right = order[slot * 2 + 1];
            if (left === undefined || right === undefined) {
              break;
            }
            writeSegment(ctx.tx, {
              eventInstanceId: show.id,
              preShow: false,
              slot,
              draft: singles(left, right),
            });
          }
        }
      },
    }),
  ],
});
