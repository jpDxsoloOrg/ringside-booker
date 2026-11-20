/**
 * The draft start's new-game setup step, `draft.setup` (order 660), when "Start with a draft" is
 * on. After the active-promotions step (350) and Equal start (600), before the stored settings
 * (800) and the opening schedule (810). In order:
 *
 * 1. **Candidates and targets.** Every wrestler (and, with "Draft staff too", every staff member)
 *    who can work, with their draft value and card position. The roster target is the setting, or
 *    for Auto `draft.rosterTarget` capped at `wrestlers ÷ (promotions × draft.pool.ratio.auto)`
 *    (never below `draft.rosterTargetMin`). The staff target is `draft.staffTarget` capped at
 *    `staff ÷ promotions`.
 * 2. **Free-agent pool.** Every contract in a drafted role is removed (bookers always stay; staff
 *    stay unless they are drafted).
 * 3. **Pool size and mix** (DRF-07, `pool.ts`): the rest sit out.
 * 4. **Titles vacant, stables disbanded.**
 * 5. **Level playing field**: every active promotion gets the median cash, prestige and home
 *    popularity (`level.ts`), and every TV deal in the world is removed.
 * 6. **Schedule**: each active promotion keeps exactly one weekly show (below).
 * 7. **The draft row**: round one's order and the targets. The draft starts at turn 0.
 *
 * Design: docs/design/draft.md#world-setup.
 */

import { compareDates, isWeekday, weekday, type GameDate, type Weekday } from '../../core/date';
import { InvariantError } from '../../core/errors';
import type { PromotionId } from '../../core/ids';
import type { Draft, DraftSettings } from '../../model/entities/draft';
import {
  EVENT_IMPORTANCES,
  type EventDefinition,
  type Recurrence,
} from '../../model/entities/event-definition';
import { compareIds } from '../../model/table';
import type { GameTables, GameWorldView } from '../../model/tables';
import type { Tx } from '../../model/tx';
import type { DeepReadonly } from '../../model/world';
import { registerSetupStep, type SetupContext } from '../newgame/steps';
import type { EngineTunables } from '../tunables';
import { geographyOf } from '../world/geography';
import { draftCandidates, DRAFT_STAFF_ROLES, type DraftCandidate } from './candidates';
import { levelledFields, medianLevel } from './level';
import { seededOrder } from './order';
import { choosePool, poolSizeFor, type PoolChoice } from './pool';
import { draftOptionsFrom, type DraftOptions } from './settings';
import {
  disbandStables,
  isLiveEmployment,
  removeEmployments,
  retireDefinitionBefore,
  vacateTitles,
} from './worldReset';

export const DRAFT_SETUP_STEP = { id: 'draft.setup', order: 660 } as const;

/** The roles whose contracts a draft removes. */
export function draftedRoles(draftStaff: boolean): ReadonlySet<string> {
  return new Set<string>(draftStaff ? ['wrestler', ...DRAFT_STAFF_ROLES] : ['wrestler']);
}

/** The roster target for a setting and a world. */
export function rosterTargetFor(
  options: Pick<DraftOptions, 'rosterSize'>,
  wrestlers: number,
  promotions: number,
  tunables: EngineTunables,
): number {
  if (options.rosterSize !== 'auto') {
    return Number(options.rosterSize);
  }
  const ratio = tunables.get('draft.pool.ratio.auto');
  const perPromotion = Math.floor(wrestlers / Math.max(1, promotions * ratio));
  return Math.max(
    tunables.get('draft.rosterTargetMin'),
    Math.min(tunables.get('draft.rosterTarget'), perPromotion),
  );
}

/** The staff target: `draft.staffTarget`, capped at the staff there are per promotion. */
export function staffTargetFor(
  draftStaff: boolean,
  staff: number,
  promotions: number,
  tunables: EngineTunables,
): number {
  if (!draftStaff) {
    return 0;
  }
  return Math.min(tunables.get('draft.staffTarget'), Math.floor(staff / Math.max(1, promotions)));
}

/** Everything the draft's targets and pool come from, worked out before any contract goes. */
export interface DraftPlan {
  readonly settings: DraftSettings;
  readonly wrestlers: DraftCandidate[];
  readonly staff: DraftCandidate[];
  readonly pool: PoolChoice;
}

/**
 * The targets and pool for these candidates. Shared by the setup step and the wizard's preview,
 * so the preview shows exactly what a new game will do.
 */
