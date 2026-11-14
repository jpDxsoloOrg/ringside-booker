import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { addDays } from '@ringside/engine';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import {
  advance,
  cancelShowOn,
  findNetworksTabs,
  LOAD_MS,
  NETWORKS_WORLD_START,
  renderNetworks,
  runShowTonight,
} from '@/test/networksScreen';
import { DealHealthBadge } from './components/DealHealthBadge';
import { networksPath } from './networksParams';
import { networksTabs, registerNetworksTab } from './registry';

/** Never clock words on a player's screen: a timeslot is a part of the evening. */
const CLOCK_WORDS = /\bmin(ute)?s?\b|hours?\b/i;

function expectNoClockWords(): void {
  expect(document.body.textContent).not.toMatch(CLOCK_WORDS);
}

const THU_16_APR = addDays(NETWORKS_WORLD_START, 6);

afterEach(() => {
  cleanup();
  useSessionStore.getState().clear();
});

async function findDealRow(name: string): Promise<HTMLElement> {
  const button = await screen.findByRole('button', { name }, { timeout: LOAD_MS });
  const row = button.closest('tr');
  if (row === null) throw new Error(`No row for ${name}`);
  return row;
}

describe('NetworksScreen', () => {
  it('draws the registered tabs and restores the one named in ?tab=', async () => {
    const { user, router } = await renderNetworks(networksPath({ tab: 'eco.available' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Networks' })).toBeInTheDocument();
    const tabs = await findNetworksTabs();
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Your deals', 'Available networks']);
    expect(within(tabs).getByRole('tab', { name: 'Available networks' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      await screen.findByText('Networks that reach places where fans know you.'),
    ).toBeInTheDocument();

    await user.click(within(tabs).getByRole('tab', { name: 'Your deals' }));
    expect(router.state.location.search).toBe('?tab=eco.yourDeals');
    await findDealRow('Test Network North · Test Weekly');
    expectNoClockWords();
  });

  it('says so for a seat that runs no promotion', async () => {
    await renderNetworks(routes.game.networks(), { seatPromotionId: null });
    expect(
      await screen.findByRole('heading', { name: "You don't run a promotion" }),
    ).toBeInTheDocument();
  });

  it('lists your deals with slot, fee, viewers with their Why? and health', async () => {
    const { user } = await renderNetworks(routes.game.networks(), {
      prepare: async (transport) => {
        // The player runs Test Weekly on Thu 16 Apr, and it airs (ECO8-07: an unrun show is a
        // missed airing).
        await advance(transport, 6);
        await runShowTonight(transport, 'Test Weekly');
        await advance(transport, 1);
      },
    });
    const row = await findDealRow('Test Network North · Test Weekly');
    expect(within(row).getByText('Thu · Evening · Taped')).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: /^Why is What Test Network North expects/ }),
    ).toBeInTheDocument();
    expect(within(row).getByText('Safe')).toBeInTheDocument();
    expect(within(row).queryByText('No airing yet')).toBeNull();
    // ECO8-10: the three targets in viewers, each with its Why?.
    const targets = within(row).getByRole('list', {
      name: 'What Test Network North expects of the deal',
    });
    expect(
      within(targets)
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('data-target')),
    ).toEqual(['safe', 'cancel', 'bonus']);
    expect(within(targets).getByText(/^Bonus above /)).toBeInTheDocument();
    expect(
      within(targets).getByRole('button', { name: /^Why is The ratings bonus line/ }),
    ).toBeInTheDocument();

    // Ended deals come in with the toggle, with why they ended. The rival's deal never shows.
    await user.click(screen.getByRole('switch', { name: 'Show ended deals' }));
    expect(screen.queryByText(/Test Rival Weekly/)).toBeNull();
    expectNoClockWords();
  });

  it('shows a missed airing and one coming in the deal sheet', async () => {
    const { user } = await renderNetworks(routes.game.networks(), {
      prepare: async (transport) => {
        await advance(transport, 1);
        await cancelShowOn(transport, 'Test Weekly', THU_16_APR);
        await advance(transport, 7);
        await cancelShowOn(transport, 'Test Weekly', addDays(THU_16_APR, 7));
      },
    });
    const row = await findDealRow('Test Network North · Test Weekly');
    expect(within(row).getByText('Missed airing')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Test Network North · Test Weekly' }));

    const sheet = await screen.findByRole('dialog', { name: 'Test Network North · Test Weekly' });
    expect(within(sheet).getByText('Missed: show cancelled')).toBeInTheDocument();
    expect(
      within(sheet).getByText('Missed airing coming: Thu 23 Apr (show cancelled)'),
    ).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Renegotiate' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Cancel deal' })).toBeInTheDocument();
    expectNoClockWords();
  });

  it('previews a renewal and renews the deal', async () => {
    const { user } = await renderNetworks(routes.game.networks());
    const row = await findDealRow('Test Network North · Test Weekly');
    await user.click(within(row).getByRole('button', { name: 'Test Network North · Test Weekly' }));
    const sheet = await screen.findByRole('dialog', { name: 'Test Network North · Test Weekly' });
    await user.click(within(sheet).getByRole('button', { name: 'Renegotiate' }));

    const renew = await screen.findByRole('dialog', { name: /^Renew: / });
    expect(await within(renew).findByRole('row', { name: /Fee per show/ })).toBeInTheDocument();
    expect(within(renew).getByText('New end date')).toBeInTheDocument();
    expect(within(renew).getByText('Would accept')).toBeInTheDocument();
    await user.click(within(renew).getByRole('button', { name: 'Renew' }));
    expect(
      await screen.findByText(/^Deal with Test Network North renewed until /),
    ).toBeInTheDocument();
    expectNoClockWords();
  });

  it('shows the engine’s refusal when a renewal is refused', async () => {
    const { user, transport, promotionId } = await renderNetworks(routes.game.networks());
    const row = await findDealRow('Test Network North · Test Weekly');
    await user.click(within(row).getByRole('button', { name: 'Test Network North · Test Weekly' }));
    const sheet = await screen.findByRole('dialog', { name: 'Test Network North · Test Weekly' });
    await user.click(within(sheet).getByRole('button', { name: 'Renegotiate' }));
    const renew = await screen.findByRole('dialog', { name: /^Renew: / });
    await within(renew).findByText('Would accept');
    // The deal ends behind the screen's back: the network now says so.
    const deals = await transport.host.query('broadcast.deals', { promotionId, include: 'active' });
    if (!deals.result.ok) throw new Error('No deals');
    const dealId = deals.result.data[0]?.dealId;
    if (dealId === undefined) throw new Error('No deal');
    await act(async () => {
      await transport.host.command('broadcast.cancelDeal', { dealId });
    });
    await user.click(within(renew).getByRole('button', { name: 'Renew' }));
    expect(await within(renew).findByRole('alert')).toHaveTextContent(/no longer running/i);
  });

  it('cancels a deal after confirming the exit fee', async () => {
    const { user } = await renderNetworks(routes.game.networks());
    const row = await findDealRow('Test Network North · Test Weekly');
    await user.click(within(row).getByRole('button', { name: 'Test Network North · Test Weekly' }));
    const sheet = await screen.findByRole('dialog', { name: 'Test Network North · Test Weekly' });
    await user.click(within(sheet).getByRole('button', { name: 'Cancel deal' }));

    const confirm = await screen.findByRole('alertdialog', {
      name: /^Cancel your deal with Test Network North\? You pay an exit fee of \$[\d,.]+K?\.$/,
    });
    expect(
      await within(confirm).findByRole('button', { name: /^Why is Exit fee/ }),
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel deal' }));
    expect(await screen.findByText('Deal cancelled')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'No TV deals yet' })).toBeInTheDocument();
  });

  it('keeps the cancel dialog open with the reason when the engine refuses', async () => {
    const { user, transport, promotionId } = await renderNetworks(routes.game.networks());
    const row = await findDealRow('Test Network North · Test Weekly');
    await user.click(within(row).getByRole('button', { name: 'Test Network North · Test Weekly' }));
    const sheet = await screen.findByRole('dialog', { name: 'Test Network North · Test Weekly' });
    await user.click(within(sheet).getByRole('button', { name: 'Cancel deal' }));
    const confirm = await screen.findByRole('alertdialog', { name: /exit fee/ });
    const deals = await transport.host.query('broadcast.deals', { promotionId, include: 'active' });
    if (!deals.result.ok) throw new Error('No deals');
    const dealId = deals.result.data[0]?.dealId;
    if (dealId === undefined) throw new Error('No deal');
    await act(async () => {
      await transport.host.command('broadcast.cancelDeal', { dealId });
    });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel deal' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'This deal is no longer running',
    );
    expect(
      screen.getByRole('alertdialog', { name: /^Cancel your deal with Test Network North/ }),
    ).toBeInTheDocument();
  });

  it('lists only the networks that reach your fans, with rivals by name and no money', async () => {
    await renderNetworks(networksPath({ tab: 'eco.available' }));
    const table = await screen.findByRole(
      'grid',
      { name: 'Available networks' },
      {
        timeout: LOAD_MS,
      },
    );
    await within(table).findByText('Test Network North');
    expect(within(table).getByText('Test Pay-per-view')).toBeInTheDocument();
    expect(within(table).queryByText('Test Network South')).toBeNull();
    const north = within(table).getByText('Test Network North').closest('tr');
    if (north === null) throw new Error('No row');
    expect(
      within(north).getByText(
        'Test Weekly · Test Promotion A; Test Rival Weekly · Test Promotion B',
      ),
    ).toBeInTheDocument();
    expect(within(north).getByText('Would accept')).toBeInTheDocument();
    const ppv = within(table).getByText('Test Pay-per-view').closest('tr');
    if (ppv === null) throw new Error('No row');
    expect(within(ppv).getByText('Would refuse')).toBeInTheDocument();
    expect(
      within(ppv).getByText('Fewer than 300 buys is too small for pay-per-view'),
    ).toBeInTheDocument();
    expectNoClockWords();
  });

  it('re-asks the network on every change, holds back a refused proposal and signs an accepted one', async () => {
    const { user, argsOf, router } = await renderNetworks(networksPath({ tab: 'eco.available' }));
    const table = await screen.findByRole(
      'grid',
      { name: 'Available networks' },
      {
        timeout: LOAD_MS,
      },
    );
    const north = (await within(table).findByText('Test Network North')).closest('tr');
    if (north === null) throw new Error('No row');
    await user.click(within(north).getByRole('button', { name: 'Propose' }));

    const sheet = await screen.findByRole('dialog', {
      name: 'Propose a deal to Test Network North',
    });
    expect(await within(sheet).findByText('Would accept')).toBeInTheDocument();
    const valuations = (): unknown[] => argsOf('broadcast.valuation');
    expect(valuations().at(-1)).toMatchObject({ timeslot: 'primeTime', live: false });

    await user.click(within(sheet).getByRole('radio', { name: 'Evening' }));
    await waitFor(() => {
      expect(valuations().at(-1)).toMatchObject({ timeslot: 'evening', live: false });
    });
    await user.click(within(sheet).getByRole('switch', { name: /^Live/ }));
    await waitFor(() => {
      expect(valuations().at(-1)).toMatchObject({ timeslot: 'evening', live: true });
    });
    expect(within(sheet).getByRole('group', { name: 'Income per airing' })).toBeInTheDocument();
    expect(
      within(sheet).getByRole('button', { name: /^Why is Projected viewers/ }),
    ).toBeInTheDocument();

    // Test Weekly is already on North: the network refuses and Propose stays disabled.
    const showField = within(sheet).getByRole('combobox', { name: 'Show' });
    showField.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'Test Weekly' }));
    expect(await within(sheet).findByText('Would refuse')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Propose deal' })).toBeDisabled();

    showField.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'Test Big Night' }));
    await within(sheet).findByText('Would accept');
    await waitFor(() => {
      expect(within(sheet).getByRole('button', { name: 'Propose deal' })).toBeEnabled();
    });
    await user.click(within(sheet).getByRole('button', { name: 'Propose deal' }));

    expect(await screen.findByText('Deal signed with Test Network North')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?tab=eco.yourDeals');
    const signed = await screen.findByRole('button', {
      name: 'Test Network North · Test Big Night',
    });
    await waitFor(() => {
      expect(signed).toHaveFocus();
    });
    expectNoClockWords();
  });
});

