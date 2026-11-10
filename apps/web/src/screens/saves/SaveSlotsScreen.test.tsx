import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { CURRENT_FORMAT_VERSION, ENGINE_VERSION } from '@ringside/engine';
import { ANNOUNCE_DELAY_MS } from '@/app/a11y/LiveAnnouncer';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { createFakeStorage, FAKE_EXPORT_FILE_NAME, fakeSlot } from '@/test/fakeStorage';
import type { FakeStorage } from '@/test/fakeStorage';
import {
  damagedGoldenSave,
  goldenHumanController,
  goldenSaveBytes,
  olderBuildSaveBytes,
  truncatedGoldenSave,
} from '@/test/goldenSave';
import { renderApp, storeRealSlot } from '@/test/renderApp';
import { resetSaveDb } from '@/test/saves';
import * as storage from '@/storage';

const QUOTA_MESSAGE = 'The browser has no room left for saves. Delete or export old saves.';

/** The card of the slot labelled `label`. */
function slotCard(label: string): HTMLElement {
  return screen.getByRole('article', { name: label });
}

/** Every card's heading, top to bottom. */
function cardLabels(): string[] {
  return screen
    .getAllByRole('article')
    .map((card) => within(card).getByRole('heading', { level: 2 }).textContent);
}

/** A file holding `bytes`, as the file picker hands it over. */
function saveFile(bytes: Uint8Array, name = 'league.rbsave'): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/x-ringside-save' });
}

async function openSlots(fake: FakeStorage) {
  const rendered = renderApp(routes.load(), fake);
  await screen.findByRole('heading', { level: 1, name: 'Saved games' });
  return rendered;
}

/** Waits past the live announcer's delay, then reads the polite region. */
async function politeAnnouncement(): Promise<string> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, ANNOUNCE_DELAY_MS + 20);
    });
  });
  const regions = document.querySelectorAll('[aria-live="polite"]');
  return regions[regions.length - 1]?.textContent ?? '';
}

beforeEach(async () => {
  await resetSaveDb();
  useSessionStore.getState().clear();
});

describe('SaveSlotsScreen list', () => {
  it('lists slots newest first with their details', async () => {
    const fake = createFakeStorage([
      fakeSlot({ slotId: 'old', label: 'Old league', updatedAt: '2026-10-01T10:00:00.000Z' }),
      fakeSlot({
        slotId: 'new',
        label: 'New league',
        updatedAt: '2026-11-07T10:00:00.000Z',
        header: { promotionName: null, promotionShortName: null },
      }),
      fakeSlot({ slotId: 'mid', label: 'Mid league', updatedAt: '2026-11-01T10:00:00.000Z' }),
    ]);

    await openSlots(fake);

    await waitFor(() => {
      expect(cardLabels()).toEqual(['New league', 'Mid league', 'Old league']);
    });
    const newest = slotCard('New league');
    expect(within(newest).getByText('Unemployed')).toBeInTheDocument();
    expect(within(newest).getByText('Apr 10, 2026')).toBeInTheDocument();
    expect(within(newest).getByText('48.0 KB')).toBeInTheDocument();
    expect(within(slotCard('Old league')).getByText('Test Promotion A')).toBeInTheDocument();
  });

  it('shows an empty state with a New game action when there are no saves', async () => {
    const { router } = await openSlots(createFakeStorage());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'New game' }));

    // The wizard is lazily loaded, so the navigation lands once its chunk is in.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(routes.newGame());
    });
  });

  it('marks a save from an older format as needing an upgrade', async () => {
    await openSlots(createFakeStorage([fakeSlot({ formatVersion: 0 })]));

    expect(
      await within(await screen.findByRole('article')).findByText('Needs upgrade'),
    ).toBeInTheDocument();
  });

  it('shows the storage error when the list cannot be read', async () => {
    const fake = createFakeStorage();
    fake.failNextList({ code: 'unavailable', message: 'This browser does not allow saves here.' });

    await openSlots(fake);

    expect(await screen.findByText('This browser does not allow saves here.')).toBeInTheDocument();
  });
});

describe('SaveSlotsScreen delete', () => {
  it('asks before deleting, then removes the slot and says so', async () => {
    const fake = createFakeStorage([
      fakeSlot({ slotId: 'keep', label: 'Keep me' }),
      fakeSlot({ slotId: 'gone', label: 'Delete me', updatedAt: '2026-10-01T10:00:00.000Z' }),
    ]);
    await openSlots(fake);
    const user = userEvent.setup();

    await user.click(
      within(await screen.findByRole('article', { name: 'Delete me' })).getByRole('button', {
        name: 'Delete Delete me',
      }),
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Delete me?' });
    expect(dialog).toHaveTextContent("This also deletes its backups. This can't be undone.");
    expect(fake.deleted).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(fake.deleted).toEqual([]);
    expect(slotCard('Delete me')).toBeInTheDocument();

    await user.click(within(slotCard('Delete me')).getByRole('button', { name: /^Delete/ }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('article', { name: 'Delete me' })).toBeNull();
    });
    expect(fake.deleted).toEqual(['gone']);
    expect(await politeAnnouncement()).toBe('Deleted Delete me');
  });
});

