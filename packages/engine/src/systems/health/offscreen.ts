/**
 * Off-screen injuries (WRK6-04): every day, every eligible wrestler in the world, on any roster or
 * none, has a small chance of getting hurt away from the shows (training, travel, a house-show
 * bump nobody books). This is how rival wrestlers still get hurt while the rival rule skips their
 * in-match injuries (D-01), and how the world keeps moving before any show runs.
 *
 * Design: docs/design/health.md#off-screen-injuries.
 */

import { isAfter, type GameDate } from '../../core/date';
import { fastPathsEnabled } from '../../core/fastPaths';
import type { BrandId, PersonId, PromotionId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import { chance } from '../../core/rng/odds';
import type { Traced } from '../../core/trace/types';
import { hasCatalog, injuryCatalogOf } from '../../model/catalogs';
import { WRESTLING_ROLES, type Person } from '../../model/entities/person';
import type { DeepReadonly } from '../../model/world';
import { worstBodyPart } from '../match/formulas/injuryChance';
import { primaryEmploymentOf } from '../workers/helpers/employment';
import {
  computeOffscreenInjuryChance,
  offscreenInjuryChanceValue,
  type OffscreenInjuryChanceInputs,
} from './formulas/offscreenInjuryChance';
import { injure } from './injure';
import { offscreenShortcutOf } from './rivalShortcut';
import { OFFSCREEN_STREAM } from './streams';

export const OFFSCREEN_INJURIES_PHASE_ID = 'health.offscreenInjuries';

const WRESTLING: ReadonlySet<string> = new Set(WRESTLING_ROLES);

/**
 * Whether a person rolls for an off-screen injury on `date`: active, a wrestler or occasional
 * wrestler, debuted on or before the date, and not already hurt.
 */
export function isOffscreenEligible(person: DeepReadonly<Person>, date: GameDate): boolean {
  return (
    person.status === 'active' &&
    person.roles.some((role) => WRESTLING.has(role)) &&
    person.debutDate !== null &&
    !isAfter(person.debutDate, date) &&
    person.injury === null
  );
}

/** The rival rule and employer name for one employer, worked out once a day per employer. */
interface EmployerRule {
  readonly shortcut: Traced<boolean> | null;
  readonly promotionName: string | null;
}

const FREE_AGENT: EmployerRule = { shortcut: null, promotionName: null };

function employerRuleOf(
  ctx: PhaseContext,
  cache: Map<string, EmployerRule>,
  personId: PersonId,
): EmployerRule {
  const employment = primaryEmploymentOf(ctx.read, personId, ctx.date);
  if (employment === null) {
    return FREE_AGENT;
  }
  const promotionId: PromotionId = employment.promotionId;
  const brandId: BrandId | null = employment.brandId;
  const key = `${promotionId}:${brandId ?? ''}`;
  let rule = cache.get(key);
  if (rule === undefined) {
    rule = {
      shortcut: offscreenShortcutOf(ctx.read, ctx.tunables, promotionId, brandId),
      promotionName: ctx.read.tables.promotions.get(promotionId)?.name ?? null,
    };
    cache.set(key, rule);
  }
  return rule;
}

function chanceInputsOf(
  person: DeepReadonly<Person>,
  rule: EmployerRule,
): OffscreenInjuryChanceInputs {
  const worst = worstBodyPart(person.condition);
  return {
    fatigue: person.fatigue,
    worstCondition: worst.value,
    worstPart: worst.part,
    traits: person.traits,
    computerShortcut: rule.shortcut,
    promotionName: rule.promotionName,
  };
}

/**
 * Rolls today's off-screen injuries and returns the ids of the people hurt. Eligible people are
 * visited in ascending id order and each draws exactly once from `health.offscreen`, whatever the
 * tunables say, so tuning never shifts the stream. A hit goes through `health.injure` (its own
 * stream) inside a savepoint of its own, so one bad catalog entry cannot undo the day's other
 * injuries. A world with no injury catalog logs once and rolls nothing.
 *
 * With the fast paths on, the chance is worked out without its trace and the Why? is built only
 * for the people who get hurt; the number is the same either way.
 */
export function rollOffscreenInjuries(ctx: PhaseContext): PersonId[] {
  if (!hasCatalog(ctx.read, 'injuries') || injuryCatalogOf(ctx.read).length === 0) {
    ctx.log('health.offscreenInjuries: this world has no injury catalog, so nobody was rolled');
    return [];
  }
  const fast = fastPathsEnabled();
  const stream = ctx.rng(OFFSCREEN_STREAM);
  const rules = new Map<string, EmployerRule>();
  const hurt: PersonId[] = [];
  const candidates = ctx.read.tables.people
    .lookup('byStatus', 'active')
    .filter((person) => isOffscreenEligible(person, ctx.date));
  for (const person of candidates) {
    const inputs = chanceInputsOf(person, employerRuleOf(ctx, rules, person.id));
    const traced = fast ? null : computeOffscreenInjuryChance(inputs, { tunables: ctx.tunables });
    const probability = traced?.value ?? offscreenInjuryChanceValue(inputs, { tunables: ctx.tunables });
    if (!chance(stream, probability)) {
      continue;
    }
    const chanceTrace = traced ?? computeOffscreenInjuryChance(inputs, { tunables: ctx.tunables });
    const result = ctx.tx.savepoint(`offscreen ${person.id}`, (tx) => {
      const pending: (() => void)[] = [];
      const scoped: PhaseContext = {
        ...ctx,
        tx,
        read: tx.view,
        publish: (type, payload) => {
          pending.push(() => {
            ctx.publish(type, payload);
          });
        },
        recordTrace: (ref, date, value, options) => {
          pending.push(() => {
            ctx.recordTrace(ref, date, value, options);
          });
        },
      };
      return { injured: injure(scoped, person.id, { source: 'world', chanceTrace }), pending };
    });
    if (!result.ok) {
      ctx.log(`health.offscreenInjuries: hurting ${person.id} failed and was undone: ${result.error.message}`);
      continue;
    }
    for (const deliver of result.value.pending) {
      deliver();
    }
    if (result.value.injured.ok) {
      hurt.push(person.id);
    }
  }
  return hurt;
}

/** Daily, first in `worldEvents`: the off-screen injury rolls. */
export const offscreenInjuriesPhase: PhaseDefinition = definePhase({
  id: OFFSCREEN_INJURIES_PHASE_ID,
  group: 'worldEvents',
  order: 10,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    rollOffscreenInjuries(ctx);
  },
});