describe('registerNetworksTab', () => {
  it('adds a tab, refuses a taken id and removes it again', async () => {
    const remove = registerNetworksTab({
      id: 'test.extra',
      order: 30,
      label: 'Your service',
      render: () => <p>Service panel</p>,
    });
    try {
      expect(() =>
        registerNetworksTab({ id: 'test.extra', order: 40, label: 'Again', render: () => null }),
      ).toThrow(/already registered/);
      await renderNetworks(networksPath({ tab: 'test.extra' }));
      expect(
        await screen.findByText('Service panel', undefined, { timeout: LOAD_MS }),
      ).toBeInTheDocument();
    } finally {
      remove();
    }
    expect(networksTabs().map((tab) => tab.id)).toEqual(['eco.yourDeals', 'eco.available']);
  });
});

describe('DealHealthBadge', () => {
  it.each([
    [
      'exceeding',
      ["Beating the network's expectations: viewers are 130% of what NSN expects"],
      'Exceeding',
    ],
    ['safe', ['Nothing wrong so far'], 'Safe'],
    ['watch', ['Viewers are a little under what the network wants'], 'Watch'],
    ['atRisk', ['Viewers are well under'], 'At risk'],
    ['cancelling', ['3 missed airings: NSN is pulling the deal'], 'Missed airing'],
    ['cancelling', ['Viewers far under: NSN is pulling the deal'], 'Cancelling'],
  ] as const)('draws %s (%j) as %s', (risk, reasons, label) => {
    render(<DealHealthBadge risk={risk} reasons={reasons} networkName="NSN" />);
    expect(screen.getByText(label)).toBeInTheDocument();
    // The reasons are read out with the badge, not only shown in a tooltip.
    expect(screen.getByRole('button')).toHaveTextContent(reasons[0]);
  });
});
