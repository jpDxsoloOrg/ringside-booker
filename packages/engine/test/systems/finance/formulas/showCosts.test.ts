// Show costs (ECO1-04). Design: docs/design/finances.md#show-costs
import { describe, expect, it } from 'vitest';
import { cents } from '../../../../src/core/money';
import { walkTrace } from '../../../../src/core/trace';
import type { TraceNode } from '../../../../src/core/trace/types';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import { EVENT_IMPORTANCES } from '../../../../src/model/entities/event-definition';
import {
  ESTIMATED_CARD_NOTE,
  SHOW_COST_TRACE_LINES_MAX,
  showCosts,
  type ShowCostsInputs,
  type ShowCostWorker,
} from '../../../../src/systems/finance';
import { EVENT_IMPORTANCE_LABELS } from '../../../../src/systems/match/formulas/crowdExpectation';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

function worker(name: string, overrides: Partial<ShowCostWorker> = {}): ShowCostWorker {
  return {
    name,
    perAppearanceFee: cents(0),
    travelCovered: false,
    excluded: null,
    ...overrides,
  };
}

function costs(inputs: Partial<ShowCostsInputs> = {}, overrides: TunableOverrides = {}) {
  return showCosts(
    {
      workers: [],
      estimated: false,
      importance: 'regular',
      importanceLabel: 'Regular',
      distance: 'home',
      travelLevel: 1,
      cateringLevel: 1,
      ...inputs,
    },
    { tunables: createEngineTunables(overrides) },
  );
}

function labelsOf(trace: TraceNode): string[] {
  const labels: string[] = [];
  walkTrace(trace, (node) => {
    labels.push(node.label);
  });
  return labels;
}

function expectSound(result: ReturnType<typeof costs>): void {
  for (const cost of [result.appearanceFees, result.travel, result.catering]) {
    expect(Number.isInteger(cost.value)).toBe(true);
    expectTraceReplays(cost);
    expectSerialisable(cost.trace);
  }
}

