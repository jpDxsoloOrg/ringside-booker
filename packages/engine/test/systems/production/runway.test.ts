// The cash runway (ECO7-06): the formula, the recent-money window, the `production.cashRunway`
// query and the change dialog's "Months of cash left" row. Design:
// docs/design/production.md#cash-runway
import { describe, expect, it } from 'vitest';
import type { Viewer } from '../../../src/core/api/controller';
import type { Engine } from '../../../src/core/api';
import { assertSerialisable } from '../../../src/core/api/serialisable';
import { parseGameDate } from '../../../src/core/date';
import type { PromotionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import { inputOf } from '../../../src/core/trace/helpers';
import type { TraceNode } from '../../../src/core/trace/types';
import { cashRunway, recentOtherMoney } from '../../../src/systems/production';
import { OTHER_PLAYER, PLAYER, productionEngine, productionWorld } from './production-world';
import { deps } from './support';

const PLAYER_VIEW: Viewer = { kind: 'controller', controller: PLAYER };
const OTHER_VIEW: Viewer = { kind: 'controller', controller: OTHER_PLAYER };

/** A month is 365 ÷ 12 days. */
function monthOf(amount: number, days: number): number {
  return ((amount / days) * 365) / 12;
}

/** Every label in a trace, depth first. */
function labels(node: TraceNode): string[] {
  return [node.label, ...(node.children ?? []).flatMap((child) => labels(child))];
}

function money(label: string, value: number) {
  return inputOf(label, value, undefined, 'money/month');
}

/** Fixed spend of $1,000 wages, $100 medical, $400 overhead and $560 of shows over 28 days. */
const FIXED = {
  promotionName: 'Hardpan',
  payroll: money('Monthly payroll', 100_000),
  medical: money('Medical', 10_000),
  overhead: money('Overhead', 40_000),
  showProduction: inputOf('Shows', 56_000, undefined, 'money'),
  forecastDays: 28,
};
const FIXED_MONTH = 100_000 + 10_000 + 40_000 + monthOf(56_000, 28);

describe('cashRunway', () => {
  it('prices the fixed spend ahead and waits for show money until enough days are played', () => {
    const runway = cashRunway({ ...FIXED, cash: 1_000_000, recent: null }, deps());
    expect(runway.status).toBe('tooEarly');
    expect(runway.monthsLeft).toBeNull();
    expect(runway.monthlyNet.value).toBe(Math.round(-FIXED_MONTH));
    const text = labels(runway.monthlyNet.trace);
    expect(text).toContain('Ticket sales and other show money count once 7 days have been played');
    expect(text).toContain('Show production a month');
    expect(text.join(' ')).not.toMatch(/undefined|NaN/);
  });

  it('turns recent show money into a month and says it is making money', () => {
    const runway = cashRunway(
      { ...FIXED, cash: 1_000_000, recent: { net: 200_000, days: 14 } },
      deps(),
    );
    expect(runway.monthlyNet.value).toBe(Math.round(monthOf(200_000, 14) - FIXED_MONTH));
    expect(runway.status).toBe('makingMoney');
    expect(runway.monthsLeft).toBeNull();
    expect(labels(runway.monthlyNet.trace)).toContain('Income less other costs, last 14 days');
  });

  it('works out the months of cash left when losing money', () => {
    const recent = { net: -28_000, days: 28 };
    const runway = cashRunway({ ...FIXED, cash: 2_000_000, recent }, deps());
    const loss = Math.round(FIXED_MONTH - monthOf(-28_000, 28));
    expect(runway.monthlyNet.value).toBe(-loss);
    expect(runway.status).toBe('losingMoney');
    expect(runway.monthsLeft?.value).toBeCloseTo(2_000_000 / loss, 9);
    expect(runway.monthsLeft?.trace.label).toBe('Months of cash left');
    expect(labels(runway.monthsLeft?.trace ?? runway.monthlyNet.trace)).toContain('Cash now');
  });

  it('warns below production.runway.warnBelowMonths, and never when it is 0', () => {
    const inputs = { ...FIXED, cash: 300_000, recent: { net: 0, days: 28 } };
    // $3,000 lasts about 1.4 months at about $2,108 a month.
    expect(cashRunway(inputs, deps()).status).toBe('runningOut');
    expect(cashRunway(inputs, deps({ 'production.runway.warnBelowMonths': 1 })).status).toBe(
      'losingMoney',
    );
    expect(cashRunway(inputs, deps({ 'production.runway.warnBelowMonths': 0 })).status).toBe(
      'losingMoney',
    );
  });

  it('says the cash has run out at or below 0, whatever the rate', () => {
    for (const cash of [0, -50_000]) {
      const runway = cashRunway({ ...FIXED, cash, recent: { net: 900_000, days: 7 } }, deps());
      expect(runway.status).toBe('outOfCash');
      expect(runway.monthsLeft).toBeNull();
    }
  });
});

function runwayOf(engine: Engine, promotionId: PromotionId, viewer: Viewer = PLAYER_VIEW) {
  const result = engine.query('production.cashRunway', { promotionId }, viewer);
  if (!result.ok) {
    throw new Error(`production.cashRunway refused: ${JSON.stringify(result.reasons)}`);
  }
  assertSerialisable(result.data, 'cash runway');
  return result.data;
}

const TWO_WEEKS_IN = '2026-01-19';

describe('recentOtherMoney', () => {
  it('adds the window before today, leaving out the categories priced ahead and one-offs', () => {
    const built = productionWorld({
      today: TWO_WEEKS_IN,
      ledger: [
        { date: '2026-01-04', category: 'tickets', amount: 777_700 }, // before the window
        { date: '2026-01-09', category: 'tickets', amount: 1_000_000 },
        { date: '2026-01-09', category: 'venueRent', amount: -200_000 },
        { date: '2026-01-10', category: 'wages', amount: -500_000 },
        { date: '2026-01-10', category: 'production', amount: -2_800_000 },
        { date: '2026-01-11', category: 'signingBonuses', amount: -300_000 },
        { date: '2026-01-19', category: 'tickets', amount: 999_900 }, // today: not counted yet
      ],
    });
    expect(recentOtherMoney(built.world, built.human, parseGameDate(TWO_WEEKS_IN), 14)).toEqual({
      net: 800_000,
      days: 14,
    });
  });
});

describe('production.cashRunway', () => {
  it("prices Hardpan's fixed spend on day one and waits a week for show money", () => {
    const built = productionWorld();
    const data = runwayOf(productionEngine(built.world), built.human);
    // Overhead $4,700 a month; four $710 shows in the next 4 weeks.
    expect(data.spend.overhead).toBe(470_000);
    expect(data.spend.showProduction).toBe(Math.round(monthOf(284_000, 28)));
    expect(data).toMatchObject({
      cash: 10_000_000,
      status: 'tooEarly',
      monthsLeft: null,
      monthsLeftTrace: null,
      warnBelowMonths: 6,
      daysUntilForecast: 7,
    });
    const fixed = data.spend.wages + data.spend.medical + 470_000 + monthOf(284_000, 28);
    expect(data.monthlyNet).toBe(Math.round(-fixed));
  });

  it('counts the last two weeks once they are played', () => {
    const built = productionWorld({
      today: TWO_WEEKS_IN,
      ledger: [{ date: '2026-01-09', category: 'tickets', amount: 50_000 }],
    });
    const data = runwayOf(productionEngine(built.world), built.human);
    const fixed = data.spend.wages + data.spend.medical + 470_000 + monthOf(284_000, 28);
    expect(data.daysUntilForecast).toBe(0);
    expect(data.monthlyNet).toBe(Math.round(monthOf(50_000, 14) - fixed));
    expect(data.status).toBe('losingMoney');
    expect(data.monthsLeft).toBeCloseTo(10_000_000 / -data.monthlyNet, 9);
    expect(data.monthsLeftTrace?.label).toBe('Months of cash left');
  });

  it("refuses another player's books", () => {
    const built = productionWorld();
    const result = productionEngine(built.world).query(
      'production.cashRunway',
      { promotionId: built.human },
      OTHER_VIEW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.map((reason) => reason.code)).toEqual(['notYourBooks']);
    }
  });
});

describe('the change dialog', () => {
  it('shows the months of cash left before and after when money is running out', () => {
    const built = productionWorld({ today: TWO_WEEKS_IN, human: { cash: cents(3_000_000) } });
    const engine = productionEngine(built.world);
    const result = engine.query(
      'production.changePreview',
      { promotionId: built.human, area: 'camera', level: 4 },
      PLAYER_VIEW,
    );
    if (!result.ok) throw new Error('preview refused');
    const row = result.data.rows.find((candidate) => candidate.id === 'cashRunway');
    expect(row).toMatchObject({ label: 'Months of cash left', unit: 'months' });
    expect(row?.after ?? 0).toBeLessThan(row?.before ?? 0);
    expect(row?.before).toBeCloseTo(runwayOf(engine, built.human).monthsLeft ?? 0, 9);
  });

  it('leaves the row out while the forecast waits for a week of play', () => {
    const built = productionWorld();
    const result = productionEngine(built.world).query(
      'production.changePreview',
      { promotionId: built.human, area: 'camera', level: 4 },
      PLAYER_VIEW,
    );
    if (!result.ok) throw new Error('preview refused');
    expect(result.data.rows.map((row) => row.id)).not.toContain('cashRunway');
  });
});