describe('SaveSlotsScreen export', () => {
  it("hands the storage module's file to the download", async () => {
    const fake = createFakeStorage([fakeSlot({ label: 'Export me' })]);
    await openSlots(fake);
    const user = userEvent.setup();

    await user.click(
      within(await screen.findByRole('article', { name: 'Export me' })).getByRole('button', {
        name: 'Export Export me',
      }),
    );

    await waitFor(() => {
      expect(fake.downloads).toEqual([FAKE_EXPORT_FILE_NAME]);
    });
  });
});

describe('SaveSlotsScreen import', () => {
  it('imports a file, then points out and announces the new slot', async () => {
    const fake = createFakeStorage([fakeSlot({ slotId: 'existing', label: 'Existing' })]);
    await openSlots(fake);
    await screen.findByRole('article', { name: 'Existing' });
    const user = userEvent.setup();

    await user.upload(screen.getByTestId('import-save-input'), saveFile(await goldenSaveBytes()));

    const imported = await screen.findByRole('article', { name: 'Test save (imported)' });
    expect(imported).toHaveClass('highlighted');
    expect(slotCard('Existing')).not.toHaveClass('highlighted');
    expect(cardLabels()[0]).toBe('Test save (imported)');
    expect(await politeAnnouncement()).toBe('Imported Test save (imported)');
  });

  it('only accepts .rbsave files in the picker', async () => {
    await openSlots(createFakeStorage());

    expect(screen.getByTestId('import-save-input')).toHaveAttribute('accept', '.rbsave');
  });

  it('shows the message of a quota error', async () => {
    const fake = createFakeStorage();
    fake.failNextImport({ code: 'quota', message: QUOTA_MESSAGE });
    await openSlots(fake);
    const user = userEvent.setup();

    await user.upload(screen.getByTestId('import-save-input'), saveFile(await goldenSaveBytes()));

    const sheet = await screen.findByRole('dialog', { name: "Couldn't import that file" });
    expect(sheet).toHaveTextContent(QUOTA_MESSAGE);
    expect(fake.slots).toHaveLength(0);
  });

  it('shows the inspect stage and issues for a file that is not a save', async () => {
    await openSlots(createFakeStorage());
    const user = userEvent.setup();

    await user.upload(
      screen.getByTestId('import-save-input'),
      saveFile(damagedGoldenSave(['format'], 'something-else')),
    );

    const sheet = await screen.findByRole('dialog', { name: "Couldn't import that file" });
    expect(sheet).toHaveTextContent('Checking it is a Ringside Booker save');
    expect(within(sheet).getByText('format')).toBeInTheDocument();
  });
});

