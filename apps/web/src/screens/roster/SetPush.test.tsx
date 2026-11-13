import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialEngineState } from '@ringside/engine';
import type { EngineState, Push, PromotionId, RosterRow } from '@ringside/engine';
import {
  aPerson,
  anEmployment,
  TEST_PLAYER_ID,
  TEST_START_DATE,
  worldBuilder,
} from '@ringside/engine/testing';
import { LiveAnnouncer } from '@/app/a11y/LiveAnnouncer';
import type { EngineClient } from '@/app/engine/engineClient';
import { EngineProvider, useEngineClient } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { BP_MOBILE_QUERY } from '@/styles/breakpoints';
import { fakeEngineFactory } from '@/test/fakeEngine';
import { setMatchMedia } from '@/test/matchMedia';
import { RosterScreen } from './RosterScreen';

/** The engine's first answer can take a moment when several test files load the machine. */
const LOAD_MS = 10_000;

const WRESTLERS = ['Test Name 1', 'Test Name 2', 'Test Name 3', 'Test Name 4'] as const;

/**
 * Test Promotion A (the player's): four wrestlers on the mid card and one referee, no brands. With
 * `expired`, that wrestler's contract has ended, as if it ran out while the roster was open; the
 * builder is deterministic, so the IDs match the world without it.
 */
function setPushWorld(expired?: (typeof WRESTLERS)[number]): {
  readonly state: EngineState;
  readonly own: PromotionId;
} {
  const { world, ids } = worldBuilder({ startDate: TEST_START_DATE })
    .withGeography('mini')
    .withPromotion(
      { name: 'Test Promotion A', controller: { kind: 'human', playerId: TEST_PLAYER_ID } },
      (promotion) =>
        promotion.withRoster(WRESTLERS.length, {
          employment: (index) => ({ push: 'midCard', ringName: WRESTLERS[index] ?? 'Test Name' }),
        }),
    )
    .with('a referee', (context) => {
      const promotionId = context.ids.promotions.A;
      if (promotionId === undefined) throw new Error('No promotion A.');
      const person = context.insert(
        'people',
        aPerson({ roles: ['referee'], style: 'nonWrestler', debutDate: null }, context.sequence),
      );
      context.insert(
        'employments',
        anEmployment(
          {
            personId: person.id,
            promotionId,
            offeredOn: TEST_START_DATE,
            startsOn: TEST_START_DATE,
            role: 'referee',
            push: 'none',
            ringName: 'Test Referee Name',
          },
          context.sequence,
        ),
      );
    })
    .build();
  const own = ids.promotions.A;
  if (own === undefined) throw new Error('The world lost its promotion.');
  // A copy: the engine's state is frozen.
  const state = structuredClone(initialEngineState(world));
  if (expired !== undefined) {
    const employment = state.world.tables.employments.find((row) => row.ringName === expired);
    if (employment === undefined) throw new Error(`No contract for ${expired}.`);
    employment.status = 'expired';
    employment.endedOn = TEST_START_DATE;
  }
  return { state, own };
}

function renderSetPush() {
  const world = setPushWorld();
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(world.state);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const commandSpy = vi.spyOn(transport.host, 'command');
  let client: EngineClient | null = null;
  function ClientProbe() {
    client = useEngineClient();
    return null;
  }
  const router = createMemoryRouter([{ path: routes.game.roster(), element: <RosterScreen /> }], {
    initialEntries: [routes.game.roster()],
    future: routerFutureFlags,
  });
  render(
    <LiveAnnouncer>
      <EngineProvider createTransport={() => transport}>
        <ClientProbe />
        <RouterProvider router={router} future={routerProviderFutureFlags} />
      </EngineProvider>
    </LiveAnnouncer>,
  );

  /** The engine's own rows, to check the screen against. */
  const engineRows = async (): Promise<readonly RosterRow[]> => {
    const answer = await transport.host.query('roster.rows', { promotionId: world.own });
    if (!answer.result.ok) throw new Error('The engine refused the roster.');
    return answer.result.data.rows;
  };
  const enginePush = async (ringName: string): Promise<Push | undefined> =>
    (await engineRows()).find((row) => row.ringName === ringName)?.push;
  /** Swaps the engine's world for one where `ringName`'s contract has ended. */
  const expireContract = (ringName: (typeof WRESTLERS)[number]): void => {
    transport.host.installEngine(setPushWorld(ringName).state);
  };
  const setPushCalls = () => commandSpy.mock.calls.filter(([name]) => name === 'roster.setPush');
  const engineClient = (): EngineClient => {
    if (client === null) throw new Error('The engine client is not mounted.');
    return client;
  };

  return {
    user: userEvent.setup({ delay: null }),
    engineRows,
    enginePush,
    expireContract,
    setPushCalls,
    engineClient,
  };
}

