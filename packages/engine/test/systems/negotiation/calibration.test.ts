// Asking terms on the default world (ECO5-02). Design: docs/design/negotiation.md#calibration
//
// A balance check, not an exact one: it protects the order of magnitude of the asks against the
// default world's placeholder wages (docs/design/default-world.md#contracts). When the owner finds
// asks too high or too low, change the tunables, not the formulas. Slow (a new default-world
// game), so it runs with RB_SLOW_TESTS=1; it prints the medians by push.
import { describe, expect, it } from 'vitest';
import type { PromotionId } from '../../../src/core/ids';
import type { Traced } from '../../../src/core/trace/types';
import type { Employment } from '../../../src/model/entities/employment';
import {
  askingTermsFor,
  CURRENT_DEAL_FLOOR_LABEL,
  CURRENT_FEE_FLOOR_LABEL,
} from '../../../src/systems/negotiation';
import { SLOW_TESTS } from '../../support/slow';
import { defaultWorld, type DefaultWorld } from './default-world';

const PUSHES = ['mainEvent', 'upperCard', 'midCard', 'lowerCard', 'enhancement'] as const;

/** The ask before the current-deal floor: what the market says, not what they already earn. */
function beforeFloor(asked: Traced<number>): number {
  const floor = asked.trace.children?.find(
    (node) =>
      node.kind === 'max' &&
      (node.label === CURRENT_DEAL_FLOOR_LABEL || node.label === CURRENT_FEE_FLOOR_LABEL),
  );
  return floor?.kind === 'max' ? floor.before : asked.value;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

interface Pair {
  readonly employment: Employment;
  /** What they earn now: the monthly wage, or the fee on a per-appearance deal. */
  readonly pay: number;
  /** What they ask the same promotion for the same kind of deal, before the current-deal floor. */
  readonly ask: number;
}

function pairsOf(setup: DefaultWorld, promotionId: PromotionId): Pair[] {
  const { world, tunables } = setup;
  return world.tables.employments
    .lookup('byPromotion', promotionId)
    .filter((employment) => employment.status === 'active' && employment.role === 'wrestler')
    .map((employment) => {
      const terms = askingTermsFor(world, tunables, {
        personId: employment.personId,
        promotionId,
        date: world.meta.currentDate,
        kind: employment.terms.kind,
        exclusive: employment.terms.exclusive,
      });
      const perAppearance = employment.terms.kind === 'perAppearance';
      return {
        employment,
        pay: perAppearance ? employment.terms.perAppearanceFee : employment.terms.monthlyWage,
        ask: beforeFloor(perAppearance ? terms.perAppearanceFee : terms.monthlyWage),
      };
    });
}

function medianLine(pairs: readonly Pair[], push: (typeof PUSHES)[number]): string | null {
  const group = pairs.filter((pair) => pair.employment.push === push);
  if (group.length === 0) {
    return null;
  }
  const pay = median(group.map((pair) => pair.pay));
  const ask = median(group.map((pair) => pair.ask));
  return `${push} ${dollars(pay)} → ${dollars(ask)} (×${(ask / pay).toFixed(2)}, ${String(group.length)})`;
}

describe.runIf(SLOW_TESTS)('asking terms on the default world', () => {
  // Built once, on first use: a skipped block still runs this body to collect its tests.
  let built: DefaultWorld | undefined;
  const game = (): DefaultWorld => (built ??= defaultWorld());

  it("keeps Altura's main eventers within half to double their wage", () => {
    const setup = game();
    const pairs = pairsOf(setup, setup.promotion('pro-flagship'));
    const lines = PUSHES.map((push) => medianLine(pairs, push)).filter((line) => line !== null);
    console.log(`Altura medians by push, wage → ask:\n${lines.join('\n')}`);

    const mainEvent = pairs.filter((pair) => pair.employment.push === 'mainEvent');
    expect(mainEvent.length).toBeGreaterThan(0);
    const ratio =
      median(mainEvent.map((pair) => pair.ask)) / median(mainEvent.map((pair) => pair.pay));
    expect(ratio).toBeGreaterThanOrEqual(0.5);
    expect(ratio).toBeLessThanOrEqual(2);
  });

  it('keeps every Altura wrestler below the wrestler cap', () => {
    const setup = game();
    const cap = setup.tunables.get('contracts.ask.cap.wrestler');
    for (const pair of pairsOf(setup, setup.promotion('pro-flagship'))) {
      expect(pair.ask).toBeLessThan(cap);
    }
  });

  it('lets Hardpan offer only per-appearance deals, and Altura written and exclusive ones', () => {
    const { world, tunables, promotion } = game();
    const altura = promotion('pro-flagship');
    const hardpan = promotion('pro-us-texas-indie');
    const date = world.meta.currentDate;
    const worker = world.tables.employments
      .lookup('byPromotion', hardpan)
      .find((employment) => employment.status === 'active');
    if (worker === undefined) {
      throw new Error('Hardpan has no workers');
    }
    const allowed = (promotionId: PromotionId) => {
      const terms = askingTermsFor(world, tunables, {
        personId: worker.personId,
        promotionId,
        date,
      });
      return {
        kinds: terms.allowedKinds.filter((entry) => entry.allowed).map((entry) => entry.kind),
        exclusive: terms.exclusiveAllowed,
      };
    };
    expect(allowed(hardpan)).toEqual({ kinds: ['perAppearance'], exclusive: false });
    expect(allowed(altura)).toEqual({ kinds: ['written', 'perAppearance'], exclusive: true });
  });

  it("prints every promotion's medians, for balance", () => {
    const setup = game();
    const { world } = setup;
    const lines = world.tables.promotions.values().map((promotion) => {
      const pairs = pairsOf(setup, promotion.id);
      const cells = PUSHES.map((push) => medianLine(pairs, push)).filter((line) => line !== null);
      return `${promotion.name}: ${cells.join(' | ')}`;
    });
    console.log(lines.join('\n'));
    expect(lines).toHaveLength(world.tables.promotions.values().length);
  });
});
