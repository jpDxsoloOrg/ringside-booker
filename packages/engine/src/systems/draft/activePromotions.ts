/**
 * Active promotions (DRF-06): the new-game choice of which promotions run, for every game, with or
 * without a draft.
 *
 * `NewGameInput.activePromotionKeys` lists the pack keys of the promotions that stay active; left
 * out, every promotion stays. Your own promotion (chosen or founded) is always active. Step
 * `wld.activePromotions` (order 350, after the controllers) closes every other active promotion
 * (`closePromotionAtStart`): status `closed`, every contract removed so its people are free agents
 * (or, in a draft game, candidates for the draft pool), every title retired, every show retired,
 * every deal and stable gone. A closed promotion runs no shows, signs nobody and books nothing:
 * the calendar, rival desk, finances and contracts already skip closed promotions.
 *
 * Design: docs/design/draft.md#active-promotions.
 */

import type { PromotionId } from '../../core/ids';
import type { GameTables } from '../../model/tables';
import type { Tx } from '../../model/tx';
import { contentIdOf } from '../newgame/contentKeys';
import { registerSetupStep, type SetupContext } from '../newgame/steps';
import { closePromotionAtStart } from './worldReset';

export const ACTIVE_PROMOTIONS_STEP = { id: 'wld.activePromotions', order: 350 } as const;

/** Closes every active promotion not in `keep` (and not run by a human). Returns how many. */
export function closeInactivePromotions(
  tx: Tx<GameTables>,
  keep: ReadonlySet<PromotionId>,
  date: SetupContext['startDate'],
): { closed: number; employments: number } {
  let closed = 0;
  let employments = 0;
  for (const promotion of [...tx.view.tables.promotions.values()]) {
    if (
      promotion.status !== 'active' ||
      keep.has(promotion.id) ||
      promotion.controller.kind === 'human'
    ) {
      continue;
    }
    employments += closePromotionAtStart(tx, promotion.id, date).employments;
    closed += 1;
  }
  return { closed, employments };
}

function runActivePromotions(tx: Tx<GameTables>, ctx: SetupContext): void {
  const keep = new Set<PromotionId>();
  for (const key of ctx.input.activePromotionKeys ?? []) {
    const id = contentIdOf(tx.view.meta, 'promotion', key);
    if (id !== null) {
      keep.add(id);
    }
  }
  if (ctx.session.humanPromotionId !== null) {
    keep.add(ctx.session.humanPromotionId);
  }
  const result = closeInactivePromotions(tx, keep, ctx.startDate);
  ctx.log(
    `Closed ${String(result.closed)} inactive promotion(s); ${String(result.employments)} contract(s) ended`,
  );
}

registerSetupStep({
  ...ACTIVE_PROMOTIONS_STEP,
  when: (_settings, input) => input.activePromotionKeys !== undefined,
  run: runActivePromotions,
});
