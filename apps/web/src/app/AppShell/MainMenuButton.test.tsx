import { act, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import * as storage from '@/storage';
import { createFakeStorage } from '@/test/fakeStorage';
import { goldenSaveBytes } from '@/test/goldenSave';
import { renderApp, storeRealSlot } from '@/test/renderApp';
import { expectOk, resetSaveDb } from '@/test/saves';
import { routes } from '../routes';
import { useSessionStore } from '../session/sessionStore';

/** Loads a real slot through the slot list and waits for the office. */
async function enterGame() {
  const slot = await storeRealSlot(await goldenSaveBytes(), { label: 'Shell league' });
  const rendered = renderApp(routes.load(), createFakeStorage([slot]));
  const user = userEvent.setup();
  await user.click(
    within(await screen.findByRole('article', { name: 'Shell league' })).getByRole('button', {
      name: 'Load Shell league',
    }),
  );
  await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
  return { ...rendered, slot, user };
}

beforeEach(async () => {
  await resetSaveDb();
  useSessionStore.getState().clear();
});

describe('Main menu in the shell', () => {
  it('saves into the slot, unloads the game and returns to the title screen', async () => {
    const { router, transport, slot, user } = await enterGame();
    const sidebar = screen.getByTestId('sidebar');

    await user.click(within(sidebar).getByRole('button', { name: 'Main menu' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ringside Booker' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(routes.title());
    expect(useSessionStore.getState().worldLoaded).toBe(false);
    expect(transport.host.isWorldLoaded()).toBe(false);
    const saved = expectOk(await storage.getSlot(slot.slotId));
    expect(saved.backups).toHaveLength(1);
    expect(saved.updatedAt).not.toBe(slot.updatedAt);
  });

  it('keeps the player in the game and shows the error when the save fails', async () => {
    const { router, transport, slot, user } = await enterGame();
    expectOk(await storage.deleteSlot(slot.slotId));

    await user.click(
      within(screen.getByTestId('sidebar')).getByRole('button', { name: 'Main menu' }),
    );

    expect(await screen.findByText(/Couldn't save before leaving/)).toHaveTextContent(
      `Save slot ${slot.slotId} does not exist.`,
    );
    expect(router.state.location.pathname).toBe(routes.game.office());
    expect(useSessionStore.getState().worldLoaded).toBe(true);
    expect(transport.host.isWorldLoaded()).toBe(true);
  });

  it('is disabled while days are advancing', async () => {
    const { client } = await enterGame();
    const button = within(screen.getByTestId('sidebar')).getByRole('button', {
      name: 'Main menu',
    });
    expect(button).toBeEnabled();

    act(() => {
      client.status.getState().setAdvancing(true);
    });
    expect(button).toBeDisabled();

    act(() => {
      client.status.getState().setAdvancing(false);
    });
    expect(button).toBeEnabled();
  });
});
