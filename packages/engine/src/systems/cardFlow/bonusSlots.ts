/**
 * Giving shows their bonus slot (EVT4-02).
 *
 * - `cardFlow.bonusSlot`, a scheduled-format adjuster: a newly scheduled show gets its definition's
 *   main slots, plus one when {@link bonusSlotFor} says so. The pre-show is never touched.
 * - `cardFlow.refreshBonusSlots`, a daily housekeeping phase: an unbooked future show (scheduled,
 *   from a definition, no segment yet) gains or loses the slot when its promotion's production
 *   changed, so an upgrade reaches the next shows the next day instead of after the 90-day
 *   horizon. A card the booker has started is never touched.
 *
 * Design: docs/design/card-flow.md#bonus-slot.
 */

import { compareDates } from '../../core/date';
import type { EventInstanceId, PromotionId } from '../../core/ids';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import type { TraceValue, Traced } from '../../core/trace';
import { registerScheduledFormatAdjuster } from '../calendar/formatAdjusters';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import { bonusSlotFor, importanceAtLeast, qualifiesForBonusSlot } from './formulas/bonusSlot';
import { ceilingLevelsOf, productionCeilingValue } from './formulas/productionCeiling';
import { BONUS_SLOT_TRACE_KIND, bonusSlotTraceRef } from './traces';

export const BONUS_SLOT_ADJUSTER_ID = 'cardFlow.bonusSlot';

/**
 * The scheduled-format adjuster. The decision's trace is handed back (and recorded under the new
 * show's id) only for a show big enough to be considered: a house or minor show's "no" says
 * nothing and would only crowd the trace store.
 */
export const unregisterBonusSlotAdjuster = registerScheduledFormatAdjuster({
  id: BONUS_SLOT_ADJUSTER_ID,
  order: 10,
  adjust: (read, input, tunables) => {
    const { slots, decision } = bonusSlotFor(
      read,
      {
        promotionId: input.promotionId,
        importance: input.definition.importance,
        baseSlots: input.format.slots,
      },
      tunables,
    );
    const format = { slots, preShowSlots: input.format.preShowSlots };
    const considered = importanceAtLeast(
      input.definition.importance,
      tunables.get('production.bonusSlotMinImportance'),
    );
    if (!considered) {
      return { format };
    }
    const traced: Traced<TraceValue> = decision;
    return { format, trace: { kind: BONUS_SLOT_TRACE_KIND, traced } };
  },
});

/** One promotion's ceiling, worked out once per run of the phase. */
function cachedCeiling(
  read: GameWorldView,
  cache: Map<PromotionId, number>,
  promotionId: PromotionId,
  tunables: EngineTunables,
): number {
  let ceiling = cache.get(promotionId);
  if (ceiling === undefined) {
    ceiling = productionCeilingValue(ceilingLevelsOf(read, promotionId), tunables);
    cache.set(promotionId, ceiling);
  }
  return ceiling;
}

/**
 * Daily, `housekeeping` order 26 (after `calendar.extendHorizon` at 20 and
 * `shows.resetAppearances` at 22). Cheap on an unchanged world: one ceiling per promotion, one
 * definition read per scheduled show, and a trace only for a show whose slot count changes.
 */
export const refreshBonusSlotsPhase: PhaseDefinition = definePhase({
  id: 'cardFlow.refreshBonusSlots',
  group: 'housekeeping',
  order: 26,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    const ceilings = new Map<PromotionId, number>();
    const changed: EventInstanceId[] = [];
    for (const show of ctx.read.tables.eventInstances.lookup('byStatus', 'scheduled')) {
      if (show.eventDefinitionId === null || compareDates(show.date, ctx.date) <= 0) {
        continue;
      }
      const definition = ctx.read.tables.eventDefinitions.get(show.eventDefinitionId);
      if (definition === undefined) {
        continue;
      }
      const baseSlots = definition.format.slots;
      if (show.format.slots !== baseSlots && show.format.slots !== baseSlots + 1) {
        // Not a count this rule gave it; leave it to whoever set it.
        continue;
      }
      const ceiling = cachedCeiling(ctx.read, ceilings, show.promotionId, ctx.tunables);
      const wanted = qualifiesForBonusSlot(ceiling, show.importance, baseSlots, ctx.tunables)
        ? baseSlots + 1
        : baseSlots;
      if (wanted === show.format.slots) {
        continue;
      }
      if (ctx.read.tables.segments.lookup('byEventInstance', show.id).length > 0) {
        continue;
      }
      const { slots, decision } = bonusSlotFor(
        ctx.read,
        { promotionId: show.promotionId, importance: show.importance, baseSlots },
        ctx.tunables,
      );
      ctx.tx.update('eventInstances', show.id, {
        format: { slots, preShowSlots: show.format.preShowSlots },
      });
      ctx.recordTrace(bonusSlotTraceRef(show.id), ctx.date, decision);
      changed.push(show.id);
    }
    if (changed.length > 0) {
      ctx.log(
        `Changed the main slots of ${String(changed.length)} unbooked show(s) for production`,
      );
    }
  },
});