async function findWrestlers(): Promise<HTMLElement> {
  const table = await screen.findByRole(
    'grid',
    { name: 'Wrestlers at Test Promotion A' },
    { timeout: LOAD_MS },
  );
  await waitFor(
    () => {
      expect(table.querySelectorAll('tbody tr[data-row-id]')).toHaveLength(WRESTLERS.length);
    },
    { timeout: LOAD_MS },
  );
  return table;
}

/** The Push cell of a wrestler's row in the desktop table. */
function pushCell(table: HTMLElement, ringName: string): string {
  const link = within(table).getByRole('link', { name: ringName, hidden: true });
  const row = link.closest('tr');
  const cell = row?.querySelector('[data-column-id="push"]');
  if (cell === null || cell === undefined) throw new Error(`No push cell for ${ringName}.`);
  return cell.textContent;
}

async function tick(user: UserEvent, ...names: readonly string[]): Promise<void> {
  for (const name of names) {
    await user.click(screen.getByRole('checkbox', { name: `Select ${name}` }));
  }
}

/** Ticks `names`, opens the bulk sheet, picks `push` and presses Apply: the confirm opens. */
async function startBulk(
  user: UserEvent,
  names: readonly string[],
  push: string,
): Promise<HTMLElement> {
  await tick(user, ...names);
  const bar = screen.getByRole('region', { name: 'Selected wrestlers' });
  expect(within(bar).getByText(`${String(names.length)} selected`)).toBeInTheDocument();
  await user.click(within(bar).getByRole('button', { name: 'Set push…' }));
  const sheet = await screen.findByRole('dialog', {
    name: `Set push — ${String(names.length)} wrestlers`,
  });
  await user.click(within(sheet).getByRole('radio', { name: push }));
  await user.click(within(sheet).getByRole('button', { name: 'Apply' }));
  return screen.findByRole('alertdialog', {
    name: `Set ${String(names.length)} wrestlers to ${push}?`,
  });
}

beforeEach(() => {
  useSessionStore.getState().clear();
});