describe('SaveSlotsScreen load', () => {
  it('loads a slot in the engine and enters the game as its human player', async () => {
    const slot = await storeRealSlot(await goldenSaveBytes(), { label: 'Real league' });
    const { router } = await openSlots(createFakeStorage([slot]));
    const user = userEvent.setup();

    await user.click(
      within(await screen.findByRole('article', { name: 'Real league' })).getByRole('button', {
        name: 'Load Real league',
      }),
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(routes.game.office());
    const session = useSessionStore.getState();
    expect(session.saveSlotId).toBe(slot.slotId);
    expect(session.seat?.controller).toEqual(goldenHumanController());
    expect(session.loadNotice).toBeNull();
  });

  it('tells the player once about what the load worked around', async () => {
    const slot = await storeRealSlot(
      damagedGoldenSave(['state', 'tunableOverrides', 'retired.tunable'], 5),
      { label: 'Old tunables' },
    );
    await openSlots(createFakeStorage([slot]));
    const user = userEvent.setup();

    await user.click(
      within(await screen.findByRole('article', { name: 'Old tunables' })).getByRole('button', {
        name: 'Load Old tunables',
      }),
    );

    const notice = await screen.findByRole('region', { name: 'About this save' });
    expect(notice).toHaveTextContent('There is no tunable called "retired.tunable"');
    await user.click(within(notice).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'About this save' })).toBeNull();
    expect(useSessionStore.getState().loadNotice).toBeNull();
  });

  it('shows the stage and the issues when a save fails to load', async () => {
    const slot = await storeRealSlot(damagedGoldenSave(['formatVersion'], 99), {
      label: 'Future league',
    });
    const { router } = await openSlots(createFakeStorage([slot]));
    const user = userEvent.setup();

    await user.click(
      within(await screen.findByRole('article', { name: 'Future league' })).getByRole('button', {
        name: 'Load Future league',
      }),
    );

    const sheet = await screen.findByRole('dialog', { name: "Couldn't load Future league" });
    expect(sheet).toHaveTextContent('Checking the save version');
    expect(sheet).toHaveTextContent('(version)');
    expect(within(sheet).getByText('formatVersion')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Copy details' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Export this save' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(routes.load());
    expect(useSessionStore.getState().worldLoaded).toBe(false);
  });

  it('lists at most 20 issues and counts the rest', async () => {
    const slot = await storeRealSlot(
      damagedGoldenSave(
        ['state', 'world', 'tables', 'people'],
        Array.from({ length: 30 }, (_, index) => index),
      ),
      { label: 'Noisy league' },
    );
    await openSlots(createFakeStorage([slot]));
    const user = userEvent.setup();

    await user.click(
      within(await screen.findByRole('article', { name: 'Noisy league' })).getByRole('button', {
        name: 'Load Noisy league',
      }),
    );

    const sheet = await screen.findByRole('dialog', { name: "Couldn't load Noisy league" });
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(20);
    expect(sheet).toHaveTextContent(/and \d+ more/);
  });

  it('turns a slot that fails at decode into one with only Export and Delete', async () => {
    const slot = await storeRealSlot(await truncatedGoldenSave(), { label: 'Broken league' });
    await openSlots(createFakeStorage([slot]));
    const user = userEvent.setup();
    const card = await screen.findByRole('article', { name: 'Broken league' });

    await user.click(within(card).getByRole('button', { name: 'Load Broken league' }));
    const sheet = await screen.findByRole('dialog', { name: "Couldn't load Broken league" });
    expect(sheet).toHaveTextContent('(decode)');
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));

    const brokenCard = slotCard('Broken league');
    expect(brokenCard).toHaveAttribute('data-state', 'unreadable');
    expect(
      within(brokenCard)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Export Broken league', 'Delete Broken league']);
  });

  it('asks before loading a backup, then enters the game on that date', async () => {
    const slot = await storeRealSlot(await goldenSaveBytes(), { label: 'Backed up' });
    // A second manual save rotates the first one into backup-1, a real backup blob to load.
    const resaved = await storage.saveToSlot(slot.slotId, await goldenSaveBytes(), slot.header, {
      formatVersion: CURRENT_FORMAT_VERSION,
      engineVersion: ENGINE_VERSION,
      savedAt: '2026-11-06T10:00:00.000Z',
    });
    if (!resaved.ok) throw new Error(resaved.error.message);
    expect(resaved.value.backups.map((backup) => backup.kind)).toEqual(['backup-1']);
    const { router } = await openSlots(createFakeStorage([resaved.value]));
    const user = userEvent.setup();

    await user.click(
      within(await screen.findByRole('article', { name: 'Backed up' })).getByRole('button', {
        name: 'Backups of Backed up',
      }),
    );
    const sheet = screen.getByRole('dialog', { name: 'Backups of Backed up' });
    expect(sheet).toHaveTextContent('Before a manual save');
    await user.click(within(sheet).getByRole('button', { name: /^Load this backup/ }));
    const confirm = screen.getByRole('alertdialog', { name: 'Load this backup?' });
    expect(confirm).toHaveTextContent(
      'Load the backup from Apr 10, 2026? Your latest save stays in the slot until you save over it.',
    );
    // Nothing loads until the player confirms.
    expect(useSessionStore.getState().worldLoaded).toBe(false);

    await user.click(within(confirm).getByRole('button', { name: 'Load backup' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(routes.game.office());
    expect(useSessionStore.getState().saveSlotId).toBe(slot.slotId);
  });

  it('reports a backup that cannot be read instead of entering the game', async () => {
    const slot = await storeRealSlot(await goldenSaveBytes(), { label: 'Missing backup' });
    const withBackup = fakeSlot({
      ...slot,
      backups: [
        {
          kind: 'backup-1',
          savedAt: '2026-11-04T10:00:00.000Z',
          gameDate: slot.header.gameDate,
          sizeBytes: 2048,
          reason: 'manualSave',
        },
      ],
    });
    const { router } = await openSlots(createFakeStorage([withBackup]));
    const user = userEvent.setup();

    await user.click(
      within(await screen.findByRole('article', { name: 'Missing backup' })).getByRole('button', {
        name: 'Backups of Missing backup',
      }),
    );
    const sheet = screen.getByRole('dialog', { name: 'Backups of Missing backup' });
    await user.click(within(sheet).getByRole('button', { name: /^Load this backup/ }));
    const confirm = screen.getByRole('alertdialog', { name: 'Load this backup?' });

    // The slot has no backup-1 blob, so the load stops at storage and the error report opens.
    await user.click(within(confirm).getByRole('button', { name: 'Load backup' }));

    expect(
      await screen.findByRole('dialog', { name: "Couldn't load Missing backup" }),
    ).toHaveTextContent('Reading the save from this browser');
    expect(router.state.location.pathname).toBe(routes.load());
    expect(useSessionStore.getState().worldLoaded).toBe(false);
  });
});

describe('TitleScreen Continue', () => {
  it('continues the most recently played slot', async () => {
    const older = await storeRealSlot(await goldenSaveBytes(), {
      label: 'Older league',
      savedAt: '2026-10-01T10:00:00.000Z',
    });
    const newer = await storeRealSlot(await goldenSaveBytes(), {
      label: 'Newer league',
      savedAt: '2026-11-07T10:00:00.000Z',
    });
    const { router } = renderApp(routes.title(), createFakeStorage([older, newer]));
    const user = userEvent.setup();

    const continueButton = await screen.findByRole('button', { name: /^Continue/ });
    expect(continueButton).toHaveTextContent('Newer league · Test Promotion A · Apr 10, 2026');
    await user.click(continueButton);

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(routes.game.office());
    expect(useSessionStore.getState().saveSlotId).toBe(newer.slotId);
  });
});

describe('SaveSlotsScreen: a save made with an older build', () => {
  async function loadOlderBuildSlot() {
    const slot = await storeRealSlot(olderBuildSaveBytes(), { label: 'Old league' });
    const fake = createFakeStorage([slot]);
    const rendered = await openSlots(fake);
    const user = userEvent.setup();
    await user.click(
      within(await screen.findByRole('article', { name: 'Old league' })).getByRole('button', {
        name: 'Load Old league',
      }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Made with an older build' });
    return { fake, user, sheet, ...rendered };
  }

  it('says so in one sentence, with Export and Delete and no issue list', async () => {
    const { sheet, router } = await loadOlderBuildSlot();

    expect(sheet).toHaveTextContent(
      "This save was made with an older build of Ringside Booker, and this build can't open it. Start a new game. Export it first if you want to keep the file.",
    );
    expect(within(sheet).getByRole('button', { name: 'Export this save' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Delete this save' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Copy details' })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Start a new game' })).toHaveAttribute(
      'href',
      routes.newGame(),
    );
    expect(screen.queryByTestId('load-error')).toBeNull();
    expect(within(sheet).queryAllByRole('listitem')).toHaveLength(0);
    expect(sheet).not.toHaveTextContent('legacyMicSkill');
    expect(screen.queryByRole('dialog', { name: "Couldn't load Old league" })).toBeNull();
    expect(router.state.location.pathname).toBe(routes.load());
    expect(useSessionStore.getState().worldLoaded).toBe(false);
  });

  it('exports the save from the sheet', async () => {
    const { sheet, user, fake } = await loadOlderBuildSlot();

    await user.click(within(sheet).getByRole('button', { name: 'Export this save' }));

    await waitFor(() => {
      expect(fake.downloads).toEqual([FAKE_EXPORT_FILE_NAME]);
    });
  });

  it('asks before deleting, then removes the slot and closes the sheet', async () => {
    const { sheet, user } = await loadOlderBuildSlot();

    await user.click(within(sheet).getByRole('button', { name: 'Delete this save' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Old league?' });
    // The card is still there behind the open dialogs.
    expect(screen.getByRole('article', { name: 'Old league', hidden: true })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.queryByRole('article', { name: 'Old league', hidden: true })).toBeNull();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Made with an older build' })).toBeNull();
    });
    expect(await screen.findByText('No saved games yet')).toBeInTheDocument();
  });

  it("keeps the detailed report for a save that fails with this build's fingerprint", async () => {
    const slot = await storeRealSlot(
      damagedGoldenSave(['state', 'world', 'tables', 'people'], [1]),
      { label: 'Buggy league' },
    );
    await openSlots(createFakeStorage([slot]));
    const user = userEvent.setup();

    await user.click(
      within(await screen.findByRole('article', { name: 'Buggy league' })).getByRole('button', {
        name: 'Load Buggy league',
      }),
    );

    const sheet = await screen.findByRole('dialog', { name: "Couldn't load Buggy league" });
    expect(sheet).toHaveTextContent('(validate)');
    expect(screen.getByTestId('load-error')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Made with an older build' })).toBeNull();
  });
});
