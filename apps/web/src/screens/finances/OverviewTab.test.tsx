import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseGameDate, yearMonthOf } from '@ringside/engine';
import type { YearMonth } from '@ringside/engine';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useSettingsStore } from '@/app/settings/settingsStore';
import { formatMoney } from '@/components/format';
import { useTracePanelStore } from '@/components/Trace';
import { LOAD_MS, renderFinances } from '@/test/financesScreen';
import { cashTrendValues, thisMonthTrace } from './kpis';

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

async function findCard(label: string): Promise<HTMLElement> {
  return screen.findByRole('group', { name: label }, { timeout: LOAD_MS });
}

describe('OverviewTab', () => {
  it('shows the same cash as the top bar’s sim.status, with its Why?', async () => {
    const { transport } = await renderFinances(routes.game.finances(), { daysPlayed: 2 });
    const status = await transport.host.query('sim.status', {});
    if (!status.result.ok || status.result.data.promotion === null) {
      throw new Error('The tiny world has a status for the player’s promotion');
    }
    const cash = status.result.data.promotion.cash;

    const card = await findCard('Cash');
    const moneyStyle = useSettingsStore.getState().settings.moneyStyle;
    expect(within(card).getByText(formatMoney(cash, { style: moneyStyle }))).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /^Why is Cash /u })).toBeInTheDocument();
  });

  it('opens the payroll breakdown from the Projected payroll card', async () => {
    const { user } = await renderFinances();
    const card = await findCard('Projected payroll');
    expect(within(card).getByText(/Paid daily: \$[\d,.]+[KMB]?\/day/u)).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: /^Why is Projected payroll /u }));
    const panel = await screen.findByRole('dialog', { name: 'Projected payroll' });
    expect(within(panel).getAllByText(/payroll/iu).length).toBeGreaterThan(0);
  });

  it('shows this month’s net, the company size with reach, and this month by category', async () => {
    await renderFinances();
    const thisMonth = await findCard('This month so far');
    expect(within(thisMonth).getByText(/^Income .* · Costs /u)).toBeInTheDocument();

    const size = await findCard('Company size');
    expect(within(size).getByText(/Reach/u)).toBeInTheDocument();
    expect(within(size).getByRole('button', { name: /^Why is Reach /u })).toBeInTheDocument();
    expect(
      within(size).getByRole('button', { name: /^Why is Company size /u }),
    ).toBeInTheDocument();

    const byCategory = await screen.findByRole(
      'heading',
      { name: 'This month by category' },
      { timeout: LOAD_MS },
    );
    expect(byCategory).toBeInTheDocument();
  });

  it('links each of this month’s categories to its rows in the Ledger', async () => {
    await renderFinances();
    await screen.findByRole('heading', { name: 'This month by category' }, { timeout: LOAD_MS });
    await waitFor(
      () => {
        const links = screen.queryAllByRole('link').map((link) => link.getAttribute('href') ?? '');
        expect(
          links.some((href) => href.includes('tab=ledger') && href.includes('category=')),
        ).toBe(true);
      },
      { timeout: LOAD_MS },
    );
  });
});

function monthOf(text: string): YearMonth {
  return yearMonthOf(parseGameDate(`${text}-01`));
}

describe('the KPI helpers', () => {
  const monthEndCash = (['2026-11', '2026-12', '2027-01', '2027-02'] as const).map(
    (month, index) => ({ month: monthOf(month), cash: (index + 1) * 100 }),
  );

  it('draws only the months since the game started', () => {
    expect(cashTrendValues(monthEndCash, monthOf('2027-01'))).toEqual([300, 400]);
    expect(cashTrendValues(monthEndCash, monthOf('2027-02'))).toEqual([400]);
    expect(cashTrendValues(monthEndCash, null)).toEqual([100, 200, 300, 400]);
  });

  it('explains this month’s net as income plus costs', () => {
    const trace = thisMonthTrace({
      month: monthOf('2027-02'),
      income: 500_000,
      costs: -800_000,
      net: -300_000,
    });
    expect(trace.kind).toBe('formula');
    expect('value' in trace ? trace.value : null).toBe(-300_000);
  });
});