describe('Set push from the roster', () => {
  it('changes one push from the row menu, then hands focus back to the menu', async () => {
    const { user, enginePush } = renderSetPush();
    const table = await findWrestlers();
    expect(pushCell(table, 'Test Name 2')).toBe('Mid card');

    const trigger = within(table).getByRole('button', { name: 'Actions for Test Name 2' });
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: 'Set push…' }));

    const sheet = await screen.findByRole('dialog', { name: 'Set push — Test Name 2' });
    const choices = within(sheet).getByRole('group', { name: 'Card position' });
    await waitFor(() => {
      expect(sheet.contains(document.activeElement)).toBe(true);
    });
    // The current push is picked; the hints say where they are and what they expect.
    expect(within(choices).getByRole('radio', { name: 'Mid card' })).toBeChecked();
    expect(within(choices).getByText(/Current/)).toBeInTheDocument();
    expect(within(choices).getByText(/Expects/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Apply' })).toBeDisabled();

    await user.click(within(choices).getByRole('radio', { name: 'Main event' }));
    await user.click(within(sheet).getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(pushCell(table, 'Test Name 2')).toBe('Main event');
    });
    expect(await enginePush('Test Name 2')).toBe('mainEvent');
    expect(await screen.findByText('Push updated for Test Name 2')).toBeInTheDocument();
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it('changes several in one command after a confirm', async () => {
    const { user, setPushCalls, enginePush } = renderSetPush();
    const table = await findWrestlers();
    const picked = ['Test Name 1', 'Test Name 2', 'Test Name 3'];

    const dialog = await startBulk(user, picked, 'Lower card');
    for (const name of picked) {
      expect(within(dialog).getByText(`${name}: Mid card → Lower card`)).toBeInTheDocument();
    }
    expect(setPushCalls()).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Set push' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(setPushCalls()).toHaveLength(1);
    const [, args] = setPushCalls()[0] ?? [];
    expect(args).toMatchObject({
      push: 'lowerCard',
      employmentIds: [expect.any(String), expect.any(String), expect.any(String)],
    });

    await waitFor(() => {
      for (const name of picked) expect(pushCell(table, name)).toBe('Lower card');
    });
    expect(pushCell(table, 'Test Name 4')).toBe('Mid card');
    expect(await enginePush('Test Name 3')).toBe('lowerCard');
    expect(await screen.findByText('Pushes updated for 3 wrestlers')).toBeInTheDocument();
    // The selection is cleared, and the bar with it.
    expect(screen.queryByRole('region', { name: 'Selected wrestlers' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Select Test Name 1' })).not.toBeChecked();
  });

  it('sends nothing when the confirm is cancelled', async () => {
    const { user, setPushCalls } = renderSetPush();
    const table = await findWrestlers();
    const dialog = await startBulk(user, ['Test Name 1', 'Test Name 4'], 'Main event');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(setPushCalls()).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'Set push — 2 wrestlers' })).toBeInTheDocument();
    expect(pushCell(table, 'Test Name 1')).toBe('Mid card');
  });

  it('shows the engine’s refusal in the confirm and changes no row', async () => {
    const { user, expireContract, enginePush, setPushCalls } = renderSetPush();
    const table = await findWrestlers();
    const dialog = await startBulk(
      user,
      ['Test Name 1', 'Test Name 2', 'Test Name 3'],
      'Upper card',
    );

    // Test Name 2's contract runs out while the confirm is open.
    expireContract('Test Name 2');
    await user.click(within(dialog).getByRole('button', { name: 'Set push' }));

    expect(
      await within(dialog).findByText(
        "Test Name 2's contract isn't active (it is expired), so their push can't change.",
      ),
    ).toBeInTheDocument();
    expect(setPushCalls()).toHaveLength(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(await enginePush('Test Name 1')).toBe('midCard');
    expect(await enginePush('Test Name 3')).toBe('midCard');
    expect(pushCell(table, 'Test Name 1')).toBe('Mid card');
    expect(pushCell(table, 'Test Name 3')).toBe('Mid card');
  });

  it('offers no checkboxes or push on a crew tab, and a tab change clears the ticks', async () => {
    const { user } = renderSetPush();
    await findWrestlers();
    await tick(user, 'Test Name 1');
    expect(screen.getByRole('region', { name: 'Selected wrestlers' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Referees/ }));
    const referees = await screen.findByRole(
      'grid',
      { name: 'Referees at Test Promotion A' },
      { timeout: LOAD_MS },
    );
    await within(referees).findByRole('link', { name: 'Test Referee Name' }, { timeout: LOAD_MS });
    expect(within(referees).queryByRole('checkbox')).toBeNull();
    expect(within(referees).queryByRole('button', { name: /^Actions for/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Selected wrestlers' })).toBeNull();

    await user.click(screen.getByRole('tab', { name: /Wrestlers/ }));
    await findWrestlers();
    expect(screen.getByRole('checkbox', { name: 'Select Test Name 1' })).not.toBeChecked();
    expect(screen.queryByRole('region', { name: 'Selected wrestlers' })).toBeNull();
  });

  it('disables Set push while days are advancing, and says why', async () => {
    const { user, engineClient } = renderSetPush();
    const table = await findWrestlers();
    await tick(user, 'Test Name 1');
    act(() => {
      engineClient().status.getState().setAdvancing(true);
    });

    const bar = screen.getByRole('region', { name: 'Selected wrestlers' });
    await waitFor(() => {
      expect(within(bar).getByRole('button', { name: 'Set push…' })).toBeDisabled();
    });
    expect(within(bar).getByText('Wait for the day to finish')).toBeInTheDocument();

    await user.click(within(table).getByRole('button', { name: 'Actions for Test Name 2' }));
    const item = await screen.findByRole('menuitem', {
      name: 'Set push… (wait for the day to finish)',
    });
    expect(item).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Set push on a phone', () => {
  beforeEach(() => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
  });

  it('has no row menu; a ticked card brings up the bottom bar and a bottom sheet', async () => {
    const { user, enginePush } = renderSetPush();
    const list = await screen.findByRole(
      'list',
      { name: 'Wrestlers at Test Promotion A' },
      { timeout: LOAD_MS },
    );
    await within(list).findByRole('link', { name: 'Test Name 1' }, { timeout: LOAD_MS });
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();

    await tick(user, 'Test Name 3');
    const bar = screen.getByRole('region', { name: 'Selected wrestlers' });
    expect(bar).toHaveAttribute('data-placement', 'phone');
    expect(within(bar).getByText('1 selected')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Clear' })).toBeInTheDocument();

    await user.click(within(bar).getByRole('button', { name: 'Set push…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Set push — Test Name 3' });
    expect(sheet).toHaveAttribute('data-side', 'bottom');

    // One ticked card changes straight away, like the row menu.
    await user.click(within(sheet).getByRole('radio', { name: 'Enhancement' }));
    await user.click(within(sheet).getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await enginePush('Test Name 3')).toBe('enhancement');
    expect(screen.queryByRole('region', { name: 'Selected wrestlers' })).toBeNull();
  });
});