describe('showCosts', () => {
  it('charges nothing but catering for a show with no workers', () => {
    const result = costs();
    expect(result.appearanceFees.value).toBe(0);
    expect(result.travel.value).toBe(0);
    // Basic catering at a regular show: $250.
    expect(result.catering.value).toBe(25_000);
    expect(labelsOf(result.appearanceFees.trace)).toContain(
      'Nobody on the card is paid per appearance',
    );
    expect(labelsOf(result.travel.trace)).toContain('Nobody on the card is paid travel');
    expectSound(result);
  });

  it('adds up per-appearance fees and travel per paid worker', () => {
    const result = costs({
      workers: [
        worker('Alpha', { perAppearanceFee: cents(30_000) }),
        worker('Bravo', { perAppearanceFee: cents(12_345) }),
        worker('Charlie'),
      ],
    });
    expect(result.appearanceFees.value).toBe(42_345);
    // Three workers at Basic travel ($50 each).
    expect(result.travel.value).toBe(15_000);
    const feeLabels = labelsOf(result.appearanceFees.trace);
    expect(feeLabels).toContain('Alpha');
    expect(feeLabels).toContain('Bravo');
    expect(feeLabels).not.toContain('Charlie');
    expect(labelsOf(result.travel.trace)).toEqual(
      expect.arrayContaining(['Alpha', 'Bravo', 'Charlie', 'Basic travel per worker']),
    );
    expectSound(result);
  });

  it('leaves out guests and the owner or booker, and says so', () => {
    const result = costs({
      workers: [
        worker('Paid', { perAppearanceFee: cents(10_000) }),
        worker('Guest', { perAppearanceFee: cents(99_999), excluded: 'guest' }),
        worker('Owner', { perAppearanceFee: cents(99_999), excluded: 'ownerOrBooker' }),
      ],
    });
    expect(result.appearanceFees.value).toBe(10_000);
    expect(result.travel.value).toBe(5_000);
    const labels = labelsOf(result.travel.trace);
    expect(labels).toContain('1 guest has no contract here: nothing to pay');
    expect(labels).toContain('1 worker runs the promotion (owner or booker): not charged');
    expect(labels).not.toContain('Guest');
    expect(labels).not.toContain('Owner');
    expectSound(result);
  });

  it('pays travel at the covered level for a contract with the travel perk, even at level 0', () => {
    const result = costs({
      travelLevel: 0,
      workers: [worker('Perk', { travelCovered: true }), worker('Plain')],
    });
    // Premium travel ($500) for the perk; the other worker pays their own way.
    expect(result.travel.value).toBe(50_000);
    const labels = labelsOf(result.travel.trace);
    expect(labels).toContain('Perk: travel covered by contract');
    expect(labels).toContain('Premium travel per worker');
    expect(labels).toContain('1 worker pays their own way: None travel');
    expectSound(result);
    // With the covered level tuned down to Basic, the perk pays Basic.
    expect(
      costs(
        { travelLevel: 0, workers: [worker('Perk', { travelCovered: true })] },
        { 'finance.travel.coveredLevel': 1 },
      ).travel.value,
    ).toBe(5_000);
    // A level above the covered one is never lowered by the perk.
    expect(
      costs(
        { travelLevel: 2, workers: [worker('Perk', { travelCovered: true })] },
        { 'finance.travel.coveredLevel': 1 },
      ).travel.value,
    ).toBe(20_000);
  });

  it('multiplies travel by distance: home, the home country, another country', () => {
    const workers = [worker('A'), worker('B')];
    expect(costs({ workers, distance: 'home' }).travel.value).toBe(10_000);
    expect(costs({ workers, distance: 'domestic' }).travel.value).toBe(15_000);
    expect(costs({ workers, distance: 'abroad' }).travel.value).toBe(30_000);
    expect(labelsOf(costs({ workers, distance: 'home' }).travel.trace)).toContain(
      'Show in the home region: no extra for distance',
    );
    expectSound(costs({ workers, distance: 'abroad' }));
    // Distance never changes catering.
    expect(costs({ workers, distance: 'abroad' }).catering.value).toBe(25_000);
  });

  it('multiplies travel and catering by the importance of the show', () => {
    const expected = { house: 0.5, minor: 0.75, regular: 1, major: 1.5, flagship: 2.5 };
    for (const importance of EVENT_IMPORTANCES) {
      const result = costs({
        importance,
        importanceLabel: EVENT_IMPORTANCE_LABELS[importance],
        workers: [worker('A'), worker('B'), worker('C')],
        travelLevel: 2,
        cateringLevel: 2,
      });
      expect(result.travel.value, importance).toBe(Math.round(60_000 * expected[importance]));
      expect(result.catering.value, importance).toBe(Math.round(80_000 * expected[importance]));
      expectSound(result);
    }
  });

  it('rounds a multiplied cost to the cent', () => {
    const result = costs(
      { workers: [worker('A')], importance: 'minor', importanceLabel: 'Minor' },
      { 'finance.travel.perWorker.level1': 333 },
    );
    // 333 × 0.75 = 249.75, rounded to 250.
    expect(result.travel.value).toBe(250);
    expectSound(result);
  });

  it('costs nothing for travel and catering at level 0', () => {
    const result = costs({
      workers: [worker('A'), worker('B')],
      travelLevel: 0,
      cateringLevel: 0,
      importance: 'flagship',
      importanceLabel: 'Flagship',
    });
    expect(result.travel.value).toBe(0);
    expect(result.catering.value).toBe(0);
    expectSound(result);
  });

  it('notes an estimated card', () => {
    const result = costs({ workers: [worker('A')], estimated: true });
    expect(labelsOf(result.travel.trace)).toContain(ESTIMATED_CARD_NOTE);
    expect(labelsOf(result.appearanceFees.trace)).toContain(ESTIMATED_CARD_NOTE);
    expect(labelsOf(costs({ workers: [worker('A')] }).travel.trace)).not.toContain(
      ESTIMATED_CARD_NOTE,
    );
  });

  it('folds workers past the line limit into one line', () => {
    const count = SHOW_COST_TRACE_LINES_MAX + 5;
    const workers = Array.from({ length: count }, (_, index) =>
      worker(`Worker ${String(index + 1)}`, { perAppearanceFee: cents(1_000) }),
    );
    const result = costs({ workers });
    expect(result.appearanceFees.value).toBe(count * 1_000);
    expect(result.travel.value).toBe(count * 5_000);
    const labels = labelsOf(result.appearanceFees.trace);
    expect(labels).toContain('and 5 more workers');
    expect(labels).not.toContain(`Worker ${String(count)}`);
    expectSound(result);
  });
});
