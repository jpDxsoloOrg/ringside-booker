import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tinyWorld } from '@ringside/engine/testing';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { KpiCard } from '@/components/KpiCard';
import { useTracePanelStore } from '@/components/Trace';
import { findFinanceTabs, LOAD_MS, renderFinances } from '@/test/financesScreen';
import './builtins';
import {
  listFinanceKpis,
  listFinanceTabs,
  registerFinanceKpi,
  registerFinanceTab,
  resetFinanceRegistryForTests,
} from './financeRegistry';

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

afterEach(() => {
  resetFinanceRegistryForTests();
});

function tabNames(tabList: HTMLElement): string[] {
  return within(tabList)
    .getAllByRole('tab')
    .map((tab) => tab.textContent);
}

describe('the finance registries', () => {
  it('hold the built-in tabs and KPI cards at orders 10 to 40', () => {
    expect(listFinanceTabs().map((tab) => [tab.id, tab.order])).toEqual([
      ['overview', 10],
      ['monthly', 20],
      ['ledger', 30],
      ['policies', 40],
    ]);
    expect(listFinanceKpis().map((kpi) => [kpi.id, kpi.order])).toEqual([
      ['finance.cash', 10],
      ['finance.thisMonth', 20],
      ['finance.payroll', 30],
      ['finance.companySize', 40],
    ]);
  });

  it('refuse a taken id, built-in or added', () => {
    expect(() =>
      registerFinanceTab({ id: 'ledger', label: 'Again', order: 50, render: () => null }),
    ).toThrow(/already registered/u);
    registerFinanceKpi({ id: 'eco9.health', order: 15, render: () => null });
    expect(() => registerFinanceKpi({ id: 'eco9.health', order: 16, render: () => null })).toThrow(
      /already registered/u,
    );
  });

  it('take added entries out again on the test reset, keeping the built-in ones', () => {
    registerFinanceTab({ id: 'image', label: 'Image', order: 25, render: () => null });
    expect(listFinanceTabs()).toHaveLength(5);
    resetFinanceRegistryForTests();
    expect(listFinanceTabs()).toHaveLength(4);
  });
});

describe('FinancesScreen', () => {
  it('shows the four tabs, Overview first, under the Finances heading', async () => {
    await renderFinances();
    expect(screen.getByRole('heading', { level: 1, name: 'Finances' })).toBeInTheDocument();
    const tabList = await findFinanceTabs();
    expect(tabNames(tabList)).toEqual(['Overview', 'Monthly', 'Ledger', 'Policies']);
    expect(within(tabList).getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(document.title).toMatch(/^Finances/u);
  });

  it('opens the tab the URL names and writes the tab into the URL', async () => {
    const { router, user } = await renderFinances(routes.game.finances({ tab: 'policies' }));
    const tabList = await findFinanceTabs();
    expect(within(tabList).getByRole('tab', { name: 'Policies' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.click(within(tabList).getByRole('tab', { name: 'Monthly' }));
    expect(router.state.location.search).toBe('?tab=monthly');
    await user.click(within(tabList).getByRole('tab', { name: 'Overview' }));
    expect(router.state.location.search).toBe('');
  });

  it('falls back to Overview for a tab nobody registered', async () => {
    await renderFinances('/game/finances?tab=nonsense');
    const tabList = await findFinanceTabs();
    expect(within(tabList).getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('draws a registered tab and KPI card in their order, without editing the screen', async () => {
    registerFinanceTab({
      id: 'image',
      label: 'Public image',
      order: 25,
      render: () => <p>Image tab body</p>,
    });
    registerFinanceTab({
      id: 'hidden',
      label: 'Hidden',
      order: 26,
      render: () => null,
      visible: () => false,
    });
    registerFinanceKpi({
      id: 'eco9.health',
      order: 15,
      render: () => <KpiCard label="Financial health" value="Healthy" />,
    });
    const { user } = await renderFinances();
    const tabList = await findFinanceTabs();
    expect(tabNames(tabList)).toEqual([
      'Overview',
      'Monthly',
      'Public image',
      'Ledger',
      'Policies',
    ]);

    const cards = await screen.findByRole('group', { name: 'Key numbers' }, { timeout: LOAD_MS });
    await waitFor(
      () => {
        expect(
          [...cards.querySelectorAll('[data-kpi-id]')].map((node) =>
            node.getAttribute('data-kpi-id'),
          ),
        ).toEqual([
          'finance.cash',
          'eco9.health',
          'finance.thisMonth',
          'finance.payroll',
          'finance.companySize',
        ]);
      },
      { timeout: LOAD_MS },
    );

    await user.click(within(tabList).getByRole('tab', { name: 'Public image' }));
    expect(screen.getByText('Image tab body')).toBeInTheDocument();
  });

  it('picks up a tab registered while the screen is open', async () => {
    await renderFinances();
    const tabList = await findFinanceTabs();
    act(() => {
      registerFinanceTab({ id: 'deals', label: 'Deals', order: 35, render: () => null });
    });
    expect(tabNames(tabList)).toEqual(['Overview', 'Monthly', 'Ledger', 'Deals', 'Policies']);
  });

  it('tells a seat that runs no promotion there are no books, without asking the engine', async () => {
    const { argsOf } = await renderFinances(routes.game.finances(), { seatPromotionId: null });
    expect(screen.getByRole('heading', { name: 'No books to show' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(argsOf('finance.overview')).toEqual([]);
  });

  it("shows the engine's reason when the books are another promotion's", async () => {
    const rival = tinyWorld().ids.promotions.B;
    if (rival === undefined) throw new Error('The tiny world has a second promotion');
    await renderFinances(routes.game.finances(), { seatPromotionId: rival });
    expect(
      await screen.findByRole(
        'heading',
        { name: "The books can't be shown" },
        { timeout: LOAD_MS },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Another promotion's finances are private")).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});