export function planDraft(
  options: DraftOptions,
  candidates: readonly DraftCandidate[],
  promotions: number,
  tunables: EngineTunables,
): DraftPlan {
  const wrestlers = candidates.filter((candidate) => candidate.category === 'wrestler');
  const staff = candidates.filter((candidate) => candidate.category === 'staff');
  const rosterTarget = rosterTargetFor(options, wrestlers.length, promotions, tunables);
  const staffTarget = staffTargetFor(options.draftStaff, staff.length, promotions, tunables);
  const size = poolSizeFor(options.poolSize, promotions, rosterTarget, tunables);
  return {
    settings: {
      order: options.order,
      rosterTarget,
      staffTarget,
      draftStaff: options.draftStaff,
      negotiateAfter: options.negotiateAfter,
      schedule: options.schedule,
    },
    wrestlers,
    staff,
    pool: choosePool(wrestlers, size, tunables),
  };
}

const IMPORTANCE_RANK = new Map<string, number>(
  EVENT_IMPORTANCES.map((importance, index) => [importance, index]),
);

function recurrenceRank(recurrence: DeepReadonly<Recurrence>): number {
  switch (recurrence.kind) {
    case 'weekly':
      return 3;
    case 'everyNWeeks':
      return 2;
    case 'monthly':
      return 1;
    case 'annual':
    case 'dates':
      return 0;
  }
}

/** The weekday a recurring show runs on, or null for a list of dates. */
function weekdayOf(recurrence: DeepReadonly<Recurrence>): Weekday | null {
  switch (recurrence.kind) {
    case 'weekly':
      return recurrence.weekdays[0] ?? null;
    case 'everyNWeeks':
    case 'monthly':
    case 'annual':
      return recurrence.weekday;
    case 'dates':
      return recurrence.dates[0] === undefined ? null : weekday(recurrence.dates[0]);
  }
}

/** `draft.weeklyShowDay` as a weekday (Monday if the tunable is somehow out of range). */
function defaultShowDay(tunables: EngineTunables): Weekday {
  const day = tunables.get('draft.weeklyShowDay');
  return isWeekday(day) ? day : 0;
}

/** A promotion's main recurring show: weekly first, then the most important, televised, oldest. */
export function mainShowOf(
  definitions: readonly DeepReadonly<EventDefinition>[],
): DeepReadonly<EventDefinition> | null {
  const recurring = definitions.filter((definition) => definition.recurrence.kind !== 'dates');
  const sorted = [...recurring].sort(
    (left, right) =>
      recurrenceRank(right.recurrence) - recurrenceRank(left.recurrence) ||
      (IMPORTANCE_RANK.get(right.importance) ?? 0) - (IMPORTANCE_RANK.get(left.importance) ?? 0) ||
      Number(right.televised) - Number(left.televised) ||
      compareIds(left.id, right.id),
  );
  return sorted[0] ?? null;
}

function runsOnOrAfter(definition: DeepReadonly<EventDefinition>, date: GameDate): boolean {
  return definition.activeUntil === null || compareDates(definition.activeUntil, date) >= 0;
}

/**
 * One weekly show per promotion: its main recurring show, made weekly on one weekday, or a new
 * "<SHORT> Weekly" on `draft.weeklyShowDay` when it has none. Every other show is retired before
 * the first day. Both schedule settings start this way; under Open the schedule editor may add more.
 */
export function oneWeeklyShow(
  tx: Tx<GameTables>,
  promotionId: PromotionId,
  date: GameDate,
  tunables: EngineTunables,
): void {
  const read = tx.view;
  const promotion = read.tables.promotions.require(promotionId);
  const definitions = read.tables.eventDefinitions
    .values()
    .filter(
      (definition) => definition.promotionId === promotionId && runsOnOrAfter(definition, date),
    );
  const main = mainShowOf(definitions);
  for (const definition of definitions) {
    if (definition.id !== main?.id) {
      retireDefinitionBefore(tx, definition.id, date);
    }
  }
  if (main === null) {
    tx.create('eventDefinitions', {
      promotionId,
      brandId: null,
      name: `${promotion.shortName} Weekly`,
      importance: 'regular',
      recurrence: { kind: 'weekly', weekdays: [defaultShowDay(tunables)] },
      format: {
        slots: tunables.get('calendar.format.regular.slots'),
        preShowSlots: tunables.get('calendar.format.regular.preShowSlots'),
      },
      televised: false,
      preferredRegionId: promotion.homeRegionId,
      preferredVenueId: null,
      activeFrom: date,
      activeUntil: null,
      logoRef: null,
    });
    return;
  }
  const day = weekdayOf(main.recurrence) ?? defaultShowDay(tunables);
  const alreadyWeekly = main.recurrence.kind === 'weekly' && main.recurrence.weekdays.length === 1;
  if (!alreadyWeekly) {
    tx.update('eventDefinitions', main.id, { recurrence: { kind: 'weekly', weekdays: [day] } });
  }
  if (compareDates(main.activeFrom, date) > 0) {
    tx.update('eventDefinitions', main.id, { activeFrom: date });
  }
}

