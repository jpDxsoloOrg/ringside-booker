// Ledger categories, signs and player-facing labels (ECO1-01). Design: docs/design/finances.md#categories
import { describe, expect, it } from 'vitest';
import {
  LEDGER_CATEGORIES,
  LEDGER_CATEGORY_SIGN,
  LEDGER_COST_CATEGORIES,
  LEDGER_INCOME_CATEGORIES,
} from '../../../src/model/entities/ledger-entry';
import { LEDGER_CATEGORY_LABELS, ledgerCategoryKind } from '../../../src/systems/finance';

describe('ledger categories', () => {
  it('gives every category a sign and a label, and no label to anything else', () => {
    expect(LEDGER_CATEGORIES).toHaveLength(25);
    for (const category of LEDGER_CATEGORIES) {
      expect([1, -1]).toContain(LEDGER_CATEGORY_SIGN[category]);
      expect(LEDGER_CATEGORY_LABELS[category].trim()).not.toBe('');
    }
    expect(Object.keys(LEDGER_CATEGORY_LABELS).sort()).toEqual([...LEDGER_CATEGORIES].sort());
    const labels = Object.values(LEDGER_CATEGORY_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('has the five categories the economy epic added, with the right signs', () => {
    expect(LEDGER_INCOME_CATEGORIES).toContain('subsidyIncome');
    expect(LEDGER_CATEGORY_SIGN.subsidyIncome).toBe(1);
    for (const category of ['charity', 'networkUpkeep', 'buyout', 'subsidy'] as const) {
      expect(LEDGER_COST_CATEGORIES).toContain(category);
      expect(LEDGER_CATEGORY_SIGN[category]).toBe(-1);
    }
    expect(LEDGER_CATEGORY_LABELS.subsidyIncome).toBe('Subsidies received');
    expect(LEDGER_CATEGORY_LABELS.subsidy).toBe('Subsidies paid');
  });

  it('reads income or cost off the sign', () => {
    for (const category of LEDGER_INCOME_CATEGORIES) {
      expect(ledgerCategoryKind(category)).toBe('income');
    }
    for (const category of LEDGER_COST_CATEGORIES) {
      expect(ledgerCategoryKind(category)).toBe('cost');
    }
  });
});
