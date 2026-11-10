import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { BUNDLED_ENGINE_VERSION } from '@/engineVersion';
import { createFakeStorage, fakeSlot } from '@/test/fakeStorage';
import { damagedGoldenSave, goldenSaveBytes, olderBuildSaveBytes } from '@/test/goldenSave';
import { renderApp, storeRealSlot } from '@/test/renderApp';
import { resetSaveDb } from '@/test/saves';

function saveFile(bytes: Uint8Array): File {
  return new File([new Uint8Array(bytes)], 'league.rbsave');
}

beforeEach(async () => {
  await resetSaveDb();
  useSessionStore.getState().clear();
});

describe('TitleScreen', () => {
  it('shows the wordmark, the menu and both versions', async () => {
    renderApp(routes.title(), createFakeStorage());

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ringside Booker' }),
    ).toBeInTheDocument();
    const menu = screen.getByRole('navigation', { name: 'Main menu' });
    expect(within(menu).getByRole('link', { name: 'New game' })).toHaveAttribute(
      'href',
      routes.newGame(),
    );
    expect(within(menu).getByRole('link', { name: 'Load game' })).toHaveAttribute(
      'href',
      routes.load(),
    );
    expect(within(menu).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      routes.settings(),
    );
    expect(within(menu).getByRole('button', { name: 'Import save' })).toBeInTheDocument();
    expect(screen.getByText(`App v${__APP_VERSION__}`)).toBeInTheDocument();
    expect(screen.getByText(`Engine v${BUNDLED_ENGINE_VERSION}`)).toBeInTheDocument();
  });

  it('hides Continue when there are no saves', async () => {
    renderApp(routes.title(), createFakeStorage());

    await screen.findByRole('link', { name: 'New game' });
    expect(screen.queryByRole('button', { name: /^Continue/ })).toBeNull();
  });

  it('names the save Continue will load, or Unemployed without a promotion', async () => {
    renderApp(
      routes.title(),
      createFakeStorage([fakeSlot({ label: 'Free agent run', header: { promotionName: null } })]),
    );

    expect(await screen.findByRole('button', { name: /^Continue/ })).toHaveTextContent(
      'Free agent run · Unemployed · Apr 10, 2026',
    );
  });

  it('explains the redirect when an in-game page needed a world', async () => {
    renderApp(routes.game.roster(), createFakeStorage());

    expect(await screen.findByRole('heading', { level: 1, name: 'Ringside Booker' })).toBeVisible();
    expect(screen.getByText('Load or start a game first.')).toBeInTheDocument();
  });

  it('imports a file and opens the slot list with the new slot pointed out', async () => {
    const { router } = renderApp(routes.title(), createFakeStorage());
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Import save' });

    await user.upload(screen.getByTestId('import-save-input'), saveFile(await goldenSaveBytes()));

    const card = await screen.findByRole('article', { name: 'Test save (imported)' });
    expect(card).toHaveClass('highlighted');
    expect(router.state.location.pathname).toBe(routes.load());
  });

  it('reports a Continue that fails to load and stays on the title screen', async () => {
    const slot = await storeRealSlot(damagedGoldenSave(['formatVersion'], 99), {
      label: 'Future league',
    });
    const { router } = renderApp(routes.title(), createFakeStorage([slot]));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /^Continue/ }));

    const sheet = await screen.findByRole('dialog', { name: "Couldn't load Future league" });
    expect(sheet).toHaveTextContent('Checking the save version');
    expect(router.state.location.pathname).toBe(routes.title());
  });

  it('says a Continue save was made with an older build, and hides Continue once it is deleted', async () => {
    const slot = await storeRealSlot(olderBuildSaveBytes(), { label: 'Old league' });
    const { router } = renderApp(routes.title(), createFakeStorage([slot]));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /^Continue/ }));

    const sheet = await screen.findByRole('dialog', { name: 'Made with an older build' });
    expect(sheet).toHaveTextContent('Start a new game.');
    expect(within(sheet).getByRole('button', { name: 'Export this save' })).toBeInTheDocument();
    expect(screen.queryByTestId('load-error')).toBeNull();
    expect(router.state.location.pathname).toBe(routes.title());

    await user.click(within(sheet).getByRole('button', { name: 'Delete this save' }));
    await user.click(
      within(await screen.findByRole('alertdialog', { name: 'Delete Old league?' })).getByRole(
        'button',
        { name: 'Delete' },
      ),
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Continue/ })).toBeNull();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Made with an older build' })).toBeNull();
    });
  });
});