/** Active promotions, by id. */
export function activePromotionsOf(read: GameWorldView): PromotionId[] {
  return read.tables.promotions
    .values()
    .filter((promotion) => promotion.status === 'active')
    .map((promotion) => promotion.id)
    .sort(compareIds);
}

function wrestlerCounts(read: GameWorldView): Map<PromotionId, number> {
  const counts = new Map<PromotionId, number>();
  for (const employment of read.tables.employments.values()) {
    if (employment.status === 'active' && employment.role === 'wrestler') {
      counts.set(employment.promotionId, (counts.get(employment.promotionId) ?? 0) + 1);
    }
  }
  return counts;
}

/** Round one's order: seeded random, or smallest promotion first for By size. */
export function firstRoundOrder(
  read: GameWorldView,
  settings: Pick<DraftSettings, 'order'>,
  promotionIds: readonly PromotionId[],
  sizes: ReadonlyMap<PromotionId, number>,
): PromotionId[] {
  if (settings.order === 'bySize') {
    return [...promotionIds].sort(
      (left, right) =>
        (sizes.get(left) ?? 0) - (sizes.get(right) ?? 0) ||
        read.tables.promotions.require(left).prestige -
          read.tables.promotions.require(right).prestige ||
        compareIds(left, right),
    );
  }
  return seededOrder(read.meta.seed, 'start-round-0', promotionIds);
}

/** Runs the whole draft-start setup on `tx`. Returns the new draft row. */
export function setUpDraftStart(
  tx: Tx<GameTables>,
  options: DraftOptions,
  date: GameDate,
  tunables: EngineTunables,
): DeepReadonly<Draft> {
  const read = tx.view;
  const active = activePromotionsOf(read);
  if (active.length === 0) {
    throw new InvariantError('A draft needs at least one active promotion');
  }
  const activeSet = new Set(active);
  const sizes = wrestlerCounts(read);
  const candidates = draftCandidates(read, tunables, {
    date,
    draftStaff: options.draftStaff,
    onlyUnsigned: false,
  });

  // 2. The free-agent pool: every contract in a drafted role goes.
  const roles = draftedRoles(options.draftStaff);
  const released = read.tables.employments
    .values()
    .filter((employment) => isLiveEmployment(employment) && roles.has(employment.role));
  removeEmployments(tx, released);
  const free = candidates.filter(
    (candidate) =>
      !read.tables.employments
        .lookup('byPerson', candidate.personId)
        .some((employment) => isLiveEmployment(employment)),
  );

  // 1 and 3. Targets, pool size and mix.
  const plan = planDraft(options, free, active.length, tunables);

  // 4. Titles vacant, stables disbanded.
  vacateTitles(tx, activeSet, date);
  disbandStables(tx, activeSet, date);

  // 5. The level playing field: medians of the active promotions, no TV deals anywhere.
  const geography = geographyOf(read);
  const level = medianLevel(
    active.map((id) => read.tables.promotions.require(id)),
    geography,
  );
  for (const promotionId of active) {
    const promotion = read.tables.promotions.require(promotionId);
    tx.update('promotions', promotionId, levelledFields(promotion, level, geography));
  }
  for (const dealId of [...read.tables.deals.ids()]) {
    tx.delete('deals', dealId);
  }

  // 6. One weekly show each.
  for (const promotionId of active) {
    oneWeeklyShow(tx, promotionId, date, tunables);
  }

  // 7. The draft.
  return tx.create('drafts', {
    kind: 'start',
    status: 'running',
    createdOn: date,
    finishedOn: null,
    settings: plan.settings,
    order: firstRoundOrder(read, plan.settings, active, sizes),
    turn: 0,
    picks: 0,
    poolLeft: { wrestlers: plan.pool.pool.length, staff: plan.staff.length },
    level,
    sitOut: plan.pool.sitOut.map((candidate) => candidate.personId).sort(compareIds),
    poolMix: plan.pool.mix.map((entry) => ({
      level: entry.level,
      inPool: entry.inPool,
      available: entry.available,
      female: entry.female,
      male: entry.male,
      other: entry.other,
    })),
  });
}

function runDraftSetup(tx: Tx<GameTables>, ctx: SetupContext): void {
  const options = draftOptionsFrom(ctx.settings);
  const draft = setUpDraftStart(tx, options, ctx.startDate, ctx.session.tunables);
  ctx.log(
    `Draft ${draft.id}: ${String(draft.order.length)} promotions, ${String(draft.settings.rosterTarget)} wrestlers and ${String(draft.settings.staffTarget)} staff each, ${String(draft.sitOut.length)} sitting out`,
  );
}

registerSetupStep({
  ...DRAFT_SETUP_STEP,
  when: (settings) => settings['draftStart'] === true,
  run: runDraftSetup,
});
