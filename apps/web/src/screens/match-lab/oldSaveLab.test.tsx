// The owner's old-save check (MTCH1-09): a save stored before match types existed loads the way a
// player loads it, from the saved games list, and the Match lab explains why it cannot run instead
// of crashing.
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { createFakeStorage } from '@/test/fakeStorage';
import { damagedGoldenSave } from '@/test/goldenSave';
import { renderApp, storeRealSlot } from '@/test/renderApp';
import { resetSaveDb } from '@/test/saves';
import { useLabStore } from './labStore';
import { NO_CATALOG_BODY } from './MatchLabView';

/** Loading a save and the lazily loaded lab can take a moment under load. */
const LOAD_MS = 10_000;

beforeEach(async () => {
  await resetSaveDb();
  useSessionStore.getState().clear();
  useLabStore.getState().reset();
});

describe('the Match lab on a save from before match types', () => {
  it('loads the save and says to start a new game', async () => {
    // The golden save with its catalogs taken out: what a save from before them stored.
    const slot = await storeRealSlot(
      damagedGoldenSave(['state', 'world', 'meta', 'catalogs'], {}),
      {
        label: 'Before match types',
      },
    );
    const { router } = renderApp(routes.load(), createFakeStorage([slot]));
    const user = userEvent.setup();

    await user.click(
      within(
        await screen.findByRole('article', { name: 'Before match types' }, { timeout: LOAD_MS }),
      ).getByRole('button', { name: 'Load Before match types' }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Dashboard' }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();

    await router.navigate(routes.game.matchLab());
    expect(await screen.findByText(NO_CATALOG_BODY, {}, { timeout: LOAD_MS })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  });
});
